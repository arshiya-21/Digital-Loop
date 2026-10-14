# SandMan Process Flowsheet — Developer Guide

Version 1.0 · single-page application, vanilla JavaScript + SVG + Canvas 2D, no framework, no runtime
dependencies.

---

## 1. Architecture at a glance

```
            ┌──────────────────────── UI ────────────────────────┐
 library ── │ canvas (SVG)   properties panel   dock   dialogs   │ ── toolbar / header / status
            └────────┬───────────────────┬──────────────┬────────┘
                     │ render            │ read/write   │
              ┌──────▼──────┐     ┌──────▼──────┐  ┌────▼─────┐
              │ EQ library  │     │ DOC (layout)│  │ REG (tags)│──► VAL (live values + history)
              └─────────────┘     └─────────────┘  └────┬─────┘
                                                        │ val(id)
            simulation (simTick) ──or── gateway feed ───┘   ◄── replace for production
            shift history (histVal) ──or── historian API     ◄── replace for production
```

* **DOC** – the flowsheet document: equipment blocks, streams (lines), data sources, custom
  equipment definitions used, mass-balance settings. Serialised to JSON.
* **REG** – the tag registry: one object per tag (identity, limits, specification, data link).
* **VAL** – runtime only: current value and the last ~15 min of samples per tag.
* **EQ** – equipment type library (built-in + custom), each with ports, default tags and SVG drawing.

Everything reads values through **`val(id)`** (live) or **`histVal(id, t)`** (replay). Swapping the
data source means replacing those two functions' backing data — the UI does not change.

Render loop: `setInterval` 1 s in `13-main.js` → `simTick()` → `evalAlerts()` → `liveCanvas()` →
dock/header/tree updates. Structural changes call `changed()` → `save()` + `renderAll()`.

---

## 2. Source files

| File | Responsibility | Key functions |
|---|---|---|
| `00-core.js` | DOM/format helpers, line types `KIND` | `$`, `$$`, `fmtN`, `esc`, `clamp` |
| `01-equipment-library.js` | built-in equipment/instrument/widget types `EQ`, SVG drawings, mold-line/ladle cycle sync | `conveyorMolds`, `ladleOver`, `effRun`, `cycleOf`, `syncAnims` |
| `02-model.js` | state, geometry (size/rotate/flip), tags & simulation, alert engine, equipment state, doc ops, undo, persistence | `dims`, `ports`, `mkTag`, `val`, `simTick`, `tagSev`, `evalAlerts`, `bState`, `addBlock`, `connect`, `canConnect`, `snap`, `changed` |
| `03-templates.js` | built-in templates | `loadSandLine`, `loadFoundry` |
| `04-canvas.js` | SVG rendering, routing, HMI widget commands, all canvas interaction | `renderCanvas`, `liveCanvas`, `route`, `runCmd`, `bestPair`, `doConnect`, `select` |
| `05-panels.js` | library, tree, Properties, dock tables, header/status | `renderProps`, `renderDock`, `renderStatus`, `completeness` |
| `06-dialogs-toolbar.js` | modal framework, import/export, gateway, mode switch, view prefs, minimap | `openModal`, `closeModal`, `setMode`, `applyPrefs`, `layoutCols` |
| `07-reuse.js` | custom equipment designer, generic industry library, modules, copy/paste, multi-select, templates manager, control-chart data helpers | `regCustom`, `openDesigner`, `makeClip`, `pasteClip`, `openTemplates`, `useTplForm`, `ccData`, `ccRules` |
| `08-data-links.js` | data sources, link wizard, query generation | `sourcesForm`, `catalog`, `linkWizard`, `linkQuery` |
| `09-replay-data.js` | shift model, **sample history generator**, castings & genealogy, traceability tab | `shiftOf`, `histVal`, `moldAt`, `moldsIn`, `parseMold`, `chainFor`, `traceTab` |
| `10-replay-ui.js` | replay workspace, timeline, insights panel, casting follow mode | `enterReplay`, `buildReplayIndex`, `rpSet`, `rpDraw`, `openGenealogy`, `followCasting` |
| `11-mass-balance.js` | sand inventory & balance | `massOf`, `inventory`, `flows`, `openMB`, `mbOverlay` |
| `12-tag-spec-charts.js` | tag specification, bulk limits editor, tag form, CSV, σ-zone control chart | `spec`, `renameTag`, `tagLimitsForm`, `tagForm`, `csvForm`, `openTrend`, `drawTrend` |
| `13-main.js` | toast, main 1 s loop, data migration, initialisation | `toast`, `migRates` |

---

## 3. Data model

### 3.1 Flowsheet document (`DOC`)

```js
{
  name: 'Sand Handling & Molding Line',
  seq: 412,                       // id counter
  blocks:  [Block],
  streams: [Stream],
  sources: [DataSource],          // §6
  custom:  [CustomEquipmentDef],  // definitions used by this flowsheet (portable)
  mbCfg:   { newPct, coreTph, dustPct, spillPct, castPct, metalKg, moist, pxPerM },
  migRates: 1                     // one-off data migrations
}
```

**Block**
```js
{ id:'b12', type:'disaMini', name:'DISA-1', x:1026, y:508,
  w?, h?,            // size override for resizable types
  rot:0|90|180|270, flip:false, sc:1,    // rotation, mirror, display scale
  tags:[{ id:'DISA-1.MPH', show:true }], // bound tags (show = value badge on canvas)
  tagOff:{x,y},                          // badge offset
  props:{ desc, oos, hideName, label, group, target, rows, cols, inv:{…mass balance…}, manual },
  rules:[{ id, tag, op:'>'|'<', val, sev:1|2|3, delay, msg }] }
```

**Stream**
```js
{ id:'s3', name:'S3', from:{b,p}, to:{b,p}, kind:'sand'|'add'|'water'|'air'|'ret'|'metal'|'mold'|'cast',
  tag:null|'TAG.ID', mid:null|number /* manual route offset */ }
```

### 3.2 Tag (`REG[id]`)

```js
{ id:'SM-1.MOIST', desc:'Mix moisture', unit:'%', d:2,          // identity & display
  typ:3.4,                 // Optimal (centre line)
  min:3.0, max:3.8, sd:0.08, cfg:true,     // process specification (σ used by control chart)
  ll:2.8, lo:3.0, hi:3.8, hh:4.1,         // alarm limits
  src:'SandMan Gateway', addr:'ns=2;s=SM-1.MOIST',
  link:{ src, db, table, col, tall, keyCol, keyVal, tcol, scale, offset, stale, onStale },  // §6
  role:'moist', noise:.035, lab:0, cyc:null }   // simulation hints (remove with real data)
```

`spec(t)` returns `{min,max,opt,sd,cfg}`, falling back to alarm limits when Min/Max/σ are blank.

### 3.3 Equipment type (`EQ[type]`)

```js
{ type, cat:<index into CATS>, n:'Display name', pre:'DISA',   // auto-name prefix
  w, h, resize?:'w'|'h'|'wh', noflip?, widget?, inst?, notag?, batch?,
  ports:(w,h)=>[[id, side 'l|r|t|b', x, y, dir 'in|out|io', kind, required 0|1], …],
  tags:[[suffix, desc, unit, optimal, LL, L, H, HH, noise, role, decimals, labSample, cycle], …],
  props?:{…defaults},
  draw:(w,h,state,block,uid)=>svgString,     // static, animated with CSS classes
  dyn?:(w,h,state,block)=>svgString }        // redrawn every tick (levels, values, lamps)
```

