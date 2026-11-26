/*! SandMan Digital Loop Studio — 27t-calc-label-style.js
 *  v10.4 — ƒx calculated-value labels on the drawing:
 *  · drag to move in every mode (Design, Simulate and Publish), no flicker while dragging;
 *  · right-click a label → Label style: Compact / Card / Big value / Pill, colour, size, reset position.
 *  Stored on the label's tag entry of the equipment: ent.cpos (position) and ent.look = { s, c, z }. */

const CTL_COLORS = { purple: ['#6d28d9', '#c4b5fd'], blue: ['#1d4ed8', '#93c5fd'], teal: ['#0f766e', '#5eead4'], green: ['#15803d', '#86efac'], orange: ['#c2410c', '#fdba74'], slate: ['#334155', '#cbd5e1'] };
const CTL_STYLES = [
  ['compact', 'Compact'],
  ['card', 'Card'],
  ['big', 'Big value'],
  ['pill', 'Pill'],
];
function ctlSvg(ent, t, v, bad, name, txt) {
  const L = ent.look || {},
    s = L.s || 'compact',
    [c, cl] = bad ? ['#b91c1c', '#fca5a5'] : CTL_COLORS[L.c] || CTL_COLORS.purple,
    vc = bad ? '#b91c1c' : v == null ? '#94a3b8' : '#0f172a',
    lim = [t.lo, t.hi].some(x => x != null) ? `${t.lo ?? '—'} – ${t.hi ?? '—'}` : '';
  const tw = (str, px) => String(str).length * px;
  if (s === 'card') {
    const w = Math.round(Math.max(130, Math.min(280, Math.max(tw(name, 6.4), tw(txt, 11.5)) + 26)));
    return `<rect class="ct-lb" width="${w}" height="62" rx="8" style="stroke:${cl}"/><path d="M0 8a8 8 0 0 1 8-8h${w - 16}a8 8 0 0 1 8 8v12H0z" fill="${c}"/><text x="9" y="14.5" fill="#fff" style="font:700 10.5px var(--sans)">ƒx  ${esc(name)}</text><text x="9" y="42" fill="${vc}" style="font:700 19px var(--mono)">${esc(txt)}</text>${lim ? `<text x="9" y="56" fill="#64748b" style="font:9.5px var(--sans)">Limits ${esc(lim)}</text>` : ''}<circle cx="${w - 11}" cy="36" r="4.5" fill="${bad ? '#dc2626' : v == null ? '#cbd5e1' : '#16a34a'}"/>`;
  }
  if (s === 'big') {
    const w = Math.round(Math.max(90, Math.min(260, Math.max(tw(name, 5.8), tw(txt, 15)) + 16)));
    return `<rect class="ct-lb" width="${w}" height="46" rx="6" style="stroke:${cl}"/><rect width="4" height="46" rx="2" fill="${c}"/><text x="10" y="13" fill="${c}" style="font:700 9.5px var(--sans)">ƒx ${esc(name)}</text><text x="10" y="37" fill="${vc}" style="font:700 22px var(--mono)">${esc(txt)}</text>`;
  }
  if (s === 'pill') {
    const w = Math.round(Math.min(320, 30 + tw(name, 5.9) + tw(txt, 7.8) + 14));
    return `<rect class="ct-lb" width="${w}" height="22" rx="11" style="fill:${c};stroke:${c}"/><text x="10" y="15" fill="#fff" style="font:700 11px var(--mono)">ƒx</text><text x="28" y="15" fill="#e9e5ff" style="font:600 10px var(--sans)">${esc(name)}</text><text x="${w - 10}" y="15" text-anchor="end" fill="#fff" style="font:700 11.5px var(--mono)">${esc(txt)}</text>`;
  }
  const w = Math.round(Math.max(96, Math.min(240, 32 + Math.max(name.length * 5.6, txt.length * 7.6 + 6))));
  return `<rect class="ct-lb" width="${w}" height="28" rx="5" style="stroke:${cl}"/><rect width="20" height="28" rx="5" fill="${c}"/><rect x="10" width="10" height="28" fill="${c}"/><text class="ct-lx" x="10" y="18" text-anchor="middle">ƒx</text><text class="ct-ln2" x="26" y="11">${esc(name)}</text><text class="ct-lv" x="26" y="24" style="fill:${vc}">${esc(txt)}</text>`;
}
ctLabelsAll = function () {
  if (CT_DRAG && CT_DRAG.moved) return; // never rebuild under the pointer
  const L = ctLayer();
  if (!L || !DOC) return;
  let html = '';
  for (const b of DOC.blocks) {
    const ents = (b.tags || []).filter(t => t.ct && REG[t.id] && REG[t.id].calc);
    if (!ents.length) continue;
    const { W } = dims(b);
    ents.forEach((e, i) => {
      const t = REG[e.id],
        v = VAL[e.id] ? VAL[e.id].v : null,
        bad = v != null && ((t.lo != null && v < t.lo) || (t.hi != null && v > t.hi)),
        name = String(t.short || '').replace(/^ƒx\s*/, ''),
        txt = v == null ? '—' : fmtN(v, t.d) + (t.unit ? ' ' + t.unit : '');
      const p = e.cpos || { x: W + 8, y: i * 32 },
        z = +(e.look && e.look.z) || 1;
      html += `<g class="ct-lab${bad ? ' bad' : ''}${v == null ? ' nd' : ''}" transform="translate(${b.x + p.x},${b.y + p.y})${z !== 1 ? ` scale(${z})` : ''}" data-ctid="${esc(e.id)}" data-cb="${b.id}"><title>${esc(t.desc)} — ${esc(t.addr || '')}\nDrag to move · right-click for label style</title>${ctlSvg(e, t, v, bad, name, txt)}</g>`;
    });
  }
  if (L.dataset.h !== html) {
    L.dataset.h = html;
    L.innerHTML = html;
  }
};
/* drag also in Publish (the original handler moves only outside Publish) */
document.addEventListener('pointermove', e => {
  const D = CT_DRAG;
  if (!D || MODE !== 'monitor') return;
  const k = (VIEW && VIEW.k) || 1,
    dx = (e.clientX - D.x0) / k,
    dy = (e.clientY - D.y0) / k;
  if (!D.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!D.moved) pushUndo();
  D.moved = true;
  D.ent.cpos = { x: Math.round(D.p0.x + dx), y: Math.round(D.p0.y + dy) };
  const z = +(D.ent.look && D.ent.look.z) || 1;
  D.l.setAttribute('transform', `translate(${D.b.x + D.ent.cpos.x},${D.b.y + D.ent.cpos.y})${z !== 1 ? ` scale(${z})` : ''}`);
});
/* keep the scale while the original handler drags */
document.addEventListener('pointermove', () => {
  const D = CT_DRAG;
  if (!D || !D.moved || MODE === 'monitor') return;
  const z = +(D.ent.look && D.ent.look.z) || 1;
  if (z !== 1) D.l.setAttribute('transform', `translate(${D.b.x + D.ent.cpos.x},${D.b.y + D.ent.cpos.y}) scale(${z})`);
});

