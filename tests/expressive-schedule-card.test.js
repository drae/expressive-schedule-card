const { JSDOM } = require("jsdom");
const fs = require("fs");
const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.eval(`customElements.define("ha-card", class extends HTMLElement {});`);
w.eval(fs.readFileSync(process.argv[2] ?? `${__dirname}/../expressive-schedule-card.js`, "utf8"));

const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
const later = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const Card = w.customElements.get("expressive-schedule-card");
const ID = "schedule.heating";
const b = (from, to, t) => ({ from, to, data: { temperature: t } });
const weekday = [b("00:00:00", "07:30:00", 17.5), b("07:30:00", "09:00:00", 19.5), b("09:00:00", "17:00:00", 18.5),
  b("17:00:00", "21:00:00", 19), b("21:00:00", "23:00:00", 18), b("23:00:00", "23:59:59.999999", 17.5)];
const weekend = [b("00:00:00", "08:00:00", 17.5), b("08:00:00", "10:00:00", 19.5), b("10:00:00", "17:00:00", 18.5),
  b("17:00:00", "21:00:00", 19), b("21:00:00", "23:00:00", 18), b("23:00:00", "23:59:59.999999", 17.5)];
const week = () => ({ monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: weekend, sunday: weekend });
let stored = week();
let calls = [];
let spook = true;
const hass = () => ({
  states: { [ID]: { state: "on", attributes: { editable: true, temperature: 18.5 } } },
  services: spook ? { schedule: { get_schedule: {}, set_day: {} } } : { schedule: { get_schedule: {} } },
  locale: { language: "en-GB" },
  callWS: (msg) => Promise.resolve({ response: { [msg.target.entity_id]: stored } }),
  callService: (d, s, data, target) => {
    calls.push([d, s, data, target]);
    for (const day of data.day) stored[day] = data.blocks;
    return Promise.resolve();
  },
});
const mk = async (cfg = {}) => {
  const el = w.document.createElement("expressive-schedule-card");
  el.setConfig({ entity: ID, ...cfg });
  el.hass = hass();
  w.document.body.append(el);
  await later();
  return el;
};
const $ = (el, s) => el.shadowRoot.querySelector(s);
const $$ = (el, s) => [...el.shadowRoot.querySelectorAll(s)];
const click = (n) => n.dispatchEvent(new w.MouseEvent("click", { bubbles: true, composed: true }));
const msg = (el) => $(el, ".acts .msg").textContent.trim();