Animation classes used in drawings (active only when the block is running in Monitor mode):
`spin`, `vib`, `slide` / `slide idx` (indexed mold string), `lift`, `ram`, `ramv`, `pop`, `glow`,
`beltd`, `sandflow`, `fall`, `tilt`, `pourstream`, `auger`.

---

## 4. Rendering & interaction

* `renderCanvas()` rebuilds the SVG layers (`#Lstreams`, `#Lblocks`, `#Ltags`, `#Lmass`, `#Ltrace`).
  Call it after structural changes. `liveCanvas()` only updates classes, dynamic parts and badges and
  never restarts CSS animations.
* `route(a,b,mid)` produces orthogonal routes (straight, L-shape or Z with an adjustable middle).
* `syncAnims()` gives each molding line its own cycle: **T = 3600 / molds-per-hour** of its molding
  machine, with a stable per-machine phase. Index ≈ 15 % of T, pour ≈ 60 % (keyframes `index`,
  `tilt`, `pourv`, `ram`, `pop`). `effRun()` stops a mold line when its DISA stops and a ladle when its
  line stops.
* Connections: `bestPair()` picks ports (direction, free, required, distance); `canConnect()` validates.

---

## 5. Alerts & control charts

* Severity per tag (`tagSev`): Critical at LL/HH, Warning at L/H, Advisory at 75 % of the way from
  Optimal to L/H. Custom rules per equipment (`rules`) with persistence delay.
* Alert lifecycle in `raise()`: raised → escalated → returned-unacknowledged → cleared on ack.
* Control chart (`openTrend`/`drawTrend`): Individuals + Moving Range. Centre = Optimal (or window
  mean); σ = configured `sd` (or MR̄/1.128, or sample σ). Zones ±1σ green, ±2σ yellow, ±3σ orange,
  beyond red. Western Electric rules 1–4 (`ccRules`). Cp/Cpk use Min/Max.

---

## 6. Integration points (production)

| Concern | Prototype | Replace with |
|---|---|---|
| Live values | `simTick()` generates values into `VAL` | Gateway feed (WebSocket/SSE) that writes `VAL[id].v` and pushes history; keep `val(id)` |
| Data-link config | stored on `REG[id].link`; `linkQuery()` builds SQL/OPC/MQTT/Modbus/REST | Gateway service reads the exported links (`Copy configuration (JSON)`) |
| Catalog browsing | `catalog(src)` returns a sample schema | `GET /sources/{id}/catalog` (databases → tables → columns / nodes) |
| Test connection | `testSource()` always succeeds (simulated) | `POST /sources/{id}/test` |
| Shift history | `histVal(id,t)` deterministic generator + `INCIDENTS` | `GET /history?tags=…&from&to&step` (historian), cache per shift |
| Events | derived from history in `buildReplayIndex()` | `GET /events?from&to` (alarms, operator actions, product changes) |
| Castings & genealogy | `moldAt()`, `moldsIn()`, `parseMold()`, `chainFor()` with fixed delays | `GET /trace/casting/{id}`, `GET /trace/equipment/{id}?from&to`, `GET /trace/batch/{id}`; resolve transport delays server-side |
| Defect results | rule-based model in `moldAt()` | inspection / scrap records joined on casting ID |
| Persistence | `localStorage` | SandMan DB with versioning (draft/published), users and audit trail |
| Panel commands (START/STOP) | change simulated `oos` | keep read-only, or route through an interlocked write-back service |

`localStorage` keys: `sandman-flowsheet-v2` (current flowsheet), `sandman-equip-lib`,
`sandman-templates`, `sandman-modules`, `sandman-clip`, `sandman-view`, `sandman-theme`, `sandman-gw`.

Suggested gateway payload for live values:
```json
{ "ts": "2026-10-05T10:15:02Z", "values": [ { "tag": "SM-1.MOIST", "v": 3.42, "q": 192 } ] }
```

---

## 7. Mass balance (green sand)

* Inventory = Σ `massOf(block, t)` over blocks counted as system sand:
  level × capacity (bins/hoppers), load ÷ 3600 × length ÷ speed (belts), batch (mixers), fixed hold-up,
  molds on line × sand per mold. Additive/bond equipment is detected by walking upstream from mixer
  additive inlets (`mbAddSet`) and reported separately.
* Balance (dry, t/h): in = new sand + core sand + bentonite + coal dust; out = dust + spillage + sand
  on castings + screen rejects. Measured change = 30-min regression on the averaged inventory;
  unaccounted = measured − (in − out).
* Per-block settings live in `block.props.inv`; plant settings in `DOC.mbCfg`.

---

## 8. Extension recipes

**Add a built-in equipment type** – add an entry to `EQ` in `01-equipment-library.js` with ports,
default tags and `draw`. Optional `MB_DEF[type]` in `11-mass-balance.js` for sand inventory.

**Add equipment without code** – use *＋ New equipment* (designer). Definitions are stored in the
library (`sandman-equip-lib`) and embedded in flowsheets that use them (`DOC.custom`).

**Add an HMI widget** – `EQ` entry with `widget:1`, `draw` for the static frame, `dyn` for live parts;
clickable elements carry `data-cmd`, handled in `runCmd()`.

**Add a data-source type** – extend `SRC_TYPES`, `catalog()` and `linkQuery()` in `08-data-links.js`.

**Add a template** – write a loader like `loadSandLine()` and register it in `BUILTIN_TPLS`
(`07-reuse.js`), or save one from the UI (*Templates → Save current flowsheet*).

---

## 9. Testing checklist

Build, then open `dist/sandman-flowsheet.html` and verify:

1. Template loads in Monitor mode; animations run; values update every second.
2. Design: drag equipment from the library, connect with **C**, resize via corner handle, undo/redo.
3. Properties → Tags: edit Min/Optimal/Max/σ, rename a tag, confirm limits.
4. Tag table → Trend: σ zones, rules, Cp/Cpk.
5. Data link wizard: SQL table, OPC UA nodes, tall table; review shows generated queries.
6. Replay: open, drag timeline, play/pause, follow a casting, back to live.
7. Sand balance: totals, zones, settings, overlay; also inside Replay.
8. Templates save/use, modules save/place, copy/paste between flowsheets, JSON export/import.
9. Present mode: full-screen layout, alarm bar, exit with Esc.

Known limitations: simulated data (see §6); one flowsheet open at a time; no multi-user editing;
browser storage only.

---

## 10. Version 1.1 — stacking order, locking, groups, click behaviour