/* right-click → Label style */
function ctlMenu(l, x, y) {
  const b = B(l.dataset.cb),
    ent = b && (b.tags || []).find(t => t.id === l.dataset.ctid);
  if (!ent) return;
  let M = $('#ctlMenu');
  if (!M) {
    document.body.insertAdjacentHTML('beforeend', '<div id="ctlMenu" role="dialog" aria-label="Label style"></div>');
    M = $('#ctlMenu');
  }
  const draw = () => {
    const L = ent.look || {};
    M.innerHTML = `<div class="ctl-h">Label style <small>${esc(String((REG[ent.id] || {}).short || '').replace(/^ƒx\s*/, ''))}</small></div>
     <div class="ctl-s">${CTL_STYLES.map(([k, n]) => `<button data-cs="${k}" class="${(L.s || 'compact') === k ? 'on' : ''}"><span class="ctl-pv ctl-${k}"></span>${n}</button>`).join('')}</div>
     <div class="ctl-l">Colour</div><div class="ctl-c">${Object.entries(CTL_COLORS).map(([k, [c]]) => `<button data-cc="${k}" class="${(L.c || 'purple') === k ? 'on' : ''}" style="background:${c}" title="${k}"></button>`).join('')}</div>
     <div class="ctl-l">Size</div><div class="ctl-z">${[[0.8, 'S'], [1, 'M'], [1.25, 'L'], [1.5, 'XL']].map(([z, n]) => `<button data-cz="${z}" class="${(+L.z || 1) === z ? 'on' : ''}">${n}</button>`).join('')}</div>
     <div class="ctl-f"><button data-cr>Reset position</button><button data-cx>Done</button></div><div class="ctl-n">Turns red when the value is outside its limits.</div>`;
    const set = (k, v) => {
      pushUndo();
      ent.look = Object.assign({}, ent.look, { [k]: v });
      changed();
      ctLabelsAll();
      draw();
    };
    $$('#ctlMenu [data-cs]').forEach(o => (o.onclick = () => set('s', o.dataset.cs)));
    $$('#ctlMenu [data-cc]').forEach(o => (o.onclick = () => set('c', o.dataset.cc)));
    $$('#ctlMenu [data-cz]').forEach(o => (o.onclick = () => set('z', +o.dataset.cz)));
    M.querySelector('[data-cr]').onclick = () => {
      pushUndo();
      delete ent.cpos;
      changed();
      ctLabelsAll();
    };
    M.querySelector('[data-cx]').onclick = ctlClose;
  };
  draw();
  M.style.display = 'block';
  const r = M.getBoundingClientRect();
  M.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  M.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function ctlClose() {
  const M = $('#ctlMenu');
  if (M) M.style.display = 'none';
}
document.addEventListener(
  'contextmenu',
  e => {
    const l = e.target.closest && e.target.closest('#Lct .ct-lab');
    if (!l) return;
    e.preventDefault();
    e.stopPropagation();
    CT_DRAG = null;
    ctlMenu(l, e.clientX, e.clientY);
  },
  true,
);
document.addEventListener('pointerdown', e => {
  const M = $('#ctlMenu');
  if (M && M.style.display === 'block' && !M.contains(e.target)) ctlClose();
});
document.addEventListener('keydown', e => e.key === 'Escape' && ctlClose());

document.head.insertAdjacentHTML(
  'beforeend',
  `<style id="ctlCss">
#Lct .ct-lab{cursor:grab}#Lct .ct-lab:active{cursor:grabbing}
#ctlMenu{display:none;position:fixed;z-index:9800;width:262px;background:#fff;border:1px solid #d5dce7;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:12px;font:13px var(--sans);color:#152238}
.ctl-h{font-weight:700;margin-bottom:8px}.ctl-h small{display:block;font-weight:400;color:#64748b}
.ctl-s{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ctl-s button{display:flex;flex-direction:column;align-items:center;gap:5px;border:1px solid #d5dce7;background:#fff;border-radius:8px;padding:8px 4px;font:600 12px var(--sans);cursor:pointer}.ctl-s button.on{border-color:#1f6feb;box-shadow:0 0 0 2px #dbeafe}
.ctl-pv{display:block;width:70px;height:24px;border-radius:4px;background:#fff;border:1px solid #c4b5fd;position:relative}
.ctl-compact::before{content:'';position:absolute;left:0;top:0;bottom:0;width:12px;background:#6d28d9;border-radius:3px 0 0 3px}
.ctl-card{height:30px}.ctl-card::before{content:'';position:absolute;left:0;right:0;top:0;height:8px;background:#6d28d9;border-radius:3px 3px 0 0}
.ctl-big::before{content:'12.4';position:absolute;left:8px;top:1px;font:700 16px var(--mono);color:#0f172a}.ctl-big::after{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:#6d28d9}
.ctl-pill{height:16px;margin:4px 0;border-radius:8px;background:#6d28d9;border-color:#6d28d9}
.ctl-l{margin:10px 0 5px;font:700 11px var(--sans);color:#64748b;text-transform:uppercase;letter-spacing:.06em}
.ctl-c{display:flex;gap:6px}.ctl-c button{width:24px;height:24px;border-radius:6px;border:2px solid transparent;cursor:pointer}.ctl-c button.on{border-color:#0f172a;box-shadow:inset 0 0 0 2px #fff}
.ctl-z{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.ctl-z button{border:1px solid #d5dce7;background:#fff;border-radius:6px;padding:4px;font:600 12px var(--sans);cursor:pointer}.ctl-z button.on{background:#1f6feb;color:#fff;border-color:#1f6feb}
.ctl-f{display:flex;justify-content:space-between;margin-top:12px}.ctl-f button{border:0;background:none;color:#1f6feb;font:600 12.5px var(--sans);cursor:pointer;padding:0}
.ctl-n{margin-top:6px;font-size:11.5px;color:#64748b}
</style>`,
);
