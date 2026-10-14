# SandMan® Digital Loop Studio — v9.19

Design, simulate and publish foundry green-sand loops (and any process flow) in the browser:
an animated equipment library (150 SandMan drawings in 5 colour styles, incl. a Control & IT set, a foundry water
tank a blue bucket elevator and a sky blue PLC; red / blue / green paint for the muller and shakeout), free line routing with rounded
corners and direction chevrons, data connection points and SCADA collected-data tables, valves dropped into lines,
readings linked to the customer's databases, follow-the-feed and group start / stop, Create Loop from Image (AI),
traceability, sand balance, alarms and a full-screen operator (publish) view showing the finalised flow exactly as designed.
One self-contained HTML file, no runtime dependencies.

## Quick start

```bash
node build.mjs                      # or: npm run build   → dist/sandman-flowsheet.html
open dist/sandman-flowsheet.html    # works from disk; deploy / embed this single file
```

Development:

```bash
npm run watch      # rebuild on every change in src/
npm run serve      # http://localhost:8080 (dist/index.html + app.js + app.css, for debugging)
npm run test       # all browser checks (needs: pip install playwright && python -m playwright install chromium)
                   # v9.19: 41 test files · 842 checks, all passing
```

Node ≥ 18 for the build. Python ≥ 3.10 + Playwright for the tests.

## Layout

```
src/
  index.template.html        page shell (header, ribbon, panels, dialogs); CSS / JS injected at build
  css/sandman-flowsheet.css  all styles (later sections override earlier ones; each block is labelled vX.Y)
  js/                        concatenated in file-name order into one script
    00-core.js               helpers, line types (KIND)
    00b-customer.js          customer context (multi-customer Sandman login, default database)      v4.9
    01-equipment-library.js  built-in equipment, shapes, placeholder type
    02-model.js              document model, undo / redo, save
    03-templates.js          reference loops (sand line, foundry, IIoT communication)
    03b-routing.js           line routing modes, bend / segment editing, line menu, valves into lines  v3.7 / v5.3
    04-canvas.js             canvas rendering + interaction (drag, fast move, labels, menus)
    05-panels.js             properties, dock tables, header
    05b-present-fill.js      Publish view "Fill screen" (temporary spread layout, never saved)          v6.0
    05c-follow-groups.js     follow the feed (Idle — no feed), group control: start / stop together, interlock v6.1
    06-dialogs-toolbar.js    dialogs, File actions, view settings
    07-reuse.js              custom equipment designer, templates, library panel, copy / paste
    07b-sandman-library.js   GENERATED — SandMan drawings (data) + runtime (colour styles, animation)  do not hand-edit the data part
    08-data-links.js         data sources, catalogue, links
    09/10                    traceability data + UI
    11-mass-balance.js       sand balance
    12-tag-spec-charts.js    tag specs, control charts
    13-main.js               start-up, timers
    15-inspector.js          Equipment panel (data connection, readings)
    15b-db-tags.js           Database → Table → Tag + flow                                             v4.2
    16-flowfx.js             line animation styles, data packets on network lines
    17-ribbon.js             Option A ribbon: Home / Insert / Help, My loops, Plant look, show options
    18-loop-from-image.js    Create Loop from Image (Claude "sample" capability, review, generate)    v3.6
dist/                        build output (do not edit)
docs/DEVELOPER_GUIDE.md      architecture, data model, integration (§ 30 customer context), feature map (§ 31)
tests/                       fs_test*.py browser checks, run_all.py, fixtures/ (sample loop image + analysis)
tools/
  make_sandman_library.py    regenerates the data part of src/js/07b-sandman-library.js from the libraries
                             (PATCHES: belt sand, intensive mixer, muller picture, shakeout; PORT_OVERRIDE; nested <svg> ports)
  make_control_it.py         draws the Control & IT SVG set → tools/control-it/*.svg
  make_extra_assets.py       draws our own extra drawings (water tank) → tools/extra/ + tools/extra-<style>/
  control-it/, extra*/       generated drawings (included automatically by make_sandman_library.py)
CHANGES.md                   version history v1.1 → v6.8
```

## Equipment library — regenerate after new drawings

The five SandMan libraries are separate downloads (studio versions). With them unpacked:

```bash
python3 tools/make_control_it.py          # only if the Control & IT drawings changed
python3 tools/make_extra_assets.py        # only if the water tank (or other extra drawings) changed
python3 tools/make_sandman_library.py  L6/studio  own=L7/studio  dark=L1/studio  steel=L2/studio  blue=L4/studio
node build.mjs
```

Library 6 (painted by function) is the base; for the other colour styles only drawings that differ are stored
(gzip + base64, unpacked in the background). Generator patches (e.g. moving sand on the belt conveyor) live in
`PATCHES` in the generator so they survive library updates.

## Integration with Sandman

- **Customer context** — pass the logged-in customer and its default database before the Studio loads
  (`window.SANDMAN_CONTEXT`), by `postMessage({type:'sandman:context', …})` from the embedding page, or with
  `SandmanStudio.setCustomerContext()`. See DEVELOPER_GUIDE § 30.
- **Live values** — the browser cannot reach PLCs or databases; the SandMan Gateway must serve values. Links are
  stored per reading (`REG[tag].link`: source, database, table, column, row key). Values are simulated until then.
- **AI (Create Loop from Image)** — uses the viewer's Claude account when the Studio is published on claude.ai
  (`sample` capability); everywhere else the "Analyse with Claude chat" route (copy instructions / paste answer)
  works. The image is never stored on a server; a small JPEG reference is kept in the flowsheet.

## Important

- Do not edit `dist/` — run the build.
- Keep ids, saved flowsheets and exports compatible (every version so far opens older files).
- Passwords are never stored in the flowsheet — data sources hold a credential *reference* resolved by the gateway.

## Demo loops (v9.19)

* **DemoLoop** — `?tpl=demoloop` — sand loop + Control & IT (4 PLCs → SCADA-1), demo data on every equipment.
* **DemoLoop 2** — `?tpl=demoloop2` — the customer's own flow, finished: return silos, melting + pouring per line,
  sand-quality readings (compactability, moisture, GCS, AC, set point / actual, cooler inlet / outlet / ambient).
* **Sandman Digital Twin** — `?tpl=twin`. **Tag monitor demo** — `?tpl=plcmon`.
* Developer guide § 34 (PLC Tag Monitor and data service), § 35 (feature map v8.4 → v9.19), § 36 (demo loops).