**Stacking order.** `DOC.blocks` array order *is* the paint order: later entries draw on top.
`reorder(ids, how)` in `04-canvas.js` builds the new order on a copy, compares it with the current
one, and only then calls `pushUndo()` and assigns — so undo captures the state *before* the change.
`how` is `front` / `back` (move all the way) or `fwd` / `bwd` (one step, skipping over other members
of the same selection). `zSel(how)` is the UI entry point; it works on `selIds()`, so it applies to
a multi-selection. Bound to Ctrl+] / Ctrl+[ (one step) and Ctrl+Shift+] / Ctrl+Shift+[ (all the way)
in the keydown handler, and to four items in the block menu.

**Locking.** `block.lock === true` means the item cannot be moved. Enforced in three places in
`04-canvas.js`: the pointerdown handler hands back a `click` drag instead of a `move` drag,
`gmoveDrag()` filters locked items out of a group move, and the arrow-key nudge skips them.
Resizing, rotating, renaming and deleting are deliberately still allowed — it is a position lock, not
a freeze. `blockSVG()` draws a padlock badge in Design mode. `toggleLock(b)` applies to the whole
group when the item is grouped. The Properties → General tab carries a `#pLock` checkbox.

**Groups.** `block.grp` holds a group id (`g<seq>`). `groupArea(b)` assigns a fresh id to `b` plus
everything `insideOf(b)` returns — blocks whose bounding box sits fully inside `b`'s bounding box,
using `bBox()`/`dims()`. After that, pointerdown on any member selects the whole group (`grpMembers`)
and starts a `gmove` drag. `ungroup(b)` deletes `grp` from every member. `pasteClip()` remaps group
ids through `grpMap`, so a pasted copy forms its own group instead of joining the original.

**Area Box.** `EQ.areaBox` in `01-equipment-library.js` — an HMI widget (`cat: 8`, `resize: 'wh'`)
drawing a dashed rounded rect with an editable caption in `props.text`, edited via `widgetEditor()`
in `05-panels.js`. `addBlock()` in `02-model.js` `unshift`s it instead of pushing, so a new area box
lands at the back of the stack rather than covering the equipment it is meant to enclose.

**Click behaviour.** The block menu moved out of the `contextmenu` listener into
`blockMenuItems(b)`, so both buttons can use it. Left-click now opens that menu and right-click opens
the Properties panel — the reverse of the usual convention, by request, for touch-screen HMI panels.
The left-click menu is opened from `endDrag()` via `menuSoon()`, on a 260 ms timer that `dblclick`
and any subsequent pointerdown cancel; a drag never opens it, because `endDrag` checks `d.moved`.
Streams and empty canvas keep their original right-click menus.

**Removed.** The floating `.navpad` pan cluster and the `#bMap` overview-map button were removed from
`index.template.html`. Panning is still available by dragging, scrolling and the arrow keys; the
overview map is still toggleable from View settings (`#vMini`). The `.navpad` / `.mapbtn` CSS and the
`$('#bHome')` / `$('#bMap')` lookups are left in place but null-guarded, so re-adding the markup
restores both without touching the JS.

---

## 11. Version 1.2 — grouping any selection, ungroup, group frames, alignment guides

Additions only; nothing from 1.1 was removed or changed in behaviour.

**Selecting.** Ctrl / ⌘ + click now adds to or removes from the selection, like Shift + click. Clicking a
grouped item with Shift / Ctrl toggles its whole group. A Shift + drag selection box that catches part of a
group now takes the whole group (`endDrag`, `'marq'` branch).

**Group the selection.** `groupSel()` in `04-canvas.js` gives every selected block one new group id
(`'g' + DOC.seq++`). Members of groups that are only partly selected join the new group, so no group is
split. Entry points: toolbar **Group** button (`#bGroup`), **Ctrl+G**, and *Group selected items (n)* in the
block menu when more than one item is selected. `canGroupSel()` disables it when fewer than two items are
selected or the selection is already exactly one group. `groupArea(b)` (group everything inside an Area
Box) is unchanged.

**Ungroup.** `ungroupSel()` removes the group id from every group touched by the selection. Entry points:
toolbar **Ungroup** (`#bUngroup`), **Ctrl+Shift+G**, and *Ungroup* in the block menu (which now calls
`ungroupSel()`). Both buttons are enabled / disabled in `updateTb()` (`05-panels.js`) and wired in
`06-dialogs-toolbar.js`.

**Group frame.** `groupFrames()` draws a dashed violet frame with "Group · n items" around every group whose
members are all selected (Design mode). It is appended to `#Lblocks` in `renderCanvas()` and has
`pointer-events: none`. Style: `.grpframe` in the CSS.

**Alignment guides.** While moving one item (`'move'`) or a selection / group (`'gmove'`), `alignGuides()`
snaps the moving outline's left / centre / right and top / middle / bottom to the same lines of other items
within 6 screen pixels and `drawGuides()` shows the guide lines in `#Ltmp` (style `.aguide`). Area Boxes are
not used as targets. Hold **Alt** while dragging to switch the guides off. Locked items still do not move
(`gmoveDrag()` already filters them). Guides are cleared in `endDrag()`.

**Shortcuts added.** Ctrl+G group · Ctrl+Shift+G ungroup · Ctrl / ⌘ + click add to selection · Alt while
dragging = no guides.

**Testing checklist additions.**
10. Select three items with Shift / Ctrl + click → Group (button or Ctrl+G) → a dashed group frame appears.
11. Click any member → the whole group is selected; drag it → all members move by the same amount; Ctrl+Z
    puts them back.
12. Ctrl+Shift+G (or the Ungroup button) → items move separately again.
13. Shift + drag a box over part of a group → the whole group is selected.
14. Drag an item level with another → a pink guide line appears and it snaps; hold Alt → no guides.

---

## 12. Version 1.3 — Studio mouse style, selection resize, layout lock

Additions only. The v1.1 touch behaviour is kept as the **Touch HMI** mouse style.

**Mouse style** (`PREF.mouse`, View settings → *Mouse style*, saved in `sandman-view`). `studioMouse()` in
`04-canvas.js` returns true unless the style is `'touch'`. Default: `'studio'`.

| | Studio (desktop) | Touch HMI (v1.1) |
|---|---|---|
| Drag on empty canvas (Design) | selection box | pan |
| Pan | Space + drag, middle button, scroll | drag, middle button, scroll |
| Left-click an item (Design) | select | select + item menu (`menuSoon`) |
| Right-click an item (Design) | item menu (`blockMenuItems`, now with *Properties…*) | Properties panel |
| Ctrl+] / Ctrl+[ | bring to front / send to back | one step forward / backward |
| Ctrl+Shift+] / Ctrl+Shift+[ | one step forward / backward | to front / to back |

Shift + drag still draws a selection box in both styles (Shift adds to the current selection). Monitor mode is
unchanged in both styles (left-click still opens the item menu there). On macOS, Ctrl + click is treated as
"add to selection" in Studio style instead of a right-click.

**Selection resize.** Any multi-selection in Design mode shows a dashed frame with four corner handles
(`selFrame()`, `.selframe`, `.gsz`). Dragging a handle (`gscaleDrag()`, drag kind `'gscale'`) scales every
selected item's position and display scale (`sc`) from the opposite corner, keeping each `sc` within 0.3–4.
Locked items are not scaled. One undo step.

**Pan.** `SPACE` is set by separate keydown / keyup listeners at the end of `04-canvas.js` (ignored in inputs),
and the pointerdown handler starts a `'pan'` drag for the middle button or Space. Cursor: `#cv.space-pan`.

**Layout lock.** `DOC.lockAll` (saved with the flowsheet). Toolbar padlock `#bLockAll` → `toggleLockAll()`.
`layoutLocked()` / `lockedNotice()` block moving, group moves, selection resize, resizing, ports / connecting,
re-routing, tag-badge moves, delete, duplicate, rotate, flip, layer order, group / ungroup, arrow nudging, paste
and library drops; selecting, Properties and Monitor mode still work. Per-item `block.lock` is unchanged.

**Testing checklist additions.**
15. View → Mouse style = Studio: drag on empty canvas → selection box; Space + drag and the middle button pan.
16. Left-click selects (no menu); right-click opens the item menu with *Properties…*.
17. Select several items → corner handles → drag one → the whole selection scales; Ctrl+Z restores.
18. Ctrl+] / Ctrl+[ send the selection to the very front / back.
19. 🔒 Lock layout → dragging and Delete do nothing (a note explains); unlock restores editing.
20. Mouse style = Touch HMI → v1.1 behaviour (drag pans, left-click menu, right-click Properties).

---

## 13. Version 1.4 — mode names: Design · Simulate · Publish

Wording only; no behaviour changed.

| Before | Now | Internal name (unchanged) |
|---|---|---|
| Monitor (mode button) | **Simulate** | `MODE === 'monitor'`, button `#mMonitor`, `setMode('monitor')` |
| ▶ Present | **▶ Publish** | `PRESENT`, `setPresent()`, button `#bPresent`, `body.present` |
| Exit presentation | **Exit publish view** | `#pExit`, `#pExit2` |
| Status MONITOR · LIVE / PAUSED | **SIMULATE · LIVE / PAUSED** | `renderStatus()` |

Also reworded: "Flowsheet complete — ready to simulate", "Switch to Simulate or Publish to run it live",
"Simulate mode — START/STOP and ON/OFF buttons operate the simulated plant", the Simulate-mode hints in
Properties and the alerts table, the event-log entry "Simulate mode", the "Simulating with … unconnected
required ports" toast and the full-screen notice ("Use Focus or Publish instead"). Earlier sections of this
guide still say Monitor / Present — read them as Simulate / Publish. Internal names were kept so saved
flowsheets, preferences, CSS and integrations keep working.

---

## 14. Version 1.5 — free resize from all eight handles

**Handles.** A single selected item (Design mode, not a junction) shows eight handles — four corners and four
edge midpoints — drawn in `blockSVG()` as `.rs.rs-<nw|n|ne|e|se|s|sw|w>` with `data-hd`, `data-fx`, `data-fy`;
`sizeHandles()` re-positions them on zoom. Cursors per handle in the CSS.

**Free resize** (drag kind `'free'` in `04-canvas.js`). Works in display (screen-aligned) space, so rotation
is respected: an edge handle changes one side, a corner both; the opposite side / corner stays put (x / y move
when dragging the left or top). Only the dragged sides snap to the 10 px grid (Snap on). **Shift** keeps the
proportions. Minimum size: a quarter of the natural size. Tables with automatic height (`E.autoH`) only change
width. The new size is written to `block.w` / `block.h` (divided by `sc`, swapped for 90° / 270°). One undo
step; blocked when the layout is locked; still allowed for position-locked items (as in v1.1).

**Stretching fixed-size drawings.** Equipment without `E.resize` (and the fixed axis of `'w'` / `'h'` types) is
drawn at its natural size and stretched to the user's box: `drawDims(b)` in `02-model.js` returns
`{ dw, dh, sx, sy }`; `blockSVG()` wraps `draw()` / `dyn()` in `scale(sx sy)` and `liveCanvas()` redraws `dyn`
at `dw × dh`. `rawPorts()` scales port positions by the same factors, so connections follow. Resizable axes are
still drawn at the real size, as before.

**Testing checklist additions.**
21. Select an item → eight handles. Drag each edge and corner: it grows / shrinks on that side only.
22. Shift + corner → proportions kept. Ctrl+Z steps back through each resize.
23. Stretch a fixed-size item (e.g. the truck): the drawing stretches and its ports stay on its outline.
24. Rotate an item 90° and drag the right edge: it gets wider on screen. Locked layout: no resizing.

---

## 15. Version 1.6 — header redesign (option A: title row + grouped toolbar)

Layout only; every control keeps its id, title and handler.

**Title row** (`header.hdr.hdrA`): title and flowsheet name (`#docName`) · mode switch `.modesA` with
`#mDesign`, `#mMonitor` (Design · Simulate) and **Publish** (`#bPresent`, class `pubA`) · data status (`.gw`),
alarm counters (`#sevc`), clock (`#clk`).

**Tool row** (`div.tb.tbA`, one line): labelled groups `.grp` (buttons in `.gi`, caption in `.gl`):
File (`#selFile`) · Analyse (Replay, Sand balance) · Simulate (`#monCtl`: disturbance, Pause — class `grp-sim`,
shown only in Simulate) · Connect (Connect, line type — `grp-design`) · Edit (Undo, Redo, Rotate, Flip, Duplicate,
Group, Ungroup, Delete, Lock layout — `grp-design`) · Zoom (−, %, +, Fit) · View (Focus, Full screen, Properties,
View, Snap, Values).

**Mode-aware.** `setMode()` toggles `body.is-sim`: the Simulate group appears and the (disabled) Connect and Edit
groups are hidden, so the row stays on one line.

**Widths.** Fits on one line from 1280 px (checked at 1280 / 1366 / 1440 / 1600 / 1920, Design and Simulate).
Below 1700 px Replay, Sand balance and Connect show their icon only; below 1440 px groups tighten and Fit is
icon-only (tooltips keep every name).

**Testing checklist additions.**
25. Design: groups File · Analyse · Connect · Edit · Zoom · View on one line; Simulate: File · Analyse · Simulate ·
    Zoom · View.
26. Zoom −/+/Fit work; Publish hides the header, Esc returns; dark theme reads well.

---

## 16. Version 1.7 — Loop Studio–style brand block and side panel

**Brand block** (`.brandA`, as wide as the side panel): `sandman®` wordmark · Process Flowsheet · live mode
line `#brandMode` (Design mode · Simulating · Replay · Publishing) kept current by `syncBrand()` (`05-panels.js`,
called from `updateTb()`, `setMode()`, `setPresent()`). The flowsheet name moved next to it as a breadcrumb
(`.docA`, `SandMan › #docName`).

**Side panel.** Underline tabs *Equipment* / *Flowsheet* with an item count (`#treeCount`). Library: action bar
(New equipment, Templates, import / export) · search (`.libsearch`, **/** focuses it) · header with the tiles /
list switch (`.lview`, remembered in `sandman-libview`) and the visible count (`#libCount`) · category icon rail
(`#libRail`: All, My modules, each category with items) next to the list (`#libMain`). `renderLib()` filters by
`LIBCAT`; `renderLibRail()` (07-reuse.js) builds the rail, the category header (`#libCatHead`) and the count.
Drag-and-drop, click-to-place, edit (✎) and module delete are unchanged.

**Testing checklist additions.**
27. Brand shows Design mode / Simulating / Publishing as the mode changes; Flowsheet tab count follows the items.
28. Rail: pick a category → header and count match the items; search inside it; All shows every category.
29. List view and tiles view; the choice is remembered; dragging from either view adds equipment.

---

## 17. Version 1.8 — Loop Studio–style header (ribbon) and side panel; no module bar

**Title row:** brand (wordmark · Process Flowsheet · live mode) · quick bar (`.qbar`: Undo, Redo) · breadcrumb
(`SandMan › #docName`) · mode switch (Design · Simulate · Publish — only the active mode is highlighted, green
underline) · data status chip (opens data sources) · alarm counters (open Alerts) · clock · theme button
(`#themeBtn2`). The dark module bar is hidden (`PREF.rail`, View settings → SandMan module bar).

**Ribbon** (`#ribbon.tb.tbL`): tabs `[data-rt]` Home · Arrange · View · Simulate, panels `[data-rp]` with labelled
groups — Home: File, Connect, Edit (Duplicate, Delete), Layout (Lock) · Arrange: Transform (Rotate, Flip), Group,
Order (`#bFront`, `#bBack` → `zSel`) · View: Zoom, Show (Snap, Values), Panels (Properties, Focus, Full screen,
Text & panels) · Simulate: Run (`#monCtl`), Analyse (Replay, Sand balance). `setMode()` calls `ribbonForMode()`
(Design → Home, Simulate → Simulate). Collapse with the ˄ button, Ctrl+F1 or double-click a tab
(`body.rb-collapsed`, remembered in `sandman-ribbon`); while collapsed a tab click shows its panel on top
(`rb-peek`) until you click elsewhere.

**Side panel:** list view by default (picture · name · category, `.psub`), light thin scrollbars, footer
`.libfoot` ("Reusable SVG equipment").

---

## 18. Version 1.9 — side panel and header split (Loop Studio layout)

`#left` is now the first child of `.shell` (no longer inside `.work`) and starts with the brand block
(`.brandA.brandL`). `layoutCols()` toggles `.shell.has-left` (side panel shown, not in Replay / Publish, wider than
960 px): the shell then has two columns — the side panel spans every row on the left; title row, ribbon, work area
and status bar sit in column 2. `.work` now holds only the canvas column and the Properties panel. Title row and
brand row are both 50 px so their lines meet. Focus, Replay and Publish hide the side panel as before; below 960 px
it slides in from the left (☰).

---

## 20. Version 1.11 — opens empty; choose a reference loop

A first visit (nothing saved in this browser) opens an **empty flowsheet in Design mode** (`13-main.js`). The
empty-canvas card (`#fsEmpty`, shown by `syncBrand()` while there are no items) offers **Open reference loop ·
Sand handling & molding line** (`#feRef`) and **Choose a reference loop ▾** (`#feChoose`: the built-in templates
plus *More templates…* → `openTemplates()`). `openReference(t)` (07-reuse.js) loads the template as one undo
step, so Ctrl+Z returns to the empty flowsheet. A saved flowsheet still reopens as before. `?tpl=sand` /
`?tpl=foundry` open a reference loop directly (demos, tests).

---

## 21. Version 1.12 — Alerts / tables panel starts collapsed

The dock (`#dock`) starts with class `min`: only the tab bar shows (Alerts · Event log · Tag table · Stream
table, filters, ▴). `#bDock` toggles it; `syncDockBtn()` keeps the arrow (▴ / ▾) and its tooltip right.
`setDockTab()` (clicking a tab, or the alarm counters in the header) opens it on that tab.

---

## 22. Version 1.13 — publish view always fits, nothing scrolls

**Fit view** in the publish bar (`#pFit`) now fits the whole loop (`fit('page')`; it used `fit('width')`, which
let tall loops run below the bottom bar). In the publish view the plant is a fixed screen: the canvas wheel
handler ignores scrolling and Ctrl + wheel, dragging on empty canvas / middle button / Space do not pan, and a
ResizeObserver on `#cwrap` refits whenever the area changes size (full screen, window resize). `html, body` never
scroll. Design and Simulate keep scrolling, panning and zooming as before.

---

## 23. Version 1.14 — line appearance (Loop Studio choices)

Line properties have a **Line appearance** section (`lineLookSec()` in 05-panels.js): **End symbol** and
**Start symbol** pickers with the Loop Studio's ten symbols (`LINE_SYMS`: none, classic / open arrow, filled /
hollow triangle, filled / hollow circle, filled / hollow diamond, bar), **Line style** (`LINE_DASH`: solid, dashed,
dotted, dash-dot), **Width** (1–8 px) and **Colour**; **Default look** clears them; **Apply to all … lines** copies
the look to every line of the same type (one undo step). Saved on the stream as `startSym`, `endSym`, `dash`,
`width`, `color`; unset means the original look (filled arrow at the end — none into a junction — and the style of
the line type). Drawing: `lineMarker()` and the stream renderer in 04-canvas.js add per-line markers only when a
line has its own look. Read-only outside Design mode.

---

## 24. Version 1.15 — smooth, predictable canvas view

- **Fit never zooms in beyond 100 %** (`fit()` in 04-canvas.js caps k at 1), so a loop of one or two items is
  shown at normal size; the toolbar **Fit** shows the whole loop (Shift + Fit: width).
- **Gliding view:** `animateView()` eases tx / ty / k over ≈ 0.2 s for the zoom buttons, + / − / 0 keys, the
  zoom list and Fit. The mouse wheel / trackpad stays direct. Reduced-motion and Publish are instant.
- **No refit when panels change:** closing / opening Properties, Focus, the panel check-boxes, interface size and
  the Alerts panel no longer call `fit()`. A ResizeObserver on `#cwrap` keeps the point in the middle of the
  canvas in the middle when its size changes. First load uses `fit(null, true)` (instant).

---

## 25. Version 1.16 — zoom on the canvas

The zoom controls (`#bZo`, `#zsel`, `#bZi`, `#bFit`) moved out of the View tab into a floating pill at the
bottom-right of the canvas (`#zoomPill.zpill` inside `#cwrap`), as in the Loop Studio: − · zoom % · + | Fit.
Hidden in the publish view (which has its own Fit view). Same ids and handlers, so shortcuts and smooth zoom
(§ 24) are unchanged.

---

## 26. Version 2.0 — one application: Digital Loop Studio

The Process Flowsheet is now the final **SandMan Digital Loop Studio**: the Flowsheet core (equipment SVG library,
placement, equipment management, canvas) with the original Loop Studio's header, canvas interaction and data
connection workflow. New module: `src/js/15-inspector.js`.

**Selecting equipment** (`select()` in 04-canvas.js) opens the right panel on the **Equipment** view (`PTAB='eq'`),
opening the panel if it was closed (Design mode). HMI widgets keep their own editor.

**Equipment view** (`eqInspector()` / `bindEqInspector()`), one scroll, Loop Studio order:
1. *Equipment* — preview, equipment tag (name), description, show name, position / size / rotation / flip / lock
   (collapsible), Duplicate, Delete.
2. *Data connection* — **Source** (Simulated, every configured source, "Add or manage data sources…"),
   **Equipment data tag** (address prefix, hint per source family), **Map readings** (each reading's data tag =
   prefix + separator + its key, linked to the source), **Test connection**, **Browse…** (the existing link wizard),
   status "n of m readings linked". Stored on the block: `props.src`, `props.dtag`.
3. *Readings* — one card per bound tag (collapsible): live value, Demo / Linked chip; **Data** (source: same as
   equipment or its own → `bt.own`; data tag; demo value when simulated), **Name and units** (parameter, unit,
   decimals), **Limits** (Low-low, Low, High, High-high), **On the canvas** (show value, Trend, All tag settings…,
   Remove); **＋ Add reading** searches the tag registry or creates a tag.
4. *More settings* — Connections & inventory, Alert rules, Traceability, Prescription (the existing tabs).
`setTagLink(t, srcId, addr)` turns one address into the existing `t.link` (SQL/TS "db.table.col", MQTT topic
path, OPC UA / Modbus / REST address) and keeps `t.addr` / `t.src` in step, so the tag table, CSV, link wizard,
alarms and Replay keep working.

**Header (Loop Studio):** save state next to the name (`#saveSt`, wraps `save()`); ribbon **Data** tab: Data
sources, Test connections, Browse tags, Map all equipment, Use demo values, Tag table, Import / Export tags (CSV).
**Canvas (Loop Studio):** floating tool palette at the bottom (`#toolPal`): Select (V), Connect (C), Text label (T),
Area box (B), Add reading, Centre on selection. Visible names now say **Digital Loop Studio**.

---

## 27. Version 2.1 — a click only selects (Loop Studio)

In **Design**, clicking equipment selects it and the Properties panel does **not** open by itself any more
(pointer-down in 04-canvas.js and `select()` only open it when `PREF.autoProps` is on). The panel opens on
**double-click** (the dblclick handler now looks up the equipment under the pointer, because the first click
re-draws the canvas), **right-click → Properties…**, or the Properties button; while it is open it follows the
selection. The canvas hint says "*NAME* selected — double-click it (or right-click → Properties)…".
View settings → **Open Properties when I click equipment** (`PREF.autoProps`) restores auto-open. In **Simulate**
a click still shows the equipment's details.

---

## 28. Version 2.2 — flow animation styles (from the Loop Studio)

New module `src/js/16-flowfx.js`. The current animation stays the default (`default`); other styles:
**Particles, Direction arrows, Pulses, 3-D industrial pipe** (steel pipe with flanges, sheen, shadow and moving
grains), **Plant steel pipe**, **Granular sand**, **No animation**.
- Whole flowsheet: Simulate tab → **Motion** → *Line animation* (`DOC.flowStyle`) and *Speed* ½× – 3×
  (`DOC.flowSpeed`, CSS variable `--fxs`).
- One line: right-click a line → **Animation ▸**, or Line properties → *Animation*; `stream.anim` overrides the
  flowsheet style ("Same as flowsheet" clears it). *Apply to all … lines* and *Default look* include it.
- Drawing: the line renderer adds `fx-<style>` to the stream group, `flowUnder()` (pipe bodies, under the line) and
  `flowOver()` (moving parts). Arrows use a textPath on the line (`#sv_<id>`). Everything shows only while the plant
  runs (`.live .stream.flow`) — Simulate, Publish, Replay; Design shows plain lines.
- `FLOW_STYLES` is a `var` and 13-main.js redraws once after all modules load, because the first draw happens
  before this file runs.

---

## 29. Version 2.3 — no editing menus on the published screen

`menu()` (04-canvas.js) returns at once in the publish view (`PRESENT`), so neither the right-click nor the
left-click item menu, the line menu or the canvas menu appears for operators; HMI buttons, alarms and the publish
bar work as before. In Simulate the menus show only usable items (disabled design items and empty separators are
removed); Design is unchanged.

## 30. Customer context (multi-customer Sandman) — v4.9

The Studio separates three layers:

| Layer | What it holds | Where it lives |
|---|---|---|
| **Customer context** | logged-in customer and its **default database** | provided by Sandman at start-up; read-only in the Studio; never saved in a flowsheet |
| **Data sources** | **additional** connections (other SQL / time-series databases, OPC UA, MQTT, Modbus, REST) | `DOC.sources`, managed in Data › Data sources |
| **Equipment configuration** | readings → source + table + column | `REG[tag].link`; links to the default database store `src: "customer"` |

Because default-database links store `"customer"` (not a host or database name), the same loop opened by another customer resolves to that customer's own default database.

### Passing the context from Sandman (first match wins)

1. **Inject before the Studio loads (recommended)**
   ```html
   <script>
     window.SANDMAN_CONTEXT = {
       customer: { id: 'ACME', name: 'Acme Castings' },          // id: letters, digits, _ or - (max 40)
       user: { name: 'operator@acme' },
       defaultDb: { type: 'mssql', host: 'sql-acme.sandman.cloud', db: 'Acme_Sandman',
                    name: 'Customer default database', schema: [ /* optional table list */ ] }
     };
   </script>
   ```
2. **Embedded in Sandman (iframe)**: `studioFrame.contentWindow.postMessage({ type: 'sandman:context', customer: {...}, defaultDb: {...} }, studioOrigin)` — only messages from the parent window are accepted. JavaScript API: `SandmanStudio.setCustomerContext({...})`, `SandmanStudio.getCustomerContext()`.
3. **URL** (testing): `?customer=ACME&customerName=Acme%20Castings&db=Acme_Sandman&dbType=mssql&dbHost=…`
4. Otherwise the preview's demo customer ("Demo Foundry").

`type` is one of `mssql`, `postgres`, `mysql`, `oracle`, `influx`, `historian`. Malformed customer ids are rejected (never "cleaned" into another id). A context for a different customer reopens the Studio in that customer's space; for the same customer it only updates the details.

### Behaviour
- Browser storage (flowsheet, My loops) is namespaced per customer id; the demo customer keeps the original keys.
- Equipment Properties › Data connection pre-selects **★ Customer default · <db>**; its tables load automatically (from `defaultDb.schema`, or — in the preview — the standard SandMan tables). Additional data sources follow in the Database list.
- Data › Data sources shows the default database first as a read-only card ("Managed by Sandman", Test connection only).
- The header chip shows the customer; it opens the context (customer, default database, provided by, linked readings).
- Credentials are never part of the context or the flowsheet; the SandMan Gateway resolves them server-side.
- Code: `src/js/00b-customer.js` (context), `08-data-links.js` (`SRC('customer')`, catalogue, link text), `15b-db-tags.js` (pre-selection), `15-inspector.js` (source lists).

## 31. Feature map v2.4 → v4.9 (where to look)

| Version | Feature | Main files |
|---|---|---|
| 2.4 | Brand block: stacked lockup + mode pill | index.template.html, 05-panels.js (`brandMode`) |
| 2.5 / 3.2 | SandMan equipment library (147 drawings, 5 colour styles, animation pack, lazy unpacking, Auto/Full/Still animation) | 07b-sandman-library.js, tools/make_sandman_library.py |
| 2.6 | "Replay" shown as "Traceability" (internal names unchanged) | 05, 10 |
| 2.8 | Fast drag (only moved items redraw), paste at pointer, dock width, palette / zoom overlap | 04-canvas.js (`moveSoon`, `fastMove`), 07-reuse.js |
| 3.0 | Option A colour ribbon: Home / Insert / Help, My loops (Open / Save), Show options, shapes, Find, Flow on pipe | 17-ribbon.js, 01 (`shapeDef`) |
| 3.1 | Side panel A: coloured category rail, tiles | 07-reuse.js (`CAT_COL`, `catIc`) |
| 3.3 | Plant look (9 looks, saved per flowsheet) | 17-ribbon.js (`LOOKS`), CSS `#cwrap[data-look]` |
| 3.4 | Floating tool palette removed (shortcuts kept) | 15-inspector.js |
| 3.5 | Belt conveyor: moving sand | tools/make_sandman_library.py (`PATCHES`) |
| 3.6 / 3.8 / 3.9 | Create Loop from Image: upload, Claude analysis, review (confidence / not found), generate, compare; reasons when AI unavailable; Claude-chat paste route | 18-loop-from-image.js |
| 3.7 / 4.4 / 4.6 / 4.7 | Line routing (Orthogonal, Auto, Free, Straight, Curve), bends, segment moves, line menu, symbol picker grid with ✕ | 03b-routing.js, 04-canvas.js (`menu`) |
| 4.0 | Control & IT asset set, Data / network line type with moving packets, IIoT reference loop | tools/make_control_it.py, 16-flowfx.js, 03-templates.js (`loadIIoT`) |
| 4.1 / 4.3 / 4.8 | Alarm frames, header counters / clock, empty-card buttons removed | CSS, index.template.html |
| 4.2 | Equipment panel: Database → Table → Tag + | 15b-db-tags.js |
| 4.5 | Independent data labels (own positions, select, nudge, leader lines) | 04-canvas.js (`tagLayout`, `freezeTags`) |
| 4.9 | Customer context and default database; labels no longer rebuilt every second | 00b-customer.js, 08, 15b, 04 (`liveCanvas`) |

