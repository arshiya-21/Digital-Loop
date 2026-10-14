# Digital Loop — Sandman header icon (final v1.0)

The header button that opens the Digital Loop Studio (the digital twin of the sand loop).

## Files
| Folder | File | Use |
|---|---|---|
| code/ | digital-loop-button.html | The button markup — paste into the header between the Bentonite box and "0% DONE" |
| code/ | digital-loop-button.css | Styles, animation, states (add to the header stylesheet) |
| code/ | digital-loop-button.js | `SandmanDigitalLoop.setState('live' / 'alarm' / 'offline')` |
| svg/ | digital-loop-icon-animated.svg | Icon with animation (live) — 24 × 24, currentColor |
| svg/ | digital-loop-icon-alarm.svg | Animated, red status |
| svg/ | digital-loop-icon-static.svg | No animation (documents, menus) |
| svg/ | digital-loop-icon-nodata.svg | Grey, no status dot |
| svg/ | digital-loop-badge.svg | App tile (green, white ∞) — launcher, login page, favicon |
| png/ | icon-16/24/32/48.png, badge-32/64/128/256/512.png | Bitmap versions (transparent) |

## Install (3 steps)
1. Add `digital-loop-button.css` and `digital-loop-button.js` to the header page.
2. Paste `digital-loop-button.html` into the header after the Bentonite box.
3. Set `href` to the Sandman route that serves the Digital Loop Studio (default `/digital-twin`).
   That page sets the logged-in customer before the Studio loads (see the Studio Developer Guide § 30):
   `window.SANDMAN_CONTEXT = { customer: {...}, defaultDb: {...} }`.

## Status
Call `SandmanDigitalLoop.setState(...)` when the twin's status changes:
- `live` — green dot, bead travelling round the ∞, dashes flowing (default)
- `alarm` — red dot and bead (an active alarm in the twin)
- `offline` — grey and still (no live data)

## Design
- 24 px grid, one 2 px stroke, round caps — same weight as the Sandman grid and bell icons.
- Solid half = the sand loop in the plant; dashed half = its digital twin; one continuous line.
- Green #23a047 (Sandman green), alarm red #e5332a, grey #8a949e.
- Motion: bead 3.2 s per loop, dashes 1.1 s (0.55 s on hover), status pulse 1.8 s. Motion is switched off
  automatically when the user has "reduce motion" set in the operating system.
- Keyboard: Tab focuses the button (blue focus ring), Enter opens the Digital Loop.
