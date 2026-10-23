/**
 * Re-apply the Digital Loop changes on top of a fresh upstream drop, then build.
 *
 * A new drop of the studio is copied into `src/` wholesale and this puts our
 * changes back. There is only one upstream file to patch now — the page shell
 * — because v6.8 has a real integration seam: `window.SANDMAN_CONTEXT` for the
 * customer and its database, and classic-script globals (`snap`, `restore`,
 * `setMode`, `save`) that our module can call without being spliced into the
 * app. Everything else of ours lives in `../app/sandman/`, which the build
 * never touches.
 *
 *     node patch.mjs          patch the template and build into ../app
 *     node patch.mjs --check  say what is and is not applied, change nothing
 *     node patch.mjs --watch  the same, again on every change under src/
 *
 * There is no dev server. The studio must be served by the backend: the page
 * carries `window.SANDMAN_CONTEXT` — the foundry and its database — written in
 * from the session cookie as the backend serves it, so anything else handing
 * out the same files produces a page with no session and no plant. The loop is
 * therefore: run the backend, leave this watching, and reload the browser.
 *
 * Idempotent: "already applied" is decided on the replacement being present,
 * not on the anchor being gone.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync, watch } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, 'src', 'index.template.html')
const APP = join(HERE, '..', 'app')
const check = process.argv.includes('--check')
const keepWatching = process.argv.includes('--watch')

/* --------------------------------------------------------------- the patches ---*/