Test files: one per feature area (`tests/fs_test12.py` library … `fs_test25.py` customer context); `python3 tests/run_all.py` runs them all.

## 32. Feature map v5.0 → v6.8

| Version | Feature | Main files |
|---|---|---|
| 5.0 | Legend: larger text, width-aware layout | 01-equipment-library.js (`legend.draw`) |
| 5.1 | Drag the line itself to move a segment; new lines start in Auto routing | 04-canvas.js, 03b-routing.js (`nearestSeg`) |
| 5.2 | Custom copies of SandMan drawings keep their picture (`def.src`, repair by file name) | 07-reuse.js (`dzFromBuiltin`), 07b (`smlibIdOf`) |
| 5.3 | Valves / fittings dropped or dragged onto a line are inserted into it | 03b-routing.js (`inlineTarget`, `insertInline`, `tryInline`) |
| 5.4 | Points inside nested `<svg>` drawings converted; moulding & pouring line points; copies use picture edges | tools/make_sandman_library.py (`nested_port_map`, `PORT_OVERRIDE`), 07-reuse.js |
| 5.5 / 5.6 | Intensive mixer and sand muller (picture) batch animations | generator `PATCHES` (`add_mixer_life`, `add_muller_picture_life`) |
| 5.7 / 5.8 | Paint colours (red / blue / green): picture = duotone filter, vector = re-hued steel; shakeout knockout animation | 07b (`SMLIB_PAINTS`, `SMLIB_PAINTABLE`, `smlibRehue`), generator (`add_shakeout_life`) |
| 5.9 / 6.0 | Publish view: enlarges up to 400 %, Fill screen (spread) / Whole loop / Fill width | 04-canvas.js (`fit`), 05b-present-fill.js, 17-ribbon.js |
| 6.1 | Follow the feed (Idle — no feed) and group control (start / stop together, sequence, interlock) | 05c-follow-groups.js, 01 (`IDLE`, `effRun`), 02 (`bState`, `isRun`), 15-inspector.js |
| 6.2 | Review fixes: save on close + full-storage warning, library search, ribbon / header fit | 02-model.js (`saveNow`), 07-reuse.js, template, CSS |
| 6.3 – 6.8 | Water tank (foundry, tank only, 5 colour styles, own tiles, WT-n); muller water-in point | tools/make_extra_assets.py, generator (`extra`, `extra-<style>`), 07b |

