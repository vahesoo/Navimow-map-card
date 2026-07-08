# Navimow Map Card

An advanced Home Assistant Lovelace map card for Navimow robot mowers featuring live tracking, trail history, aerial map overlays, interactive calibration, mowing session history, channel visualization and many customization options.

---

## About

Created by **Toomas Vähesoo**.

Originally developed for personal use to extend the capabilities of the Navimow Home Assistant integration. This project is shared with the Home Assistant community under the **MIT License** and is intended to be easy to use, modify and further develop.

Although I'm not a professional software developer, I enjoy solving real-world problems and building practical tools for Home Assistant. The map card was created because I wanted features that were not available in the original application or integration.

Contributions, suggestions and improvements are always welcome.

---

# Features

- Live mower position
- Live heading and mower rotation
- Dock location
- Current and historical mowing trails
- Multi-day trail history
- Trail legend with mowing sessions
- Session filtering (Today / Previous days)
- Interactive aerial image calibration
- Overlay image support
- Pinch-to-zoom
- Pan support
- Visual editor
- Automatic entity detection (only the mower entity is required)
- Channel visualization
- Custom dock icon
- Fully customizable colors and trail appearance
- Zone names
- Appearance presets (coming in future releases)

---

# Installation (HACS)

1. Add this repository as a **Custom Repository** in HACS.

Category:

```
Dashboard
```

2. Install **Navimow Map Card**.

3. Restart Home Assistant frontend if required.

4. Add the card to your dashboard.

Example:

```yaml
type: custom:navimow-map-card
mower_entity: lawn_mower.your_mower
```

The card will automatically detect all available Navimow sensors belonging to the selected mower.

---

# First setup

The map card works immediately after selecting a mower entity.

Optional features include:

- aerial map overlay
- calibration
- mowing channels
- custom colors
- trail history
- session filtering

---

# Example configuration

```yaml
type: custom:navimow-map-card

title: Navimow Map

mower_entity: lawn_mower.your_mower

overlay_image: /local/my_map.png

calibration:
  - m: [0.158, -2.748]
    px: [374, 430]
  - m: [-29.640, 2.812]
    px: [208, 259]

channel_entities:
  - binary_sensor.your_gate_channel

zone_names:
  "13": Yard
  "24": Street
```

---

# Calibration

Calibration mode allows the aerial image to be aligned with the mower coordinate system.

1. Enable Calibration Mode.
2. Drive the mower to a known position.
3. Click the corresponding point on the aerial image.
4. Repeat with a second point.
5. Apply the calibration.

Only two reference points are required.

---

# Channel visualization

The card supports displaying configurable "channels" on the map.

Channels are configured through the Navimow integration.

Each configured channel automatically appears on the map and can be used for automations such as automatic gate control.

---

# Trail history

The card supports multiple history modes.

Examples:

- Today
- Yesterday
- Previous days

Sessions can be filtered using configurable reset times.

---

# Visual editor

Most settings can be configured directly from the Home Assistant visual editor.

Examples include:

- mower entity
- overlay image
- trail colors
- trail widths
- opacity
- dock icon
- channel appearance
- zoom
- history options

---

# Roadmap

Planned features include:

- Coverage heatmap
- Error heatmap
- Multi-mower support
- Automatic presets
- Trail highlighting
- Playback mode
- Coverage age map
- Geographic coordinate mode

---

# Credits

This project was inspired by the original Navimow Home Assistant integration and has evolved into a standalone Lovelace map card with many additional features.

Special thanks to everyone in the Home Assistant and Navimow communities who provided ideas, testing and feedback.

---

# License

This project is licensed under the **MIT License**.

Feel free to use, modify and improve it.

If you build something interesting on top of it, I'd love to hear about it!