const PATCHES = [
  {
    name: 'the σ bands can be turned off',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `TR.sig = 'cfg';
TR.basis = 'typ';
TR.alm = false;`,
    replacement: `TR.sig = 'cfg';
TR.basis = 'typ';
TR.alm = false;
/* The σ bands — zones, lines and labels — are on until somebody turns them off. */
TR.bands = true;`,
  },
  {
    name: 'a σ of nought falls back to the configured one',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `  const sigma = Math.max(
      TR.sig === 'cfg' ? sp.sd : TR.sig === 'sd' ? sdw : mrb / 1.128,
      Math.abs(t.typ) * 1e-6,
      1e-9,
    ),
    cl = TR.basis === 'typ' ? t.typ : mean;`,
    replacement: `  /*
   * σ from the data, and the configured σ when the data has none.
   *
   * A run of identical readings — a column parked on one value, a line that
   * has not moved — has a standard deviation of nought, and a nought σ is not
   * a control chart: all six band lines land on the centre line and the chart
   * loses the one thing it is for. The configured σ (or the one suggested from
   * the alarm limits) stands in, so the bands are drawn where the limits say
   * they should be and the flat run is visible against them.
   *
   * Nothing is hidden by this: the stats row below reports "σ used" and "σ of
   * data" separately, so a nought spread still says so.
   */
  const asked = TR.sig === 'cfg' ? sp.sd : TR.sig === 'sd' ? sdw : mrb / 1.128;
  const spread = asked > 0 ? asked : sp.sd > 0 ? sp.sd : Math.abs(t.typ) * 0.02;
  const sigma = Math.max(spread, Math.abs(t.typ) * 1e-6, 1e-9),
    cl = TR.basis === 'typ' ? t.typ : mean;`,
  },
  {
    name: 'a σ bands tick, beside Min / Max',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `<label class="chk"><input type="checkbox" id="trSpec" \${TR.spec ? 'checked' : ''}> Min / Max</label><label class="chk"><input type="checkbox" id="trAlm"`,
    replacement: `<label class="chk"><input type="checkbox" id="trSpec" \${TR.spec ? 'checked' : ''}> Min / Max</label><label class="chk"><input type="checkbox" id="trBands" \${TR.bands !== false ? 'checked' : ''}> σ bands</label><label class="chk"><input type="checkbox" id="trAlm"`,
  },
  {
    name: 'the σ bands tick redraws the chart',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `  $('#trSpec').onchange = e => {
    TR.spec = e.target.checked;
    drawTrend();
  };`,
    replacement: `  $('#trSpec').onchange = e => {
    TR.spec = e.target.checked;
    drawTrend();
  };
  $('#trBands').onchange = e => {
    TR.bands = e.target.checked;
    drawTrend();
  };`,
  },
  {
    name: 'the axis reaches only as far as what is drawn',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `      let lo = Math.min(S.min, S.cl - 3.4 * S.sigma, ...extra.map(x => x[0])),
        hi = Math.max(S.max, S.cl + 3.4 * S.sigma, ...extra.map(x => x[0]));`,
    replacement: `      /*
       * The axis reaches as far as what is being drawn, and no further.
       *
       * ±3.4σ is in the range only while the bands are on screen. With them
       * turned off that reach was still stretching the axis to make room for
       * lines nobody was drawing, which flattened the readings into a band
       * across the middle.
       */
      const reach = TR.bands !== false ? [S.cl - 3.4 * S.sigma, S.cl + 3.4 * S.sigma] : [S.cl];
      let lo = Math.min(S.min, ...reach, ...extra.map(x => x[0])),
        hi = Math.max(S.max, ...reach, ...extra.map(x => x[0]));`,
  },
  {
    name: 'right-hand labels stay level with their own lines',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `        let ly = y + 4;
        for (let k = 0; k < 6 && LY.some(q => Math.abs(q - ly) < 11); k++) ly += y < H / 2 ? 11 : -11;
        LY.push(ly);
        c.fillStyle = col;
        c.font = \`\${bold ? 700 : 600} 10.5px IBM Plex Mono,monospace\`;
        c.textAlign = 'left';
        c.fillText(\`\${lab} \${fmt(v)}\`, W - pr + 6, ly);`,
    replacement: `        /*
         * A line without a label is a line, and that is often the right one.
         *
         * Callers pass no label for the σ lines. Six of them inside a spread
         * of a quarter of a unit, on an axis eighteen units tall, put seven
         * numbers in a stack down the right-hand gutter with leader lines
         * fanning back to a single pixel row — and every one of those numbers
         * is already in the stats underneath, under "σ used". The zones say
         * where ±1σ is; the gutter is for the handful of values somebody
         * reads off the axis: the centre line, Min, Max and the alarm limits.
         *
         * Those few are nudged apart when they collide, and stay level with
         * their own line whenever they can — a label printed above a gridline
         * it does not belong to is a chart contradicting itself.
         */
        if (!lab) return;

        const home = y + 3.5;
        let ly = home;
        for (let k = 1; k < 40 && LY.some(q => Math.abs(q - ly) < 11); k++) {
          ly = home + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 11;
        }
        ly = Math.max(pt + 8, Math.min(H - pb - 2, ly));
        LY.push(ly);

        c.fillStyle = col;
        c.font = \`\${bold ? 700 : 600} 10.5px IBM Plex Mono,monospace\`;
        c.textAlign = 'left';
        c.fillText(\`\${lab} \${fmt(v)}\`, W - pr + 8, ly);`,
  },
  {
    name: 'every σ band drawn, unless there is no spread at all',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `      [
        [3, ZC.l3, '+3σ'],
        [2, ZC.l2, '+2σ'],
        [1, ZC.l1, '+1σ'],
      ].forEach(([k, col, l]) => {
        hline(S.cl + k * S.sigma, col, [5, 4], l, k === 3 ? 1.6 : 1.1);
        hline(S.cl - k * S.sigma, col, [5, 4], l.replace('+', '−'), k === 3 ? 1.6 : 1.1);
      });`,
    replacement: `      /*
       * All three σ bands, unless there is no spread at all.
       *
       * They crowd together when σ is small against the axis — the axis is
       * stretched by Min and Max, and σ may be a fraction of that range — but
       * crowded is not the same as absent, and a control chart with its ±1σ
       * and ±2σ bands missing is not the chart anybody came to read. Only a σ
       * of nought is dropped, where all six lines would be drawn on CL.
       *
       * To see them apart, turn off the Min / Max tick above the chart: the
       * axis then scales to the data and its bands rather than being
       * stretched to reach the specification.
       */
      const sigmaGap = Math.abs(Y(S.cl) - Y(S.cl + S.sigma));
      const bands =
        TR.bands === false || sigmaGap < 1
          ? []
          : [
              [3, ZC.l3, '+3σ'],
              [2, ZC.l2, '+2σ'],
              [1, ZC.l1, '+1σ'],
            ];
      /*
       * Named and valued, both sides — but with no leader drawn back to the
       * line. The leaders were the thing in the way: six of them fanning into
       * one pixel row. The labels themselves are how somebody reads ±1σ off
       * the chart without doing the arithmetic.
       */
      bands.forEach(([k, col, l]) => {
        hline(S.cl + k * S.sigma, col, [5, 4], l, k === 3 ? 1.6 : 1.1);
        hline(S.cl - k * S.sigma, col, [5, 4], l.replace('+', '−'), k === 3 ? 1.6 : 1.1);
      });`,
  },
  {
    name: 'one reading is a chart; nothing at all is not',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `    if (S.n < 2) {
      c.fillStyle = mut;
      c.fillText('Collecting data…', pl, H / 2);
    } else {`,
    replacement: `    /*
     * One reading is a chart. Nothing at all is not.
     *
     * This drew "Collecting data…" below two points, which on a plant is
     * wrong twice over: a lab result taken once a shift genuinely has one
     * record in a two-hour window, and the message says the data is on its
     * way when it has already arrived and is being withheld. The axis, the
     * limits and the σ bands are all worth drawing around a single value —
     * that is how somebody sees it is inside the specification.
     */
    if (!S.n) {
      c.fillStyle = mut;
      c.fillText('No records in this window', pl, H / 2);
    } else {`,
  },
  {
    name: 'a lone reading is centred, not pinned to the axis',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `      const n = S.n,
        dx = (W - pl - pr) / Math.max(1, n - 1),
        X = i => pl + i * dx,`,
    replacement: `      /*
       * A lone reading stands in the middle, not against the left edge.
       *
       * \`dx\` is the gap between points, and with one point there is no gap —
       * \`Math.max(1, n - 1)\` keeps the arithmetic safe but puts the only
       * marker at \`pl\`, half on the axis. Centred, it reads as the one
       * measurement there is rather than as a chart that failed to draw.
       */
      const n = S.n,
        dx = (W - pl - pr) / Math.max(1, n - 1),
        X = i => (n < 2 ? pl + (W - pl - pr) / 2 : pl + i * dx),`,
  },
  {
    name: 'a handful of readings are drawn as markers',
    file: join('js', '12-tag-spec-charts.js'),
    anchor: `        const z = zoneOf(v, S),
          r = F[i] ? 4.2 : dx > 3 ? 2.2 : z ? 1.8 : 0;`,
    replacement: `        // A chart of one or two readings has no line to follow, so the
        // markers carry it and are drawn big enough to be the chart.
        const z = zoneOf(v, S),
          r = F[i] ? 4.2 : n < 3 ? 4 : dx > 3 ? 2.2 : z ? 1.8 : 0;`,
  },
  {
    name: 'the value on a canvas label is its own element',
    file: join('js', '04-canvas.js'),
    anchor: `<tspan class="k">\${esc(o.k)}</tspan>\${o.k ? ' ' : ''}\${esc(o.txt)}</text>`,
    replacement: `<tspan class="k">\${esc(o.k)}</tspan>\${o.k ? ' ' : ''}<tspan class="tv">\${esc(o.txt)}</tspan></text>`,
  },
  {
    name: 'base href, so assets resolve at any path depth',
    anchor: '<meta charset="utf-8">',
    replacement: `<meta charset="utf-8">
<!--
  Every asset below is relative and the studio can be served at a path of any
  depth — SandMan opens it at /sandman/user/digitalloop. Without this,
  "app.js" resolves against that path, the server answers with the shell
  instead, and the page loads as HTML pretending to be a script.
-->
<base href="/">`,
  },
  {
    name: 'our stylesheet, after the studio\'s own',
    anchor: '<!-- @@CSS@@ -->',
    replacement: `<!-- @@CSS@@ -->
<!-- The Digital Loop chrome: lock screen, foundry and line strip, role rules.
     After the studio's own CSS on purpose, so it adds rather than fights. -->
<link rel="stylesheet" href="sandman/sandman.css">`,
  },
  {
    name: 'the lock, painted before anything else',
    anchor: '<body>',
    replacement: `<body class="dl-locked">
<!--
  The lock is painted in the document's first bytes, not from script.

  The editor builds itself as app.js runs, so by the time any module could
  cover it the whole thing has been on screen — the ribbon, the library, and
  whatever the browser kept from last time. An operator must never see an
  editor, so this cover exists before any of that and is taken away only once
  a session has been confirmed. The style is inline because a stylesheet that
  is still downloading cannot hide anything.
-->
<style>
  body.dl-locked > *:not(#dlLocked) { visibility: hidden }
  #dlLocked {
    position: fixed; inset: 0; z-index: 9000; display: flex;
    align-items: center; justify-content: center; background: #0d1b26;
  }
</style>
<!--
  No way out on this screen, deliberately.

  There used to be a "← Back to SandMan" button here, and it was worse than
  nothing. The .dl-locked-go rule gives it display:inline-block, which beats
  the hidden attribute, so it stood on screen under "Opening…" from the first
  paint — before any script had decided where it should go, still carrying
  the placeholder href. SandMan opens this page in a full-page iframe and its
  own pages refuse to be framed, so pressing it then turned the whole window
  into "refused to connect" with the address bar unchanged.

  The way back belongs in the studio's own header, where it is set up from
  the session and breaks out of the frame — see #dlBack in sandman/index.mjs.
  This screen says what happened and nothing else.
-->
<div id="dlLocked" class="dl-locked-screen">
  <div class="dl-locked-card">
    <span class="dl-locked-eyebrow">SANDMAN</span>
    <h1>Digital Loop</h1>
    <p id="dlLockedReason">Opening…</p>
  </div>
</div>`,
  },
  {
    name: 'the integration module, after the editor',
    anchor: '<!-- @@JS@@ -->',
    replacement: `<!-- @@JS@@ -->
<!-- Loaded after the editor, which builds its DOM as it runs. A module, so it
     is deferred by definition and the classic script above has finished. -->
<script type="module" src="sandman/index.mjs"></script>`,
  },
]