Runtime state that is never saved: `IDLE` / `IDLE_SINCE` (follow the feed), the publish spread (`SPREAD`), picture URLs.
Saved additions: `DOC.groups` (group name / ctl / delay), `b.props.follow` / `runout`, `b.props.paint`, `b.tags[i].pos`, `s.pts` / `s.route`.

Tests: `python3 tests/run_all.py` (32 files, 602 checks in v6.8). Running all takes ~10 min; individual files 10–60 s.

## 33. Feature map v6.9 → v8.3

| Version | Feature | Where to look |
|---|---|---|
| 6.9 | Control panel (SYS) row editor: cards, chips, search, move / clear | `05-panels.js` (`.cpr` markup + handlers), css `.cpr*` · tests `fs_test34` |
| 7.0 / 7.3 | Publish keeps touching items joined and every line's drawn shape (frozen geometry `SPREAD.geo`) | `05b-present-fill.js`, `streamGeom()` in `04-canvas.js` |
| 7.1 | ◆ data connection point on plant equipment (`portOf(b,'@data')`, `dataPort()`), data lines only on data points, `fixDataEnds()` repair; rounded corners `roundedD()`, chevrons `lineChevrons()`, `alignNewLine()` | `02-model.js`, `04-canvas.js` · `fs_test35` |
| 7.1 / 7.4 | SCADA › Collected data (`collectedFrom()` walks the data network through PLC / gateway …); publish click → table pop-up (`openCollected()`), Simulate right-click › Collected data… | `15c-collected.js` · `fs_test35` |
| 7.2 | Data lines can change direction (`reverseStream()`) | `05-panels.js` |
| 7.5 | Library: Sand additive bin / ACK sand bin (no text) — `sandBinPlain`, `ackBinPlain` | `01-equipment-library.js` |
| 7.6 / 7.7 | Bucket elevator (blue) as a library drawing `tools/extra/sm-bucket-elevator-blue.svg` (id `sm6_sm_bucket_elevator_blue`) | generator `tools/make_sandman_library.py` · `fs_test29` |
| 9.0 | Digital Twin foundry sand loop `loadSandTwin()` (`?tpl=twin`, `BUILTIN_TPLS[0]`); sample tags via `mkTag` (src "Sample data (demo)"); legend `props.items` | `03-templates.js`, `07-reuse.js` · `fs_test37` |
| 8.9 | Publish page: `DOC.page = {preset,w,h,x,y}`, frame `renderPageFrame()` (`#pgframe`), `moveLoopIntoPage()`, `zoomToPage()`; `presentFit()` maps the page 1 : 1 when set | `05e-publish-page.js` · `fs_test36` |
| 8.6 | PLC (sky blue) as a library drawing `tools/control-it/ct-plc-skyblue.svg` (id `sm6_ct_plc_skyblue`, prefix PLC) | generator · `fs_test29` |
| 8.0 – 8.7 | **Publish view** (`presentFit()` in `05d-present-view.js`): since v8.7 a "contain" fit — one scale (`VIEW.k`, `VIEW.ky` = null), the complete drawn flow (`presentDrawn()` measures `#Lstreams`, `#Lblocks`, `#Ltags`) as large as fits with an 8 px margin, ≤ 300 %, centred (v8.8: no sheet frame — `presentSheet(null)`); resize observer refits. `presentArrange()` (v8.3) and the stretch (v8.5) are kept in code but not used | `05d-present-view.js` · `fs_test30`, `fs_test31` |

