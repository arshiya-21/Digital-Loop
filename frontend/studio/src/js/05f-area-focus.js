/*! SandMan Digital Loop Studio — 05f-area-focus.js
 *  v9.20 — Publish view: Areas pane and "zoom to one area".
 *    · Bottom bar "▦ Areas" opens the Areas pane (right side): Whole loop + every Area Box (zone) of the loop, each with its
 *      equipment count and an alarm dot when equipment in it has an active alarm.
 *    · Click an area in the pane — or click the area itself on the drawing — and the view glides to that area only; the rest
 *      of the loop is dimmed. A bar on top shows the area name with ‹ › (previous / next area) and "Whole loop".
 *    · Back to the whole loop: "Whole loop", Fit view, Main screen, Esc, or a click on the dimmed part.
 *  View only: nothing is moved or saved; leaving Publish always returns to the normal view. */

const AF = { id: null, pane: false, tick: 0 };
const afZones = () =>
  DOC.blocks
    .filter(b => b.type === 'areaBox')
    .slice()
    .sort((a, b) => afName(a).localeCompare(afName(b), undefined, { numeric: true }) || a.y - b.y || a.x - b.x);
const afName = z => String(z?.props?.text || z?.name || 'Area').trim();
function afRect(z) {
  const d = dims(z);
  return { x: z.x, y: z.y, w: d.W, h: d.H };
}
/* equipment whose centre lies inside the area (frames, labels, junctions and panels are not counted) */
function afMembers(z) {
  const R = afRect(z);
  return DOC.blocks.filter(b => {
    if (b === z || ['areaBox', 'junction', 'label', 'title', 'clock', 'legend', 'notice', 'note', 'textBox'].includes(b.type)) return false;
    const E = EQ[b.type];
    if (!E || E.widget) return false;
    const d = dims(b),
      cx = b.x + d.W / 2,
      cy = b.y + d.H / 2;
    return cx >= R.x && cx <= R.x + R.w && cy >= R.y && cy <= R.y + R.h;
  });
}
function afSev(z) {
  const names = new Set(afMembers(z).map(b => b.name));
  let s = 0;
  Object.values(typeof ALERTS === 'object' ? ALERTS : {}).forEach(a => {
    if (a.active && names.has(a.where)) s = Math.max(s, a.sev || 0);
  });
  return s;
}
/* the view that shows one area as large as possible (one scale, centred), beside the pane when it is open */
function afTarget(z) {
  const r = $('#cwrap').getBoundingClientRect(),
    p = AF.pane ? ($('#afPane')?.offsetWidth || 0) + 12 : 0,
    top = 52, // room for the area bar
    M = 16,
    R = afRect(z);
  const W = Math.max(50, r.width - p),
    H = Math.max(50, r.height - top);
  const k = clamp(Math.min((W - 2 * M) / Math.max(1, R.w), (H - 2 * M) / Math.max(1, R.h)), 0.2, 5);
  return { k, tx: (W - R.w * k) / 2 - R.x * k, ty: top + (H - R.h * k) / 2 - R.y * k };
}
function afGlide(T, ms = 340) {
  cancelAnimationFrame(VIEWANIM);
  if (VIEW.ky) {
    VIEW.k = Math.min(VIEW.k, VIEW.ky);
    VIEW.ky = null;
  }
  const S = { tx: VIEW.tx, ty: VIEW.ty, k: VIEW.k },
    t0 = performance.now();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
  const step = now => {
    const q = ms ? Math.min(1, (now - t0) / ms) : 1,
      e = 1 - Math.pow(1 - q, 3);
    VIEW.tx = S.tx + (T.tx - S.tx) * e;
    VIEW.ty = S.ty + (T.ty - S.ty) * e;
    VIEW.k = S.k + (T.k - S.k) * e;
    VIEW.ky = null;
    applyView();
    if (q < 1) VIEWANIM = requestAnimationFrame(step);
    else if (typeof presentSync === 'function') presentSync();
  };
  VIEWANIM = requestAnimationFrame(step);
}
/* dim everything outside the focused area (drawn in the drawing's own coordinates, so it follows every zoom) */
function afDim() {
  let g = document.getElementById('afDim');
  const z = AF.id && B(AF.id);
  if (!z || !PRESENT) {
    if (g) g.innerHTML = '';
    return;
  }
  if (!g) {
    g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = 'afDim';
    g.addEventListener('pointerdown', e => {
      // a click on the dimmed part goes back to the whole loop
      e.stopPropagation();
      e.preventDefault();
      afClear();
    });
  }
  $('#vp').appendChild(g); // always on top of the drawing
  const { x: X, y: Y, w: W, h: H } = afRect(z),
    rr = 10,
    big = 1e5;
  g.innerHTML =
    `<path class="af-dim" fill-rule="evenodd" d="M${-big} ${-big}H${big}V${big}H${-big}Z M${X + rr} ${Y}H${X + W - rr}A${rr} ${rr} 0 0 1 ${X + W} ${Y + rr}V${Y + H - rr}A${rr} ${rr} 0 0 1 ${X + W - rr} ${Y + H}H${X + rr}A${rr} ${rr} 0 0 1 ${X} ${Y + H - rr}V${Y + rr}A${rr} ${rr} 0 0 1 ${X + rr} ${Y}Z"/>` +
    `<rect class="af-edge" x="${X}" y="${Y}" width="${W}" height="${H}" rx="${rr}"/>`;
}
/* zoom to one area */
function areaFocus(id, instant) {
  const z = B(id);
  if (!z || z.type !== 'areaBox' || !PRESENT) return false;
  AF.id = id;
  PVIEW.manual = false;
  const T = afTarget(z);
  if (instant) {
    cancelAnimationFrame(VIEWANIM);
    Object.assign(VIEW, T, { ky: null });
    applyView();
  } else afGlide(T);
  afDim();
  afUI();
  return true;
}
/* called by presentFit (resize, panels) while an area is shown: keep showing that area */
function afRefit() {
  if (!AF.id || !PRESENT) return false;
  if (!B(AF.id)) {
    AF.id = null;
    afUI();
    afDim();
    return false;
  }
  return areaFocus(AF.id, true);
}
/* back to the whole loop */
function afClear(silent) {
  const was = AF.id;
  AF.id = null;
  afDim();
  afUI();
  if (!silent && was && PRESENT) {
    const S = { tx: VIEW.tx, ty: VIEW.ty, k: VIEW.k };
    presentFit(); // the chosen whole-loop view…
    if (!VIEW.ky) {
      const T = { tx: VIEW.tx, ty: VIEW.ty, k: VIEW.k };
      Object.assign(VIEW, S);
      applyView();
      afGlide(T); // …reached with the same glide
    }
  }
}
function afStep(d) {
  const Z = afZones();
  if (!Z.length) return;
  const i = Z.findIndex(z => z.id === AF.id);
  areaFocus(Z[(i + d + Z.length) % Z.length].id);
}
/* leaving / entering Publish: always start from the whole loop with the pane closed */
function afReset() {
  AF.id = null;
  AF.pane = false;
  afDim();
  afUI();
}