/* ------------------------------------------------------------------- apply ---*/

/**
 * Line endings are normalised before anything is compared or written.
 *
 * Upstream ships this file with CRLF; the replacements below are written with
 * LF. Without this the "already applied?" test compares LF text against CRLF
 * text, decides a patch is missing, tries to apply it again, and dies on an
 * anchor that was consumed the first time — so the second run of a script
 * whose whole job is to be re-runnable would fail.
 *
 * Normalising to LF is the fix rather than matching upstream's CRLF, because
 * it gives one answer on every machine. Nobody diffs this file by hand: a new
 * drop replaces `src/` wholesale and this runs again.
 */
const normalise = text => text.replaceAll('\r\n', '\n')

/*
 * A patch may name a file; without one it is the page template.
 *
 * Everything here used to be a change to `index.template.html`, so the file
 * was implied. One change is not: the control chart draws its σ lines on top
 * of each other when there is no spread, and that lives in the studio's own
 * JavaScript. A drop replaces `src/` wholesale, so a change made there and
 * not declared here is a change that disappears without a word.
 */
function applyPatches({ quiet } = {}) {
  const byFile = new Map()
  for (const patch of PATCHES) {
    const file = patch.file ? join(HERE, 'src', patch.file) : TEMPLATE
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(patch)
  }
  for (const [file, patches] of byFile) applyTo(file, patches, { quiet })
}

