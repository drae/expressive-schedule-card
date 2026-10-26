/*
 * expressive-schedule-card
 * Copyright (c) 2026 Paul Owen
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * A weekly heating schedule in the style of expressive-slider-card, kept in a Home Assistant
 * schedule helper: one row per day, a block per temperature, handles on the changeovers.
 *
 *   type: custom:expressive-schedule-card
 *   entity: schedule.heating   # a schedule helper made in the UI; each block carries its temperature as data
 *   attribute: temperature     # the data key on each block
 *   min: 10                    # lowest target; at or below `frost` it shows as a snowflake
 *   max: 25
 *   step: 0.5
 *   frost: 10                  # false = always show the number
 *   time_step: 30              # minutes
 *   max_changes: 6             # optional limit of changes per day (counting midnight)
 *   handles: selected          # selected | all: which days show drag handles
 *   hash: "#heating-schedule"  # optional; the Bubble pop-up it lives in, found by itself when left out
 *
 * Edits stay in the card until Save; Reset goes back to what the helper holds. Saving uses
 * schedule.set_day from Spook, one call per set of days that end up the same. Every day is saved
 * as back-to-back blocks from 00:00 to 24:00, so the helper is on all the time and its
 * `temperature` attribute is the target for the current block. Gaps in a helper made elsewhere
 * load as frost blocks.
 *
 * Inside a Bubble pop-up, closing with unsaved changes (the close button, the backdrop or Escape)
 * asks to save or discard first. A close the card can't stop (the back button) reopens the pop-up
 * and asks; unsaved edits also survive the card being rebuilt.
 */

const VERSION = "0.1.0";
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY = 1440;
// Cool to warm: frost blue, teal, green (18°), amber (19.5°), red above 21°.
const STOPS = [[10, [84, 116, 158]], [17, [62, 128, 150]], [18, [104, 150, 96]], [19, [196, 150, 40]], [19.5, [201, 126, 11]],
  [21, [226, 84, 22]], [25, [255, 69, 0]]];
const DRAFTS = new Map(); // entity -> { saved, days }: unsaved edits outlive a rebuilt card

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const pct = (m) => `${(m / DAY) * 100}%`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (days) => days.map((d) => d.map((c) => [...c]));

// "07:30:00" -> 450; HA reads a 24:00 end back as 23:59:59.999999, which rounds to 1440.
const parseTime = (s) => {
  const [h = 0, m = 0, sec = 0] = String(s).split(":").map(Number);
  return clamp(Math.round(h * 60 + m + sec / 60), 0, DAY);
};

// A day's blocks as changes [[minute, temperature], ...] from 00:00; gaps become frost, repeats merge.
const toChanges = (blocks, attr, floor) => {
  const out = [];
  const put = (m, t) => {
    if (out.length && out.at(-1)[0] === m) out.pop();
    if (out.length && out.at(-1)[1] === t) return;
    out.push([m, t]);
  };
  let at = 0;
  for (const b of [...(blocks ?? [])].sort((x, y) => parseTime(x.from) - parseTime(y.from))) {
    const from = parseTime(b.from), to = parseTime(b.to);
    if (to <= at) continue;
    if (from > at) put(at, floor);
    const t = Number(b.data?.[attr]);
    put(Math.max(from, at), Number.isFinite(t) ? t : floor);
    at = to;
  }
  if (at < DAY) put(at, floor);
  if (!out.length || out[0][0] !== 0) out.unshift([0, floor]);
  return out;
};

const toBlocks = (changes, attr) => changes.map(([m, t], i) => ({
  from: `${hhmm(m)}:00`,
  to: i + 1 < changes.length ? `${hhmm(changes[i + 1][0])}:00` : "24:00:00",
  data: { [attr]: t },
}));

// One set_day call per set of days that save the same blocks.
const saveCalls = (days, saved, attr) => {
  const groups = new Map();
  days.forEach((d, i) => {
    if (same(d, saved[i])) return;
    const blocks = toBlocks(d, attr);
    const key = JSON.stringify(blocks);
    if (!groups.has(key)) groups.set(key, { day: [], blocks });
    groups.get(key).day.push(DAY_KEYS[i]);
  });
  return [...groups.values()];
};

