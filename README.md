# Expressive Schedule Card

A weekly temperature schedule for Home Assistant in the style of [expressive-slider-card](https://github.com/drae/expressive-slider-card) and [expressive-climate-card](https://github.com/drae/expressive-climate-card). The schedule lives in a [schedule helper](https://www.home-assistant.io/integrations/schedule/), so it's HA's own data.

- One row per day, Monday first, with a block for each temperature. The colours run cool to warm, and frost shows as a snowflake.
- Drag the handle between two blocks to move a change. It moves in 30-minute steps and can't pass the next change. While you drag, a bubble shows the time.
- Tap a block to edit it below: its start time, its target, split it in two or remove it. You can also copy the day to the weekdays, the weekend or every day.
- A faint line on today's row marks the time now.
- Edits stay in the card until you press **Save**, and **Reset** puts the helper's schedule back. Changed blocks show lighter until they're saved.
- In a Bubble Card pop-up, closing with unsaved changes asks whether to save or discard. That covers the close button, the backdrop and Escape. The back button can't be stopped, so the card reopens the pop-up and asks.

It is a single plain JavaScript file with no dependencies.

## Requirements

- A schedule helper made in the UI (**Settings → Devices & services → Helpers → Schedule**). Each block carries its temperature as block data, for example `temperature: 19.5`.
- [Spook](https://spook.boo) for `schedule.set_day`, which is how the card saves. Without Spook the card still shows the schedule but can't save it.

The card saves every day as back-to-back blocks from 00:00 to 24:00. The helper is then always `on`, and its `temperature` attribute is the target for the block that's running. Gaps in a schedule made elsewhere load as frost blocks.

## Running the heating from it

The card only edits the schedule. To drive a thermostat, use an automation that sets the climate's target whenever the helper's `temperature` attribute changes:

```yaml
triggers:
  - trigger: state
    entity_id: schedule.heating
    attribute: temperature
conditions:
  - condition: state
    entity_id: climate.thermostat
    state: heat
actions:
  - action: climate.set_temperature
    target:
      entity_id: climate.thermostat
    data:
      temperature: "{{ state_attr('schedule.heating', 'temperature') }}"
```

## Installation

Add this repository to HACS as a custom repository of type **Dashboard**, or load `expressive-schedule-card.js` as a dashboard resource of type **JavaScript module**.

## Example

```yaml
type: custom:bubble-card
card_type: pop-up
hash: "#heating-schedule"
name: Heating schedule
icon: mdi:calendar-clock
popup_mode: centered
width_desktop: 720px
full_width_on_mobile: true
cards:
  - type: custom:expressive-schedule-card
    entity: schedule.heating
```

## Options

| Option | Default | |
|---|---|---|
| `entity` | | the schedule helper (required) |
| `attribute` | `temperature` | the block data key that holds the target |
| `min` / `max` | `10` / `25` | target range |
| `step` | `0.5` | target step |
| `frost` | `10` | at or below this, the target shows as a snowflake; `false` shows the number |
| `time_step` | `30` | minutes per step when moving a change |
| `max_changes` | | limit the changes per day, counting midnight (6 for a Hive receiver) |
| `handles` | `selected` | `selected` shows drag handles on the selected day only; `all` shows them on every day |
| `hash` | | the Bubble pop-up's hash, if the card can't find it by itself |

## Tests

```sh
npm install
npm test
```

## Licence

BSD 3-Clause. Copyright (c) 2026 Paul Owen.
