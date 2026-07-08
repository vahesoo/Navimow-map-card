# Navimow Map Card

A Lovelace custom card for Navimow / Segway robot mowers in Home Assistant.

This card displays live mower position, current and previous mowing trails, history by day, channels, dock marker, optional aerial overlay calibration and mowing session legend.

## Installation through HACS

1. HACS -> Custom repositories.
2. Add this repository as a **Dashboard / Lovelace** repository.
3. Install **Navimow Map Card**.
4. If HACS does not add the dashboard resource automatically, add it manually:

```text
/hacsfiles/navimow-map-card/navimow-map-card.js
```

Resource type: **JavaScript module**.

If the old card is still shown after an update, refresh the browser cache or temporarily add a cache-busting query string, for example:

```text
/hacsfiles/navimow-map-card/navimow-map-card.js?v=rc1
```

## Minimal configuration

The preferred rc1 configuration is only the mower entity. The card auto-detects the matching Navimow sensors.

```yaml
type: custom:navimow-map-card
title: Navimow Map
mower_entity: lawn_mower.tont
auto_entities: true
```

The card tries to find these entities automatically from `lawn_mower.tont`:

```text
sensor.tont_position_x
sensor.tont_position_y
sensor.tont_heading
sensor.tont_mowing_zone  # fallback: sensor.tont_zone
sensor.tont_battery
sensor.tont_dock_x
sensor.tont_dock_y
```

Advanced users can still override any entity manually.

## Example with overlay and channels

See [`examples/map-card.yaml`](examples/map-card.yaml).

## rc1 highlights

- Select only the mower entity; matching sensors are auto-detected.
- Better default appearance and history values.
- Today / previous days history view.
- Session filtering with configurable mowing-day reset time.
- Short `unavailable` interruptions are ignored when detecting sessions.
- Trail legend with session start times.
- Optional aerial overlay calibration.
- Option to keep the aerial photo upright or keep mower coordinates fixed.
- Visual editor support.
- Fixed dock marker scaling so the icon stays centered on the dock.

## Main options

```yaml
mower_entity: lawn_mower.tont
auto_entities: true
history_view:
  enabled: true
  days_back: 4
session_filter:
  mode: today
  reset_time: "03:00"
trail_legend: true
session_gap_minutes: 20
session_interrupt_grace_minutes: 5
```

## Notes

The card uses Home Assistant Recorder history for previous trails. The visible history depends on your Recorder retention settings.