function applyTo(file, patches, { quiet } = {}) {
  const original = readFileSync(file, 'utf8')
  let text = normalise(original)
  let changedCount = 0

  for (const patch of patches) {
    if (text.includes(patch.replacement)) {
      if (check) console.log(`  = ${patch.name} (already applied)`)
      continue
    }
    if (!text.includes(patch.anchor)) {
      console.error(`  ! ${patch.name} — anchor not found: ${patch.anchor}`)
      process.exit(1)
    }
    if (check) {
      console.log(`  + ${patch.name} (would apply)`)
      continue
    }
    text = text.replace(patch.anchor, patch.replacement)
    changedCount += 1
    console.log(`  + ${patch.name}`)
  }

  /*
   * Written only when it would actually differ — which, after the first run,
   * it does not.
   *
   * This file lives under `src/`, which `--watch` watches. Writing it
   * unconditionally meant every rebuild triggered the next one: the studio was
   * rebuilt and `app.js` rewritten every three seconds for as long as the
   * watcher ran. The backend caches the gzip of `app.js` by size and
   * modification time, so each request re-compressed five megabytes — and a
   * request that arrived mid-write was answered with half a file, which the
   * browser reported as `SyntaxError: Invalid or unexpected token` and the
   * studio as "started but did not finish".
   *
   * The CRLF normalisation still happens on the first run, which is what it
   * was for; it simply no longer happens again every time afterwards.
   */
  if (!check && text !== original) writeFileSync(file, text, 'utf8')
}

