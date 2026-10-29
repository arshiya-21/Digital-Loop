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
    name: 'an uploaded drawing keeps its own ids, classes and inherited paint',
    file: join('js', '07-reuse.js'),
    anchor: `function parseSvg(src) {
  src = String(src || '');
  const m = src.match(/<svg[^>]*>/i);
  let vb = null,
    inner = src;
  if (m) {
    const v = m[0].match(/viewBox\\s*=\\s*["']([^"']+)["']/i);
    if (v) vb = v[1];
    else {
      const w = m[0].match(/\\swidth\\s*=\\s*["']?([\\d.]+)/i),
        h = m[0].match(/\\sheight\\s*=\\s*["']?([\\d.]+)/i);
      if (w && h) vb = \`0 0 \${w[1]} \${h[1]}\`;
    }
    inner = src.replace(/^[\\s\\S]*?<svg[^>]*>/i, '').replace(/<\\/svg>\\s*$/i, '');
  }
  return { vb: vb || '0 0 100 100', inner: sanitizeSvg(inner) };
}`,
    replacement: `/*
 * An uploaded drawing keeps its own ids, classes and inherited paint.
 *
 * The root \`<svg>\` is dropped here — the canvas supplies its own, sized and
 * placed — and the children are inlined into the page. That is three ways for
 * an upload to come out looking unlike the file:
 *
 *   **ids are global.** Illustrator and Figma name their gradients, clips,
 *   masks and filters \`a\`, \`b\`, \`SVGID_1_\`, \`clip0_1_2\`. Two uploads in one
 *   loop both define \`#a\`; the second wins for both, so one machine is drawn
 *   with another's gradient, or clipped to another's shape.
 *
 *   **class names are global too.** \`.st0 { fill:#fff }\` is what Illustrator
 *   writes, every time, counting from zero. Two uploads and the colours swap.
 *
 *   **the root's paint is inherited.** \`<svg fill="#333">\` colours every child
 *   that does not say otherwise. Dropping the root dropped that, and those
 *   children fell back to black.
 *
 * So ids are renamed with the instance's own suffix and every reference to
 * them is renamed with it, the stylesheet is confined to this drawing's own
 * group, and whatever the root was passing down is passed down by that group.
 */
const SVG_INHERITS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-miterlimit',
  'color', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'letter-spacing', 'shape-rendering', 'style',
];

/** Every \`id="…"\` the markup defines, in order of appearance. */
function svgIds(markup) {
  const found = new Set();
  const pattern = /\\sid\\s*=\\s*["']([^"']+)["']/gi;
  let hit;
  while ((hit = pattern.exec(markup))) found.add(hit[1]);
  return [...found];
}

/** \`#a\` → \`#a__u12\`, wherever it is written: id, url(), href, begin. */
function renameIds(markup, suffix) {
  for (const id of svgIds(markup)) {
    // Escaped because an id may legally hold regex punctuation.
    const safe = id.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    const to = \`\${id}__\${suffix}\`;
    markup = markup
      .replace(new RegExp(\`(\\\\sid\\\\s*=\\\\s*["'])\${safe}(["'])\`, 'g'), \`$1\${to}$2\`)
      .replace(new RegExp(\`url\\\\((["']?)#\${safe}\\\\1\\\\)\`, 'g'), \`url($1#\${to}$1)\`)
      .replace(new RegExp(\`((?:xlink:)?href\\\\s*=\\\\s*["'])#\${safe}(["'])\`, 'g'), \`$1#\${to}$2\`)
      .replace(new RegExp(\`(\\\\sbegin\\\\s*=\\\\s*["'])\${safe}\\\\.\`, 'g'), \`$1\${to}.\`);
  }
  return markup;
}

/**
 * Confine a \`<style>\` block to one group, by putting that group in front of
 * every selector in it.
 *
 * Renaming the classes instead would mean rewriting both the stylesheet and
 * every \`class\` attribute, and getting either half wrong silently unpaints
 * the drawing. An ancestor selector needs no attribute touched at all.
 *
 * At-rules are left exactly as they are: \`@keyframes\` names frames rather
 * than elements, and prefixing those would break the animation it describes.
 */
function scopeSvgStyles(markup, scope) {
  return markup.replace(/<style\\b[^>]*>([\\s\\S]*?)<\\/style>/gi, (whole, css) => {
    if (/@(media|supports|keyframes|font-face|import)/i.test(css)) return whole;
    const scoped = css.replace(/(^|\\})([^@{}]+)\\{/g, (_, close, selectors) =>
      close + selectors.split(',').map(one => {
        const trimmed = one.trim();
        return trimmed ? \`.\${scope} \${trimmed}\` : one;
      }).join(', ') + '{');
    return whole.replace(css, scoped);
  });
}

function parseSvg(src, uid) {
  src = String(src || '');
  const m = src.match(/<svg[^>]*>/i);
  let vb = null,
    inner = src,
    inherited = '';
  if (m) {
    const v = m[0].match(/viewBox\\s*=\\s*["']([^"']+)["']/i);
    if (v) vb = v[1];
    else {
      const w = m[0].match(/\\swidth\\s*=\\s*["']?([\\d.]+)/i),
        h = m[0].match(/\\sheight\\s*=\\s*["']?([\\d.]+)/i);
      if (w && h) vb = \`0 0 \${w[1]} \${h[1]}\`;
    }
    // What the root was passing down to its children, which they still need.
    inherited = SVG_INHERITS.map(name => {
      const got = m[0].match(new RegExp(\`\\\\s\${name}\\\\s*=\\\\s*["']([^"']*)["']\`, 'i'));
      return got ? \` \${name}="\${esc(got[1])}"\` : '';
    }).join('');
    inner = src.replace(/^[\\s\\S]*?<svg[^>]*>/i, '').replace(/<\\/svg>\\s*$/i, '');
  }

  const suffix = \`u\${uid == null ? '0' : String(uid).replace(/[^A-Za-z0-9_-]/g, '')}\`;
  const scope = \`svgs-\${suffix}\`;
  let body = sanitizeSvg(inner);
  body = renameIds(body, suffix);
  body = scopeSvgStyles(body, scope);

  return {
    vb: vb || '0 0 100 100',
    inner: \`<g class="\${scope}"\${inherited}>\${body}</g>\`,
  };
}`,
  },
  {
    name: 'the drawing is namespaced by the instance that draws it',
    file: join('js', '07-reuse.js'),
    anchor: `    case 'svg': {
      const P = parseSvg(d.svg);`,
    replacement: `    case 'svg': {
      // The instance's own id, so two placements of one drawing — and two
      // different drawings — cannot define the same \`#a\`.
      const P = parseSvg(d.svg, uid);`,
  },
  {
    name: 'Traceability says it is under development, and stays unpressable',
    file: join('js', '12g-publish-trace.js'),
    anchor: `  b.classList.toggle('on', !!RP);
  b.textContent = RP ? '● Back to live' : 'Traceability';
  b.title = RP ? 'Leave traceability and go back to live values' : 'Traceability — look back at a past shift (read-only)';`,
    replacement: `  /*
   * Traceability is still being built, so the button says so and does nothing.
   *
   * It replays a past shift out of the recorded history, and the part of it
   * that reads this plant's history is not finished — so the control is on
   * the bar and the thing behind it is not there yet. It stays rather than
   * being taken off, because it is coming: a control that vanishes reads as
   * something broken, where this is something on the way.
   *
   * Written here rather than over the top of it, because this function runs
   * on a one-second interval and would paint the old label back.
   */
  b.classList.remove('on');
  b.classList.add('dl-under-development');
  b.disabled = true;
  b.textContent = 'Traceability · under development';
  b.title = 'Traceability is under development and is not available yet.';`,
  },
  {
    name: 'the live panel button carries the alarm count',
    file: join('js', '05-panels.js'),
    anchor: `  pa.classList.toggle(
    'blink',
    Object.values(ALERTS).some(x => !x.acked && x.sev >= 2),
  );
}`,
    replacement: `  pa.classList.toggle(
    'blink',
    Object.values(ALERTS).some(x => !x.acked && x.sev >= 2),
  );
  /*
   * The live panel's own button carries the same count, and flashes the same.
   *
   * \`#pMon\` is inserted by the live monitor and nothing kept it in step, so it
   * sat on the Publish bar reading "🔔 Fault alarm" with no number on it while
   * the alarm list behind it filled up — the one button an operator is meant
   * to read at a glance, saying nothing.
   */
  const pm = $('#pMon');
  if (pm) {
    const t = \`🔔 Fault alarm (\${nw})\`;
    if (pm.textContent !== t) pm.textContent = t;
    pm.title = pa.title;
    /*
     * Red while anything is in alarm; flashing while anything is unanswered.
     *
     * These are two different facts and the studio only carries one of them.
     * \`blink\` is set for an unacknowledged *warning or worse*, so a line
     * sitting on an acknowledged warning and an unacknowledged advisory had
     * a quiet green button — the panel open, two alarms listed, and the one
     * control on the bar saying all is well.
     *
     * \`dl-alarm\` is the first fact: something is in alarm at all, whatever
     * its severity and whoever has seen it. \`blink\` stays the second.
     */
    pm.classList.toggle('dl-alarm', a.length > 0);
    pm.classList.toggle('blink', Object.values(ALERTS).some(x => !x.acked && x.active));
  }
}`,
  },
  {
    name: 'a Maintenance tab on every machine',
    file: join('js', '05-panels.js'),
    anchor: `  if (b.tags.some(t => REG[t.id]?.role === 'bent')) tabs.push(['presc', 'Prescription']);`,
    replacement: `  if (b.tags.some(t => REG[t.id]?.role === 'bent')) tabs.push(['presc', 'Prescription']);
  // Maintenance, where the module is loaded — see 22-maintenance.js.
  if (!E.widget && typeof mntTab === 'function') tabs.push(['mnt', 'Maintenance']);`,
  },
  {
    name: 'the Maintenance tab renders the machine',
    file: join('js', '05-panels.js'),
    anchor: `  } else if (PTAB === 'presc') {`,
    replacement: `  } else if (PTAB === 'mnt') {
    // The machine's plans, work history and health — see 22-maintenance.js.
    T.innerHTML = mntTab(b);
    bindMntTab(b, T);
  } else if (PTAB === 'presc') {`,
  },
  {
    name: 'no label tooltip in the publish view',
    file: join('js', '04-canvas.js'),
    anchor: `<title>\${esc(t.id)} · \${esc(t.desc)} — drag to move this label · Shift+drag moves all labels of \${esc(b.name)} · double-click for the trend</title></g>\`;`,
    replacement: `\${PRESENT ? '' : \`<title>\${esc(t.id)} · \${esc(t.desc)} — drag to move this label · Shift+drag moves all labels of \${esc(b.name)} · double-click for the trend</title>\`}</g>\`;`,
  },
  {
    name: 'the legend lists what the loop uses',
    file: join('js', '01-equipment-library.js'),
    anchor: `      // v9.0 — a legend can carry its own list (props.items): ['#rrggbb', 'label'] draws a line in that colour
      const items = (b && b.props && Array.isArray(b.props.items) && b.props.items.length && b.props.items) || [`,
    replacement: `      /*
       * The legend lists what this loop actually uses.
       *
       * It used to print the same twelve entries on every drawing — eight
       * instrument symbols and four line types — whatever was on the canvas.
       * On a loop with no valves and no air line that is four entries
       * explaining symbols nobody can find, and the two line colours that
       * *are* on the drawing have to be hunted for among them. A legend that
       * does not match its drawing is worse than none: it is read as the key
       * to the drawing, so every wrong entry is a thing to go looking for.
       *
       * So the instruments are the ones placed, and the line types are the
       * ones drawn. A legend somebody has set a list on by hand (\`props.items\`,
       * added in v9.0) is still theirs and is left exactly alone.
       *
       * The canned list stays as the fallback for an empty canvas, where
       * deriving would leave a blank strip that reads as broken.
       */
      const SYMBOL = {
        analyzer: ['A', 'Analyzer / sensor point'],
        motor: ['M', 'Motor'],
        valve: ['V', 'Valve'],
        ctrlValve: ['CV', 'Control valve'],
        flowTx: ['FT', 'Flow transmitter'],
        levelTx: ['LT', 'Level transmitter'],
        tempSensor: ['TE', 'Temperature sensor'],
        speedMon: ['RPM', 'Speed monitor'],
      };
      const inUse = () => {
        if (typeof DOC === 'undefined' || !DOC) return [];
        const blocks = DOC.blocks || [],
          streams = DOC.streams || [];
        const out = [];
        // Instruments first, in the order the legend has always listed them.
        for (const type of Object.keys(SYMBOL)) {
          if (blocks.some(x => x.type === type)) out.push(SYMBOL[type]);
        }
        // Then the line types actually drawn, in KIND's own order so the
        // colours read down the legend the same way on every loop.
        const drawn = new Set(streams.map(s => s.kind).filter(Boolean));
        for (const k of Object.keys(KIND)) if (drawn.has(k)) out.push([k, '']);
        return out;
      };
      // v9.0 — a legend can carry its own list (props.items): ['#rrggbb', 'label'] draws a line in that colour
      const derived = inUse();
      const items = (b && b.props && Array.isArray(b.props.items) && b.props.items.length && b.props.items) ||
        (derived.length ? derived : [`,
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
 * Files that are ours, living inside the studio's own source tree.
 *
 * A drop replaces `src/` wholesale, and these are not in it — so a drop
 * deletes them, the build still succeeds, and the feature is simply gone. It
 * happened once already on a trial drop of v9.53: `12h-sop-files.js` and its
 * stylesheet vanished while `backend/src/routes/sopFiles.js` went on serving
 * the API behind a screen nobody could reach any more.
 *
 * A patch cannot protect them, because a patch needs an anchor and these have
 * no upstream text to anchor to. So they are listed, and their absence is
 * reported as loudly as a missing anchor: restore them from git before
 * building, or the build is a build of something smaller than the repo.
 */
const OURS = [
  { file: join('js', '12h-sop-files.js'), must: 'sopFiles' },
  { file: join('css', 'zz-sop-files.css'), must: '.sf-card' },
  /*
   * The live monitor is upstream's module, taken once and maintained here —
   * the ordering by what went wrong today, the set it opens on, the flash on
   * every unacknowledged alarm, and the picker's "reading from the plant".
   * A later drop would bring upstream's own copy of this file and overwrite
   * every one of them, so its presence is not enough: these markers say the
   * changes are still in it.
   */
  { file: join('js', '20-live-monitor.js'), must: 'mpWorstToday' },
  { file: join('js', '20-live-monitor.js'), must: 'mpkLive' },
  { file: join('js', '20-live-monitor.js'), must: "!a.acked && a.active ? ' flash'" },
  { file: join('js', '20-live-monitor.js'), must: 'window.dlHistory' },
  { file: join('js', '20-live-monitor.js'), must: 'Scaled to the readings, not to the limits' },
  { file: join('css', 'zz-live-monitor.css'), must: '.mpanel' },
  /*
   * The maintenance module, taken from v9.53 and maintained here: the
   * machine's plans and work history, asset health, the alert rules that
   * raise a due job, the QR cards, and the generator they are drawn with.
   *
   * The QR library lives in `src/vendor/` upstream and is built into a
   * separate `vendor.js`. It sits in `src/js/` here instead, where the name
   * it already has sorts it before the module that needs it — one file in a
   * folder the build already reads, rather than a build and a copy step that
   * would have to be re-applied on every drop.
   */
  { file: join('js', '20-qrcode-generator.js'), must: 'qrcode' },
  { file: join('js', '21-machine-cards.js'), must: 'mcQrSheet' },
  { file: join('js', '22-maintenance.js'), must: 'mntWindow' },
  { file: join('js', '23-asset-health.js'), must: 'mntHealth' },
  { file: join('js', '24-mnt-alert-rules.js'), must: 'mntCheck' },
  { file: join('css', 'zz-maintenance.css'), must: '.mnt-hd' },
  { file: join('css', 'zz-machine-cards.css'), must: '.mc-h' },
]

function checkOurs() {
  const gone = []
  const gutted = []
  for (const { file, must } of OURS) {
    const path = join(HERE, 'src', file)
    if (!existsSync(path)) {
      if (!gone.includes(file)) gone.push(file)
      continue
    }
    if (!readFileSync(path, 'utf8').includes(must)) gutted.push({ file, must })
  }

  if (!gone.length && !gutted.length) {
    if (check) console.log(`  = ${OURS.length} marks of ours are in place`)
    return
  }

  if (gone.length) {
    console.error('\n  ! files of ours are missing from src/ — a drop has deleted them:')
    for (const file of gone) console.error(`      src/${file.replaceAll('\\', '/')}`)
  }
  if (gutted.length) {
    console.error('\n  ! files of ours are there but our changes are not — a drop has overwritten them:')
    for (const { file, must } of gutted) {
      console.error(`      src/${file.replaceAll('\\', '/')} no longer holds  ${must}`)
    }
  }
  const files = [...new Set([...gone, ...gutted.map(g => g.file)])]
  console.error('\n    git checkout -- ' +
    files.map(file => `frontend/studio/src/${file.replaceAll('\\', '/')}`).join(' ') + '\n')
  process.exit(1)
}

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
  checkOurs()
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