Publish view in short (v8.7): `presentFit()` fits the complete drawn flow uniformly (contain), centres it, draws the
and refits on resize. The design is never changed — the published flow is exactly as finalised.

## 34. Equipment → PLC → SCADA data mapping and the PLC Tag Monitor (v9.5)

Module `15d-plc-monitor.js`. Icons are visual only; values come from the **data service**.

* **Identity** — `b.props.dmId` is the stable id (`EQ-…`, `PLC-…`, `SCADA-…`), created on first configuration and never
  derived from the name, so renaming never breaks a mapping. `b.props.dmName` is an optional display name.
* **Mapping** (saved with the flowsheet, separate from material and data lines):
  `DOC.dmap.tags = [{ tag_id, address, param, equipment_id, plc_id, type, unit, prec, sim }]` — `tag_id` is unique; the
  same `address` may exist on two PLCs. `DOC.dmap.scada = { [scada_id]: { plcs: [plc_id, …] } }`.
* **Data service** — `SandmanData.subscribe(specFn, cb)` → unsubscribe; polling starts with the first subscriber and stops
  with the last. `SandmanData.setAdapter(adapter)`. Adapter contract: `read({ tags, plcs })` → Promise of
  `{ tags: { [tag_id]: { v, q: 'Good'|'Stale'|'Bad', ts } }, plcs: { [plc_id]: { status: 'Connected'|'Disconnected', since } }, at }`.
  `SimAdapter` is the labelled simulation (`SimAdapter.setConnected(plc_id, false)` simulates lost communication).
  `ApiAdapter(base)` posts to `{base}/tags/snapshot` — the SandMan backend reads the PLCs; the browser never does.
  To go live: `SandmanData.setAdapter(ApiAdapter('https://<sandman>/api'))` from the embedding page.