/* ------------------------------------------------------------------- build ---*/

/**
 * Build, then copy into the directory the backend serves.
 *
 * Only the three built files are copied: `sandman/` lives in that same folder
 * and is ours, so replacing the folder would take the integration with it.
 */
function buildAndCopy({ quiet } = {}) {
  execFileSync(process.execPath, [join(HERE, 'build.mjs')], {
    cwd: HERE,
    stdio: quiet ? 'pipe' : 'inherit',
  })

  mkdirSync(APP, { recursive: true })
  for (const file of ['index.html', 'app.js', 'app.css']) {
    const from = join(HERE, 'dist', file)
    if (!existsSync(from)) {
      console.error(`  ! build produced no ${file}`)
      process.exit(1)
    }
    copyFileSync(from, join(APP, file))
  }
}

applyPatches()
if (check) process.exit(0)

/*
 * One line, not eight.
 *
 * This printed four "already applied" patches, the builder's own count and a
 * sentence about where the files went, before every build and every rebuild.
 * All true, none of it news — and it pushed the one line that *is* news off
 * the top of the screen.
 */
buildAndCopy({ quiet: true })
console.log('built → frontend/app')

/* ------------------------------------------------------------------- watch ---*/

if (keepWatching) {
  // Our own integration lives outside `src/` and is served straight from disk,
  // so most work needs nothing watched at all. Said once, and briefly.
  console.log('watching studio/src — reload the browser after a change\n')

  const SRC = join(HERE, 'src')
  let queued

  const rebuild = () => {
    // Editors write a file in several steps; one rebuild after the last of
    // them is what is wanted, not one per write.
    clearTimeout(queued)
    queued = setTimeout(() => {
      try {
        applyPatches({ quiet: true })
        buildAndCopy({ quiet: true })
        console.log(`  rebuilt → ../app  (${new Date().toLocaleTimeString()})`)
      } catch (error) {
        // A syntax error in the studio's source should not end the watch —
        // the next save is usually the fix.
        console.error(`  build failed: ${error.message.split('\n')[0]}`)
      }
    }, 150)
  }

  /*
   * Watch `src/`, and notice when the directory itself is replaced.
   *
   * `fs.watch` follows the directory it was given, not the path. Taking a new
   * drop means deleting `src/` and putting another one there — and from that
   * moment the watch is attached to something that no longer exists. It stops
   * firing, silently: `npm run dev` goes on running, says nothing, and every
   * later edit is simply never built. That is worse than crashing, because the
   * browser keeps showing the previous build and the obvious conclusion is
   * that the change did not work.
   *
   * So the watch is re-established whenever it errors, and a cheap check
   * confirms it is still looking at the directory that is there now.
   */
  let watcher = null
  let watchingSince = 0

  const attach = () => {
    try {
      watcher?.close()
    } catch { /* already gone */ }

    if (!existsSync(SRC)) return false
    watcher = watch(SRC, { recursive: true }, rebuild)
    watcher.on('error', () => { watcher = null })
    watchingSince = statSync(SRC).ctimeMs
    return true
  }

  if (!attach()) {
    console.error(`  ! ${SRC} does not exist — nothing to watch.`)
    process.exit(1)
  }

  /*
   * The directory's creation time is what says it was replaced rather than
   * written into. Checked on a slow timer: this costs one `stat` every few
   * seconds and is what makes taking a drop not require remembering to
   * restart the watcher.
   */
  setInterval(() => {
    let current
    try {
      current = statSync(SRC).ctimeMs
    } catch {
      return // Mid-swap: the directory is gone for a moment. Try again later.
    }
    if (watcher && current === watchingSince) return

    if (attach()) {
      console.log(`  src/ was replaced — watching the new one (${new Date().toLocaleTimeString()})`)
      rebuild()
    }
  }, 3000).unref?.()
}
