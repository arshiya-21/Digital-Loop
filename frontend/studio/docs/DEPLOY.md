# Deploying SandMan Digital Loop Studio v9.19

## What to deploy
`SandMan_Digital_Loop_Studio_v9_19.html` (= `dist/sandman-flowsheet.html`) — one self-contained file (≈ 5.2 MB):
all code, styles, the equipment library and fonts' fallbacks are inside. No build step, no server code, no runtime
dependencies. Works from disk, any static web server, or embedded in the Sandman portal.

## Steps
1. Copy the HTML file to the Sandman web server, e.g. `/digital-twin/index.html`.
2. Serve it from the Sandman portal route `/digital-twin` (same origin as Sandman, so the session applies).
3. Before the Studio loads, the portal page sets the logged-in customer (Developer Guide § 30):
   ```html
   <script>
     window.SANDMAN_CONTEXT = { customer: { id: 'c-042', name: 'ABC Foundry' },
                                defaultDb: { name: 'Sandman', kind: 'SQL Server', server: '…', database: '…' } };
   </script>
   ```
4. Add the **Digital Loop** button to the Sandman header (separate package `Digital_Loop_Header_Icon.zip`:
   `code/digital-loop-button.html / .css / .js`, href `/digital-twin`).
5. PLC Tag Monitor: values come from `SandmanData` — set the backend adapter from the portal page, e.g. `SandmanData.setAdapter(ApiAdapter('https://<sandman>/api'))` (Developer Guide § 34). Until then the labelled simulation adapter is used.
6. Live data: point the Studio's data connections to the SandMan Gateway (REST / WebSocket) — until then values are
   simulated.

## Browsers
Tested on Chromium (Chrome / Edge), screens 1024 – 2560 px wide. Firefox and Safari: run `tests/` before rollout.

## Saved work
Each user's flowsheets are stored in their browser (localStorage, per customer). Use **Export** to move a flowsheet
between PCs; the app warns when browser storage is full.

## Verify after deploying
Open the page with `?tpl=twin` (or File › Templates › Sandman Digital Twin) → the foundry sand loop loads → **Publish** → the complete flow appears exactly as designed, centred; click SCADA-1 → its
table opens; Esc leaves publish. Developers: `python3 tests/run_all.py` (823 checks, all passing at v9.19).