* **Links (v9.6)** — the monitor uses the union of explicit links (Properties: `DOC.dmap.scada`, `DOC.dmap.plcEq`) and
  data lines (`dmLineLinks()`); an equipment's own Studio tags (`b.tags` / `REG`) appear under the PLC that reads it
  (`dmAutoTags`), read from the Studio simulation. `dmStdTags(plc_id)` creates standard tags for linked equipment.
* **Rules** — lost communication keeps the last value and its real timestamp and marks it Stale (never zero, never
  fresh); a failing adapter shows "Data service error" and keeps the last values. The monitor is read-only.
* **UI** — Design: right-click › Configure data… (`dmConfigure`) / View tags…; Publish: click SCADA / PLC / equipment
  (`openPlcMonitor({ scada_id | plc_id | equipment_id })`). Demo: `?tpl=plcmon`. Tests: `fs_test38`.

## 35. Feature map v8.4 → v9.16 (where to look)

| Feature | Version | Where |
|---|---|---|
| Publish view: one "contain" scale, framed page, same look as the canvas | 8.4–8.8 | `05d-present-view.js` (`presentFit`, `presentDrawn`) |
| Publish page (`DOC.page`, Full HD 1:1, frame, *Move loop into page*) | 8.9 | `05e-publish-page.js` (`renderPageFrame`, `moveLoopIntoPage`, `pageOutside`) |
| Zones drawn under the lines; zone styles `props.zstyle` = dashed · panel · title; number badge `props.num` | 9.1 / 9.4 | `04-canvas.js` (`#Lzones`), `01-equipment-library.js` (`areaBox.draw`), CSS `.zone-*` |
| Legend with own items `props.items` (`['#rrggbb', 'label']`) | 9.0 | `01-equipment-library.js` (`legend.draw`) |
| Legend wraps over 2+ rows when the entries do not fit at ≥ 9 px; height resizable | 9.16 | `legend.draw` (`need`, `fitFs`, `chunk`) |
| Short value-label text (`REG[id].short`, e.g. SPEED 62 rpm) | 9.3 | `04-canvas.js` `tagLayout` |
| Value cards per flowsheet (`DOC.tagStyle = 'card'`) | 9.4 | `tagLayout`, `tagsSVG`, CSS `.tagg.card` |
| Status text (`REG[id].states = {1:'RUNNING',0:'STOPPED'}`) in labels and the tag monitor | 9.9 | `tagLayout`, `15d-plc-monitor.js` `pmFmtVal` |
| Colour style per item (`props.smpal`): library button with a selection, Properties › Appearance, right-click | 9.7 | `07b-sandman-library.js` (`smPalTargets`, `setPalFor`, `smPalPropMount`, `smPalMenuFor`) |
| ◆ data point also on SandMan library drawings | 9.5 | `02-model.js` `dataPort` |
| PLC Tag Monitor, data mapping, `SandmanData` service (§ 34) | 9.5 | `15d-plc-monitor.js` |
| Links from Properties and data lines; equipment's own tags in the monitor; standard tags | 9.6 | `15d-plc-monitor.js` (`dmLineLinks`, `dmScadaPlcs`, `dmPlcEquip`, `dmAutoTags`, `dmStdTags`, `dmPropsMount`) |
| Batch sand mixer station (animated SVG) | 9.4 | `tools/extra/sm-batch-mixer.svg` → `make_sandman_library.py` → `07b` |
| Empty canvas: *Open DemoLoop* / *Other sample loops…* | 9.10 | `src/index.template.html` (`#fseDemo`, `#fseMore`), `07-reuse.js` |