/* ---------- interface: area bar (top) and Areas pane (right) ---------- */
function afEls() {
  const cw = $('#cwrap');
  if (!cw) return null;
  let bar = document.getElementById('afBar'),
    pane = document.getElementById('afPane');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'afBar';
    bar.className = 'af-bar';
    bar.innerHTML =
      '<button id="afBack" title="Back to the whole loop (Esc)">⤺ Whole loop</button>' +
      '<span class="af-sep"></span><button id="afPrev" class="af-arw" title="Previous area">‹</button>' +
      '<b id="afName"></b><span id="afIdx"></span><button id="afNext" class="af-arw" title="Next area">›</button>';
    cw.appendChild(bar);
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'afBack') afClear();
      else if (b.id === 'afPrev') afStep(-1);
      else if (b.id === 'afNext') afStep(1);
    });
  }
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'afPane';
    pane.className = 'af-pane';
    pane.setAttribute('role', 'dialog');
    pane.setAttribute('aria-label', 'Areas');
    cw.appendChild(pane);
    pane.addEventListener('pointerdown', e => e.stopPropagation());
    pane.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
    pane.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.id === 'afPaneX') return afPane(false);
      if (b.dataset.af === 'all') return afClear();
      if (b.dataset.af) areaFocus(b.dataset.af);
    });
  }
  return { bar, pane };
}
function afPaneHTML() {
  const Z = afZones();
  const sevC = ['', '#d4a017', '#ea7a0c', '#dc2626'];
  const rows = Z.map(z => {
    const n = afMembers(z).length,
      s = afSev(z),
      nm = afName(z),
      m = nm.match(/^([A-Z0-9]{1,3})\s*·\s*(.*)$/),
      key = m ? m[1] : z.props?.num ? String(z.props.num) : '',
      txt = m ? m[2] : nm;
    return (
      `<button class="af-row${AF.id === z.id ? ' on' : ''}" data-af="${z.id}" title="Show ${esc(nm)} only">` +
      `<span class="af-key">${esc(key || '▦')}</span>` +
      `<span class="af-txt"><b>${esc(txt)}</b><small>${n} equipment</small></span>` +
      (s ? `<i class="af-al" style="background:${sevC[s]}" title="Active alarm in this area"></i>` : '') +
      `</button>`
    );
  }).join('');
  return (
    `<div class="af-hd"><b>Areas</b><span>${Z.length}</span><button id="afPaneX" title="Close">✕</button></div>` +
    `<button class="af-row af-all${AF.id ? '' : ' on'}" data-af="all"><span class="af-key">⌂</span><span class="af-txt"><b>Whole loop</b><small>Everything on the screen</small></span></button>` +
    (Z.length
      ? `<div class="af-list">${rows}</div><div class="af-note">Tip: click an area on the drawing to zoom to it · Esc goes back</div>`
      : `<div class="af-empty">This loop has no areas yet.<br>In <b>Design</b>, add an <b>Area Box</b> (Insert → Area) around equipment to make it selectable here.</div>`)
  );
}
function afUI() {
  const E = afEls();
  if (!E) return;
  const z = AF.id && B(AF.id),
    Z = afZones();
  E.bar.classList.toggle('on', !!(PRESENT && z));
  if (z) {
    $('#afName').textContent = afName(z);
    $('#afIdx').textContent = `${Z.findIndex(q => q.id === z.id) + 1} / ${Z.length}`;
    const one = Z.length < 2;
    $('#afPrev').disabled = one;
    $('#afNext').disabled = one;
  }
  E.pane.classList.toggle('on', !!(PRESENT && AF.pane));
  if (PRESENT && AF.pane) E.pane.innerHTML = afPaneHTML();
  E.bar.style.right = PRESENT && AF.pane ? E.pane.offsetWidth + 12 + 'px' : '';
  const btn = document.getElementById('pAreas');
  if (btn) btn.classList.toggle('on', !!(PRESENT && AF.pane));
  document.getElementById('cwrap')?.classList.toggle('af-focus', !!(PRESENT && z));
}
function afPane(on) {
  AF.pane = on == null ? !AF.pane : !!on;
  afUI();
  if (AF.id) areaFocus(AF.id); // keep the area beside the pane
}

/* wiring */
(() => {
  const pbar = document.getElementById('pbar'),
    fitB = document.getElementById('pFit');
  if (pbar && !document.getElementById('pAreas')) {
    const b = document.createElement('button');
    b.id = 'pAreas';
    b.className = 'pareas';
    b.title = 'Areas — show one area of the loop at a time';
    b.textContent = '▦ Areas';
    if (fitB && fitB.nextSibling) pbar.insertBefore(b, fitB.nextSibling);
    else pbar.appendChild(b);
    b.addEventListener('click', () => afPane());
  }
  // Esc: back to the whole loop first (a second Esc leaves Publish as before)
  window.addEventListener(
    'keydown',
    e => {
      if (!PRESENT || e.key !== 'Escape' || $('#modal')?.classList.contains('on')) return;
      if (AF.id) {
        e.stopImmediatePropagation();
        e.preventDefault();
        afClear();
      } else if (AF.pane) {
        e.stopImmediatePropagation();
        e.preventDefault();
        afPane(false);
      }
    },
    true,
  );
  // alarm dots in the pane stay current
  setInterval(() => {
    if (PRESENT && AF.pane && !document.hidden) afUI();
  }, 2000);
})();