(async () => {
  // ---- model ----
  const c = Card.toChanges(weekday, "temperature", 10);
  ok(JSON.stringify(c) === JSON.stringify([[0, 17.5], [450, 19.5], [540, 18.5], [1020, 19], [1260, 18], [1380, 17.5]]), "blocks load as changes; 23:59:59.999999 counts as midnight");
  ok(JSON.stringify(Card.toChanges([], "temperature", 10)) === "[[0,10]]", "an empty day is frost all day");
  ok(JSON.stringify(Card.toChanges([b("07:00:00", "09:00:00", 20)], "temperature", 10)) === "[[0,10],[420,20],[540,10]]", "gaps load as frost");
  ok(JSON.stringify(Card.toChanges([b("00:00:00", "12:00:00", 18), b("12:00:00", "24:00:00", 18)], "temperature", 10)) === "[[0,18]]", "repeats merge");
  ok(JSON.stringify(Card.toChanges([{ from: "00:00:00", to: "24:00:00" }], "temperature", 10)) === "[[0,10]]", "a block with no temperature is frost");
  const back = Card.toBlocks(c, "temperature");
  ok(back.length === 6 && back[0].from === "00:00:00" && back[5].to === "24:00:00" && back[1].data.temperature === 19.5, "changes save as blocks ending at 24:00");
  const saved = [c, c, c, c, c, c, c].map((d) => d.map((x) => [...x]));
  const edited = saved.map((d) => d.map((x) => [...x]));
  edited[1][2][1] = 19; edited[3][2][1] = 19; edited[6][0][1] = 16;
  const sc = Card.saveCalls(edited, saved, "temperature");
  ok(sc.length === 2 && sc[0].day.join() === "tuesday,thursday" && sc[1].day.join() === "sunday", "one set_day per set of days that end up the same");

  // ---- card ----
  try { w.document.createElement("expressive-schedule-card").setConfig({ entity: "climate.x" }); ok(false, "should throw"); }
  catch { ok(true, "rejects a non-schedule entity"); }
  const el = await mk({ max_changes: 6 });
  ok($$(el, ".day").length === 7, "seven day rows");
  ok($$(el, ".day")[0].querySelector(".dl").textContent === "Mon", "rows start on Monday, named from the locale");
  ok(msg(el) === "No changes" && $(el, '[data-act="save"]').disabled, "nothing to save at first");
  el._barW = 640; el._render();
  ok($$(el, '.day[data-d="0"] .seg')[2].textContent === "18.5°" && $$(el, '.day[data-d="0"] .seg')[1].textContent === "19.5°", "blocks with room show their temperature");
  el._barW = 300; el._render();
  ok($$(el, '.day[data-d="0"] .seg')[1].textContent === "" && $$(el, '.day[data-d="0"] .seg')[2].textContent === "18.5°", "narrow blocks drop it");
  ok($$(el, ".axis span").length === 9 && $$(el, ".axis .minor").length === 4, "axis every 3 h, the in-betweens droppable");

  // select Monday 09:00 block and edit
  el._sel = { day: 0, i: 2 }; el._render();
  ok($(el, ".blk:nth-of-type(2) h3").textContent.includes("09:00–17:00"), "editor names the block");
  click($(el, '[data-step="temp"][data-dir="1"]'));
  ok(el._days[0][2][1] === 19, "target + steps 0.5");
  ok(msg(el) === "Unsaved changes" && !$(el, '[data-act="save"]').disabled, "unsaved changes enable Save");
  ok($$(el, '.day[data-d="0"] .seg')[2].getAttribute("style").includes("color-mix"), "a changed block is drawn lighter");
  click($(el, '[data-step="time"][data-dir="-1"]'));
  ok(el._days[0][2][0] === 510, "start − steps 30 min");
  for (let n = 0; n < 5; n++) click($(el, '[data-step="time"][data-dir="-1"]'));
  ok(el._days[0][2][0] === 480, "start stops 30 min after the change before");

  // drag a handle
  const hd = $(el, '.hd[data-d="0"][data-i="3"]');
  hd.closest(".wrap").getBoundingClientRect = () => ({ left: 0, width: 1440, top: 0, height: 32 });
  hd.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, clientX: 1020 }));
  w.dispatchEvent(new w.MouseEvent("pointermove", { clientX: 1093 }));
  ok(el._days[0][3][0] === 1080, "drag snaps to 30 min");
  ok(!!$(el, ".tip") && $(el, ".tip").textContent === "18:00", "the bubble shows the time while dragging");
  w.dispatchEvent(new w.MouseEvent("pointermove", { clientX: 1400 }));
  ok(el._days[0][3][0] === 1230, "a handle can't pass the next change");
  w.dispatchEvent(new w.MouseEvent("pointerup", {}));
  ok(!$(el, ".tip"), "the bubble goes on release");

  // split / remove / limits
  ok($(el, '[data-act="split"]').disabled, "split is off at the 6-change limit");
  el._sel = { day: 0, i: 3 }; el._render();
  click($(el, '[data-act="remove"]'));
  ok(el._days[0].length === 5 && el._sel.i === 2, "remove merges into the block before");
  click($(el, '[data-act="split"]'));
  ok(el._days[0].length === 6 && el._sel.i === 3, "split adds a change in the middle");

  // copy and save
  click($(el, '[data-copy="0,1,2,3,4"]'));
  ok(JSON.stringify(el._days[4]) === JSON.stringify(el._days[0]), "copy to weekdays");
  click($(el, '[data-act="save"]'));
  await later();
  ok(calls.length === 1 && calls[0][1] === "set_day" && calls[0][2].day.join() === "monday,tuesday,wednesday,thursday,friday", "save sends the five weekdays in one call");
  ok(calls[0][3].entity_id === ID && calls[0][2].blocks.at(-1).to === "24:00:00", "set_day targets the helper and ends at 24:00");
  ok(msg(el).startsWith("Saved at") && $(el, '[data-act="save"]').disabled, "saved");
  ok(el._days[0].length === 5 && calls[0][2].blocks.length === 5, "a split left at the same temperature saves as one block");

  // reset
  click($(el, '[data-step="temp"][data-dir="-1"]'));
  click($(el, '[data-act="reset"]'));
  ok(!el._dirty() && msg(el).startsWith("Saved at"), "reset goes back to the saved schedule");

  // frost
  el._sel = { day: 6, i: 0 }; el._render();
  for (let n = 0; n < 20; n++) click($(el, '[data-step="temp"][data-dir="-1"]'));
  ok(el._days[6][0][1] === 10 && $(el, '.stepper output[for], .edit .stepper output') && $$(el, ".edit output")[1].textContent === "❄︎", "target stops at the floor and shows a snowflake");

  // drafts survive a rebuilt card
  const el2 = await mk();
  ok(el2._dirty() && el2._days[6][0][1] === 10, "unsaved edits come back in a new card");
  el2.remove();

  // ---- Bubble pop-up guard ----
  w.history.replaceState(null, "", "/#heating-schedule");
  el._config.hash = "#heating-schedule";
  let bubbleSaw = 0;
  w.addEventListener("keydown", (e) => { if (e.key === "Escape") bubbleSaw++; });
  w.addEventListener("click", (e) => { if (e.composedPath().some((n) => n.classList?.contains("bubble-close-button"))) bubbleSaw++; });
  w.document.body.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ok(bubbleSaw === 0 && !!$(el, ".ask"), "Escape with unsaved changes is held back and asks");
  click($(el, '.ask [data-a="keep"]'));
  ok(!$(el, ".ask") && w.location.hash === "#heating-schedule", "keep editing stays open");
  const x = w.document.createElement("button");
  x.className = "bubble-close-button";
  w.document.body.append(x);
  click(x);
  ok(bubbleSaw === 0 && !!$(el, ".ask"), "the close button with unsaved changes asks");
  ok($(el, ".ask").textContent.includes("You have unsaved changes"), "the prompt doesn't list days");
  click($(el, '.ask [data-a="discard"]'));
  ok(!el._dirty() && w.location.hash === "", "discard resets and closes the pop-up");
  click(x);
  ok(bubbleSaw === 1 && !$(el, ".ask"), "with nothing unsaved, closing is left to Bubble");

  // the back button reopens and asks
  w.history.replaceState(null, "", "/#heating-schedule");
  w.dispatchEvent(new w.Event("location-changed"));
  click($(el, '[data-step="temp"][data-dir="1"]'));
  w.history.replaceState(null, "", "/");
  w.dispatchEvent(new w.Event("popstate"));
  ok(w.location.hash === "#heating-schedule" && !!$(el, ".ask"), "leaving by the back button reopens and asks");
  calls = [];
  click($(el, '.ask [data-a="save"]'));
  await later();
  ok(calls.length === 1 && !el._dirty() && w.location.hash === "", "save from the prompt saves, then closes");

  // without Spook
  spook = false;
  const el3 = await mk();
  click($(el3, '[data-step="temp"][data-dir="1"]'));
  ok($(el3, '[data-act="save"]').disabled && msg(el3) === "Unsaved changes", "no Spook: Save stays off");
  click($(el3, '[data-act="reset"]'));
  ok(msg(el3).includes("Spook"), "and says why");
  el3.remove();

  const el4 = w.document.createElement("expressive-schedule-card");
  el4.setConfig({ entity: "schedule.missing" });
  el4.hass = hass();
  await later();
  ok($(el4, ".note").textContent.includes("not found"), "a missing helper says so");
  w.close(); // stops the cards' clocks so node can exit
})().catch((e) => { console.log("FAIL", e); process.exitCode = 1; w.close(); });