## 36. Demo loops (built-in samples)

* **Digital Twin loop** and **DemoLoop** — `loadSandTwin(opt)` in `03-templates.js` (`opt.demo` adds the Control & IT zone,
  4 PLCs → SCADA-1 and demo data on every equipment). Layout, connections, sample tags and label positions are all in
  this one builder; `?tpl=twin` / `?tpl=demoloop`. Tests `fs_test37`, `fs_test41`.
* **DemoLoop 2** — a customer's own flowsheet export, finished and stored as data: `src/js/03c-demoloop2.js`
  (`const DEMOLOOP2 = {DOC, REG}`, `loadDemoLoop2()`), `?tpl=demoloop2`. The original export and the finished version
  are in `tools/demos/`. Test `fs_test42`.
* **DemoLoop3** — `src/js/03d-demoloop3.js`, generated from DemoLoop 2 by `tools/demos/demoloop3_from_demoloop2.js` (PLC
  positions, plant network with switches SW-1 / SW-2 and junctions J-N1 / J-N2, fixed `route: 'orth'` data-line paths). Test `fs_test43`.
* **To add another customer loop:** have the customer use *Home › Export ▾ › Copy flowsheet JSON…*; load it in the
  Studio (same steps as `importForm`: `registerDocCustom`, `DOC`, `REG`, `ensureVal`), apply fixes with the normal
  model API (`connect`, `addBlock`, `portOf`, `dims`), validate the process graph and label overlaps, then store the
  result like `03c-demoloop2.js` and add an entry to `BUILTIN_TPLS` in `07-reuse.js` (+ `?tpl=` in `13-main.js`).
* **Dummy alarms** — `REG[id].hold = value` keeps a tag at that value in the simulation (02-model.js `simTick`,
  `seedHist`, `ensureVal`), so the normal limits raise the alarm (DemoLoop3 uses four). Remove `hold` to return to normal. The alarm list offers *Add / Clear demo alarms*
  (05-panels.js `renderOvl`, `demoAlarmTags`, `setDemoAlarms`) — sample-data tags only.
* Sample data rules: `src: 'Sample data (demo)'`, limits chosen so demo values never alarm (check cycles `cyc` too),
  one or two values shown per equipment, the rest in Properties and the tag monitor.