const ICON = {
  minus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12M12 6v12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const CSS_TEXT = `
  :host { display: block; }
  ha-card { display: flex; flex-direction: column; gap: 32px; position: relative; background: none; border: none; box-shadow: none;
            padding: 16px 0 0; overflow: visible; font-variant-numeric: tabular-nums; }
  [hidden] { display: none !important; }
  /* Blocks as on the rest of the dashboard: gray100, square top, heading straddling the top edge. */
  .blk { background: var(--gray100, #353637); border-radius: 0 0 32px 32px; padding: 0 16px 16px; display: flex; flex-direction: column;
         gap: 16px; min-width: 0; }
  .blk h3 { margin: -16px 0 0; height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
            font-size: 16px; font-weight: 600; color: var(--primary-text-color); }
  .blk h3 span { font-size: 12px; font-weight: 400; color: var(--secondary-text-color); }
  .week { display: flex; flex-direction: column; gap: 8px; }
  .day { display: flex; gap: 8px; align-items: center; cursor: pointer; outline: none; border-radius: 8px; }
  .day:focus-visible .dl { text-decoration: underline; }
  .dl { width: 40px; flex: none; font-size: 14px; font-weight: 600; color: color-mix(in srgb, var(--primary-text-color) 70%, transparent); }
  .day.sel .dl { color: var(--primary-text-color); }
  .wrap { position: relative; flex: 1; min-width: 0; display: flex; }
  /* Scaled expressive-slider handle: 3px wide, 3px proud, a 3px gap either side; plain splits use the same gap. */
  .bar { --hw: 3px; --gap: 3px; --r: 8px; --ir: 4px; position: relative; height: 32px; flex: 1; }
  .seg { position: absolute; top: 0; bottom: 0; display: flex; align-items: center; justify-content: center; overflow: hidden;
         white-space: nowrap; border-radius: var(--ir); font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, .92); }
  .seg.first { border-top-left-radius: var(--r); border-bottom-left-radius: var(--r); }
  .seg.last { border-top-right-radius: var(--r); border-bottom-right-radius: var(--r); }
  .seg.sel { box-shadow: inset 0 0 0 2px #fff; }
  .now { position: absolute; z-index: 1; top: 6px; bottom: 6px; width: 2px; margin-left: -1px; border-radius: 1px; pointer-events: none;
         background: var(--primary-text-color); opacity: .45; }
  .handles { position: absolute; inset: 0; pointer-events: none; }
  .hd { position: absolute; top: -3px; bottom: -3px; width: 24px; margin-left: -12px; display: flex; justify-content: center;
        pointer-events: auto; cursor: ew-resize; touch-action: none; outline: none; }
  .hd::before { content: ""; width: var(--hw, 3px); border-radius: 1.5px; background: var(--hc); }
  .hd:focus-visible::before { outline: 2px solid var(--primary-color); outline-offset: 3px; }
  .tip { position: absolute; z-index: 3; bottom: calc(100% + 10px); left: 50%; min-width: 40px; height: 40px; padding: 0 8px; box-sizing: border-box;
         border-radius: 20px; display: grid; place-items: center; pointer-events: none; background: var(--hc); color: #fff;
         font-size: 14px; font-weight: 600; transform: translateX(-50%); transform-origin: 50% 100%; animation: tip-in 150ms cubic-bezier(.2, 0, 0, 1); }
  .tip.held { animation: none; }
  @keyframes tip-in { from { transform: translateX(-50%) scale(0); } }
  .axis { position: relative; height: 16px; line-height: 16px; margin-left: 48px; font-size: 12px; color: var(--secondary-text-color); }
  .axis span { position: absolute; transform: translateX(-50%); }
  .axis span:first-child { transform: none; }
  .axis span:last-child { transform: translateX(-100%); }
  ha-card { container-type: inline-size; }
  @container (max-width: 480px) { .axis .minor { display: none; } }
  .edit { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between; padding-bottom: 16px;
          margin-bottom: -8px; border-bottom: 2px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
  .lbl { display: block; margin-bottom: 8px; font-size: 12px; color: var(--secondary-text-color); }
  .stepper { display: flex; align-items: center; gap: 8px; height: 44px; box-sizing: border-box; padding: 4px; border-radius: 24px;
             background: var(--popupBG, var(--secondary-background-color, #28282a)); }
  .stepper output { min-width: 64px; text-align: center; font-size: 14px; font-weight: 600; color: var(--primary-text-color); }
  .stepper.fixed { padding: 4px 16px; }
  .disc { width: 36px; height: 36px; flex: none; border: 0; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
          background: var(--gray200, #404142); color: var(--primary-text-color); }
  .disc svg { width: 18px; height: 18px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .edit > .row { height: 44px; }
  .chip { font: inherit; font-size: 14px; font-weight: 600; color: var(--primary-text-color); background: transparent; border: 0; cursor: pointer;
          border-radius: 16px; padding: 8px 16px; box-shadow: inset 0 0 0 1px var(--gray300, #555658); }
  .chip[disabled] { opacity: .4; cursor: default; }
  .chip.save { background: var(--primary-color); box-shadow: none; color: #fff; }
  .chip:focus-visible, .disc:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .muted { font-size: 12px; color: var(--secondary-text-color); }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding: 0 16px; margin-top: -16px; }
  .legend { display: flex; gap: 8px; flex-wrap: wrap; }
  .legend span { display: inline-flex; gap: 4px; align-items: center; }
  .legend i { width: 16px; height: 10px; border-radius: 3px; }
  .acts { display: flex; align-items: center; gap: 8px; padding: 0 16px; margin-top: -16px; }
  .acts .msg { flex: 1; min-width: 0; }
  .acts .msg b { color: var(--primary-text-color); font-weight: 600; }
  .ask { position: absolute; inset: 0; z-index: 20; border-radius: 32px; display: grid; place-items: center; padding: 16px;
         background: rgba(20, 20, 22, .6); }
  .ask .box { max-width: 360px; display: flex; flex-direction: column; gap: 16px; padding: 24px; border-radius: 24px;
              background: var(--popupBG, #28282a); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
  .ask b { font-size: 16px; font-weight: 600; }
  .ask p { margin: 0; font-size: 14px; color: var(--secondary-text-color); }
  .ask .row { justify-content: flex-end; }
  .note { padding: 16px; font-size: 14px; color: var(--secondary-text-color); }
  @media (prefers-reduced-motion: reduce) { .tip { animation: none; } }
`;

class ExpressiveScheduleCard extends HTMLElement {
  static getStubConfig(hass) {
    return { entity: Object.keys(hass.states).find((e) => e.startsWith("schedule.")) ?? "" };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    if (!config.entity.startsWith("schedule.")) throw new Error("entity must be a schedule helper");
    this._config = { attribute: "temperature", min: 10, max: 25, step: 0.5, frost: 10, time_step: 30, handles: "selected", ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" }).innerHTML = `<style>${CSS_TEXT}</style><ha-card></ha-card>`;
      this._card = this.shadowRoot.querySelector("ha-card");
    }
    this._days = this._saved = null;
    this._sel = { day: this._today(), i: 0 };
    this._render();
    if (this._hass) this._load();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  getCardSize() {
    return 10;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback() {
    this._guards(true);
    this._clock = setInterval(() => this._tick(), 60000);
    if (this._hass && !this._dirty()) this._load();
  }

  disconnectedCallback() {
    this._guards(false);
    clearInterval(this._clock);
    this._clock = null;
    this._endDrag?.();
  }

  // ---- data ----

  get _floor() {
    return this._config.min;
  }

  async _load() {
    const id = this._config.entity;
    if (!this._hass.states[id]) return this._fail(`${id} not found`);
    try {
      const res = await this._hass.callWS({ type: "call_service", domain: "schedule", service: "get_schedule",
        target: { entity_id: id }, return_response: true });
      const week = res?.response?.[id] ?? {};
      const saved = DAY_KEYS.map((k) => toChanges(week[k], this._config.attribute, this._floor));
      const draft = DRAFTS.get(id);
      this._saved = saved;
      this._days = draft && same(draft.saved, saved) ? clone(draft.days) : clone(saved);
      this._error = null;
      this._sel.i = this._slotAt(this._sel.day, this._sel.day === this._today() ? this._nowMin() : 0);
    } catch (e) {
      return this._fail(`Couldn't read ${id}: ${e?.message ?? e}`);
    }
    this._render();
  }

  _fail(msg) {
    this._error = msg;
    this._render();
  }

  _dirty() {
    return !!this._days && !same(this._days, this._saved);
  }

  _changed() {
    if (this._dirty()) DRAFTS.set(this._config.entity, { saved: clone(this._saved), days: clone(this._days) });
    else DRAFTS.delete(this._config.entity);
    this._render();
  }

  async _save() {
    // Neighbouring blocks at the same temperature (a split left alone) save as one, as the helper reads them back.
    const attr = this._config.attribute;
    const days = this._days.map((d) => toChanges(toBlocks(d, attr), attr, this._floor));
    const calls = saveCalls(days, this._saved, attr);
    this._saving = true;
    this._render();
    try {
      for (const c of calls) {
        await this._hass.callService("schedule", "set_day", { day: c.day, blocks: c.blocks }, { entity_id: this._config.entity });
      }
      this._saved = clone(days);
      this._days = clone(days);
      DRAFTS.delete(this._config.entity);
      this._saveError = null;
      this._savedAt = hhmm(this._nowMin());
    } catch (e) {
      this._saveError = e?.message ?? String(e);
    }
    this._saving = false;
    this._render();
    return !this._saveError;
  }

  _reset() {
    this._days = clone(this._saved);
    this._sel.i = Math.min(this._sel.i, this._days[this._sel.day].length - 1);
    this._changed();
  }

  _canSave() {
    const s = this._hass?.states[this._config.entity];
    if (!this._hass?.services?.schedule?.set_day) return "Saving needs Spook's schedule.set_day.";
    if (s?.attributes?.editable === false) return "This schedule is set up in YAML, so it can't be changed here.";
    return null;
  }

  // ---- edits ----

  _segs(d, days = this._days) {
    const c = days[d];
    return c.map(([s, t], i) => ({ s, e: i + 1 < c.length ? c[i + 1][0] : DAY, t, i }));
  }

  _slotAt(d, m) {
    let at = 0;
    this._days?.[d]?.forEach(([s], i) => { if (s <= m) at = i; });
    return at;
  }

  _setTime(d, i, m) {
    if (i === 0) return;
    const c = this._days[d], st = this._config.time_step;
    const lo = c[i - 1][0] + st, hi = i + 1 < c.length ? c[i + 1][0] - st : DAY - st;
    c[i][0] = clamp(Math.round(m / st) * st, lo, hi);
  }

  _setTemp(d, i, t) {
    const { min, max, step } = this._config;
    this._days[d][i][1] = clamp(Math.round(t / step) * step, min, max);
  }

  _split(d, i) {
    const c = this._days[d], st = this._config.time_step;
    if (this._config.max_changes && c.length >= this._config.max_changes) return i;
    const s = c[i][0], e = i + 1 < c.length ? c[i + 1][0] : DAY;
    if (e - s < 2 * st) return i;
    c.splice(i + 1, 0, [Math.round((s + e) / 2 / st) * st, c[i][1]]);
    return i + 1;
  }

  _remove(d, i) {
    if (i === 0) return 0;
    this._days[d].splice(i, 1);
    return i - 1;
  }

  _copy(from, targets) {
    for (const d of targets) if (d !== from) this._days[d] = this._days[from].map((c) => [...c]);
  }

  // ---- looks ----

  _col(t) {
    if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1]})`;
    for (let i = 1; i < STOPS.length; i++) {
      if (t > STOPS[i][0]) continue;
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], f = (t - a) / (b - a);
      return `rgb(${ca.map((v, k) => Math.round(v + (cb[k] - v) * f))})`;
    }
    return `rgb(${STOPS.at(-1)[1]})`;
  }

  _t(t) {
    const f = this._config.frost;
    if (f !== false && t <= f) return "❄︎";
    return `${Number.isInteger(t) ? t : t.toFixed(1)}°`;
  }

  _dayName(d) {
    const lang = this._hass?.locale?.language ?? this._hass?.language ?? "en";
    return new Date(2024, 0, 1 + d).toLocaleDateString(lang, { weekday: "short" }); // 1 Jan 2024 was a Monday
  }

  _today() {
    return (new Date().getDay() + 6) % 7;
  }

  _nowMin() {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  }

  _tick() {
    const now = this._card.querySelector(".now");
    if (now) now.style.left = pct(this._nowMin());
    if (this._nowDay !== this._today()) this._render();
  }

  // ---- render ----

  _bar(d, handles) {
    const was = new Set(this._segs(d, this._saved).map((g) => `${g.s}-${g.e}-${g.t}`));
    const cut = handles ? "(var(--hw) / 2 + var(--gap))" : "(var(--gap) / 2)";
    const sel = d === this._sel.day ? this._sel.i : -1;
    let h = '<div class="wrap"><div class="bar">';
    for (const g of this._segs(d)) {
      const base = this._col(g.t);
      const fill = was.has(`${g.s}-${g.e}-${g.t}`) ? base : `color-mix(in srgb, ${base} 80%, #fff)`;
      const l = g.i ? cut : "0px", r = g.e < DAY ? cut : "0px";
      const cls = `seg${g.i === 0 ? " first" : ""}${g.e === DAY ? " last" : ""}${g.i === sel ? " sel" : ""}`;
      h += `<div class="${cls}" data-i="${g.i}" style="left:calc(${pct(g.s)} + ${l});width:max(0px, calc(${pct(g.e - g.s)} - ${l} - ${r}));background:${fill}"></div>`;
    }
    if (d === this._today()) h += `<div class="now" style="left:${pct(this._nowMin())}"></div>`;
    h += "</div>";
    if (handles) {
      h += '<div class="handles">';
      this._days[d].forEach(([m, t], i) => {
        if (!i) return;
        const drag = this._drag?.d === d && this._drag?.i === i;
        h += `<div class="hd" data-d="${d}" data-i="${i}" tabindex="0" role="slider" aria-label="${this._dayName(d)} change at ${hhmm(m)}"
          aria-valuetext="${hhmm(m)}" style="left:${pct(m)};--hc:${this._col(t)}">${drag ? `<span class="tip${this._drag.moved ? " held" : ""}">${hhmm(m)}</span>` : ""}</div>`;
      });
      h += "</div>";
    }
    return `${h}</div>`;
  }

  _render() {
    if (!this._card) return;
    const ask = this._card.querySelector(".ask");
    if (this._error || !this._days) {
      this._card.innerHTML = `<div class="note">${this._error ?? "Loading schedule…"}</div>`;
      return;
    }
    const d = this._sel.day;
    this._sel.i = clamp(this._sel.i, 0, this._days[d].length - 1);
    const i = this._sel.i, g = this._segs(d)[i], [m, t] = this._days[d][i];
    const all = this._config.handles === "all";
    const max = this._config.max_changes;
    const temps = [...new Set(this._days.flat().map((c) => c[1]))].sort((a, b) => a - b);
    const blocked = this._canSave();
    const dirty = this._dirty();
    const stepper = (id, val, lbl) => `<div><span class="lbl">${lbl}</span><div class="stepper">
      <button class="disc" data-step="${id}" data-dir="-1" aria-label="${lbl} down">${ICON.minus}</button><output>${val}</output>
      <button class="disc" data-step="${id}" data-dir="1" aria-label="${lbl} up">${ICON.plus}</button></div></div>`;
    const msg = this._saving ? "Saving…" : this._saveError ? `Couldn't save: ${this._saveError}` : dirty ? "<b>Unsaved changes</b>"
      : blocked ?? (this._savedAt ? `Saved at ${this._savedAt}` : "No changes");
    this._nowDay = this._today();

    this._card.innerHTML = `
      <div class="blk"><h3>This week<span>tap a block, drag a handle</span></h3>
        <div class="week">${DAY_KEYS.map((_, n) => `<div class="day${n === d ? " sel" : ""}" data-d="${n}" role="button" tabindex="0"
          aria-label="${this._dayName(n)}"><span class="dl">${this._dayName(n)}</span>${this._bar(n, all || n === d)}</div>`).join("")}</div>
        <div class="axis">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hr) =>
          `<span${hr % 6 ? ' class="minor"' : ""} style="left:${(hr / 24) * 100}%">${pad(hr)}</span>`).join("")}</div>
      </div>
      <div class="blk"><h3>${this._dayName(d)} · ${hhmm(g.s)}–${g.e === DAY ? "24:00" : hhmm(g.e)}</h3>
        <div class="edit">
          ${i === 0 ? '<div><span class="lbl">From</span><div class="stepper fixed"><output>00:00</output></div></div>' : stepper("time", hhmm(m), "Starts")}
          ${stepper("temp", this._t(t), "Target")}
          <div class="row"><button class="chip" data-act="split" ${max && this._days[d].length >= max ? "disabled" : ""}>+ Split</button>
            ${i ? '<button class="chip" data-act="remove">Remove</button>' : ""}</div>
        </div>
        <div class="row"><span class="muted">Copy ${this._dayName(d)} to</span>
          <button class="chip" data-copy="0,1,2,3,4">Weekdays</button><button class="chip" data-copy="5,6">Weekend</button>
          <button class="chip" data-copy="0,1,2,3,4,5,6">Every day</button></div>
      </div>
      <div class="foot muted"><div class="legend">${temps.map((v) => `<span><i style="background:${this._col(v)}"></i>${this._t(v)}</span>`).join("")}</div>
        ${max ? `<span>${this._dayName(d)} · ${this._days[d].length} of ${max} changes</span>` : ""}</div>
      <div class="acts"><span class="msg muted">${msg}</span>
        <button class="chip" data-act="reset" ${dirty && !this._saving ? "" : "disabled"}>Reset</button>
        <button class="chip save" data-act="save" ${dirty && !blocked && !this._saving ? "" : "disabled"}>Save</button></div>`;
    if (ask) this._card.append(ask);
    this._wire();
  }

  _wire() {
    const $$ = (s) => this._card.querySelectorAll(s);
    const d = this._sel.day;
    $$(".day").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (this._justDragged || e.target.closest(".hd")) return;
        const seg = e.target.closest(".seg");
        const nd = Number(row.dataset.d);
        this._sel = { day: nd, i: seg ? Number(seg.dataset.i) : nd === this._sel.day ? this._sel.i : 0 };
        this._render();
      });
      row.addEventListener("keydown", (e) => {
        if (e.target !== row || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        this._sel = { day: Number(row.dataset.d), i: 0 };
        this._render();
        this._card.querySelector(`.day[data-d="${row.dataset.d}"]`)?.focus();
      });
    });
    $$(".hd").forEach((h) => {
      const hd = Number(h.dataset.d), hi = Number(h.dataset.i);
      h.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const box = h.closest(".wrap").getBoundingClientRect();
        this._sel = { day: hd, i: hi };
        this._drag = { d: hd, i: hi, moved: false };
        const move = (ev) => {
          this._drag.moved = true;
          this._setTime(hd, hi, ((ev.clientX - box.left) / box.width) * DAY);
          this._changed();
        };
        const up = () => {
          this._endDrag();
          this._justDragged = true;
          setTimeout(() => { this._justDragged = false; }, 0);
          this._changed();
        };
        this._endDrag = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          this._drag = null;
          this._endDrag = null;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        this._render();
      });
      h.addEventListener("keydown", (e) => {
        const k = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
        if (!k) return;
        e.preventDefault();
        this._sel = { day: hd, i: hi };
        this._setTime(hd, hi, this._days[hd][hi][0] + k * this._config.time_step);
        this._changed();
        this._card.querySelector(`.hd[data-d="${hd}"][data-i="${hi}"]`)?.focus();
      });
    });
    $$("[data-step]").forEach((b) => b.addEventListener("click", () => {
      const k = Number(b.dataset.dir), i = this._sel.i;
      if (b.dataset.step === "time") this._setTime(d, i, this._days[d][i][0] + k * this._config.time_step);
      else this._setTemp(d, i, this._days[d][i][1] + k * this._config.step);
      this._changed();
    }));
    $$("[data-copy]").forEach((b) => b.addEventListener("click", () => {
      this._copy(d, b.dataset.copy.split(",").map(Number));
      this._changed();
    }));
    const act = (name, fn) => this._card.querySelector(`[data-act="${name}"]`)?.addEventListener("click", fn);
    act("split", () => { this._sel.i = this._split(d, this._sel.i); this._changed(); });
    act("remove", () => { this._sel.i = this._remove(d, this._sel.i); this._changed(); });
    act("reset", () => this._reset());
    act("save", () => this._save());
  }

  // ---- closing a Bubble pop-up with unsaved changes ----

  // The pop-up's hash: from config, else from the bubble-card pop-up this card sits in.
  _popupHash() {
    if (this._config.hash) return this._config.hash;
    for (let n = this; n; n = n.parentNode ?? n.host) {
      const h = n.localName === "bubble-card" ? n._config?.hash ?? n.config?.hash : null;
      if (h) return h;
    }
    return null;
  }

  _open() {
    const h = this._popupHash();
    return !!h && location.hash === h;
  }

  _guards(on) {
    if (on && !this._onKey) {
      // Capture listeners run before Bubble's own on window, so these can stop a close.
      this._onKey = (e) => {
        if (e.key !== "Escape" || !this._dirty() || !this._open()) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this._ask();
      };
      this._onClick = (e) => {
        if (!this._dirty() || !this._open()) return;
        const hit = e.composedPath().some((n) => n.classList?.contains("bubble-close-button") || n.classList?.contains("bubble-backdrop"));
        if (!hit) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this._ask();
      };
      // The back button can't be stopped: put the pop-up back and ask.
      this._onNav = () => {
        const h = this._popupHash();
        if (!h || this._leaving) return;
        if (location.hash !== h && this._wasOpen && this._dirty()) {
          location.hash = h;
          this._ask();
        } else if (location.hash === h && !this._wasOpen && !this._dirty()) {
          this._load(); // pick up edits made elsewhere each time the pop-up opens
        }
        this._wasOpen = location.hash === h;
      };
      window.addEventListener("keydown", this._onKey, true);
      window.addEventListener("click", this._onClick, true);
      for (const t of ["hashchange", "popstate", "location-changed"]) window.addEventListener(t, this._onNav);
      this._wasOpen = this._open();
    } else if (!on && this._onKey) {
      window.removeEventListener("keydown", this._onKey, true);
      window.removeEventListener("click", this._onClick, true);
      for (const t of ["hashchange", "popstate", "location-changed"]) window.removeEventListener(t, this._onNav);
      this._onKey = this._onClick = this._onNav = null;
    }
  }

  _ask() {
    if (this._card.querySelector(".ask")) return;
    const el = document.createElement("div");
    el.className = "ask";
    el.setAttribute("role", "alertdialog");
    el.innerHTML = `<div class="box"><b>Save changes?</b>
      <p>You have unsaved changes. Save them before closing, or discard them and keep the current schedule.</p>
      <div class="row"><button class="chip" data-a="keep">Keep editing</button><button class="chip" data-a="discard">Discard</button>
      <button class="chip save" data-a="save" ${this._canSave() ? "disabled" : ""}>Save</button></div></div>`;
    this._card.append(el);
    const done = () => el.remove();
    el.querySelector('[data-a="keep"]').addEventListener("click", done);
    el.querySelector('[data-a="discard"]').addEventListener("click", () => { done(); this._reset(); this._close(); });
    el.querySelector('[data-a="save"]').addEventListener("click", async () => {
      done();
      if (await this._save()) this._close();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      done();
    });
    el.querySelector('[data-a="save"]:not([disabled])')?.focus();
  }

  // Close the pop-up the way Bubble does: drop the hash and announce it.
  _close() {
    if (!this._open()) return;
    this._leaving = true;
    history.replaceState(history.state, "", location.href.split("#")[0]);
    window.dispatchEvent(new Event("location-changed"));
    this._leaving = false;
    this._wasOpen = false;
  }
}

ExpressiveScheduleCard.toChanges = toChanges;
ExpressiveScheduleCard.toBlocks = toBlocks;
ExpressiveScheduleCard.saveCalls = saveCalls;

if (!customElements.get("expressive-schedule-card")) {
  console.info(`%c EXPRESSIVE-SCHEDULE-CARD %c ${VERSION} `, "background:#c97e0b;color:#fff;font-weight:600", "background:#28282a;color:#fff");
  customElements.define("expressive-schedule-card", ExpressiveScheduleCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "expressive-schedule-card",
    name: "Expressive schedule",
    description: "Weekly temperature schedule on a schedule helper: day rows, drag handles, save and reset",
    preview: false,
  });
}
