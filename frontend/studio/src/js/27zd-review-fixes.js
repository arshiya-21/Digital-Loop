/*! SandMan Digital Loop Studio — 27zd-review-fixes.js
 *  v10.4 — fixes from the 4-module review (Developer Specification & Review, 25 Nov 2026) that the Studio can make:
 *   M1 · Animation: min / max pairs refused when wrong (Level empty < full, Position 0 % ≠ 100 %, Colour band 1 < band 2);
 *        Simulate tells that query (SQL) tags only move with live data.
 *   M2 · Alerts: the "not again within N min" check also reads the email log saved with the loop, so a page reload or a
 *        second browser that loaded the same loop does not send the same alert again; renaming a team also renames it
 *        on tickets, ticket rules and defaults.
 *   M4 · QR: stickers are printed only for a real web address (http/https), never about:, file: or blank.
 *  Fixes that need the sandman.co.in server (alerts / ticket days evaluated with no page open, ticket table, roles,
 *  sending) are in the review document. */

/* ---------- M1: refuse wrong min / max pairs ---------- */
const AD_PAIRS = [
  ['lvLo', 'lvHi', (a, b) => a < b, 'Empty at must be lower than Full at'],
  ['b1', 'b2', (a, b) => a < b, 'The first colour band must end below the second'],
  ['pLo', 'pHi', (a, b) => a !== b, 'Value at 0 % and value at 100 % must differ'],
];
document.addEventListener(
  'change',
  e => {
    const x = e.target;
    if (!x.matches || !x.matches('#drvSec input[data-adf]')) return;
    const k = x.dataset.adf,
      pair = AD_PAIRS.find(p => p[0] === k || p[1] === k);
    if (!pair || x.value === '') return;
    const b = SEL && SEL.t === 'b' ? B(SEL.id) : null;
    if (!b) return;
    const c = Object.assign({}, adCfg(b) || {}, b.props.drive || {});
    const lo = k === pair[0] ? +x.value : c[pair[0]] != null && c[pair[0]] !== '' ? +c[pair[0]] : null,
      hi = k === pair[1] ? +x.value : c[pair[1]] != null && c[pair[1]] !== '' ? +c[pair[1]] : null;
    if (lo == null || hi == null || pair[2](lo, hi)) return;
    e.stopImmediatePropagation();
    toast(pair[3]);
    x.value = c[k] != null ? c[k] : '';
    x.classList.add('ad-badin');
    setTimeout(() => x.classList.remove('ad-badin'), 1500);
  },
  true,
);
/* query tags have no demo value: say so in Simulate instead of looking broken */
{
  const prev = adText;
  adText = function (b) {
    const t = prev(b),
      c = adCfg(b);
    if (MODE === 'sim' && c && c.tag && REG[c.tag] && REG[c.tag].link && REG[c.tag].link.sql) return 'This tag is a database query: it moves with live data in Publish. In Simulate the drawing keeps its own pace.';
    return t;
  };
  drvText = function (b) {
    return adText(b);
  };
}

/* ---------- M2: no repeat email after a reload or from a second browser ---------- */
{
  const prev = rtSend;
  rtSend = function (key, what) {
    /* plant rule: tags and calculated values email only when outside LL / HH (Critical);
       an engineered alert emails whenever its own condition fires (average over N min, statistics …) */
    const a = ALERTS[key];
    if (what !== 'clear' && !emailWorthy(key, a && a.sev)) return;
    if (what === 'start') {
      const R = rtDoc(),
        win = rtRepeatMin(key) * 60000,
        now = Date.now();
      const recent = (engDoc().outbox || []).find(o => o.ch === 'email' && o.inst === key && now - o.t < win && !/^\[Back to normal\]/.test(o.subject || ''));
      if (recent) {
        RT.last[key] = recent.t;
        return;
      }
    }
    return prev.apply(this, arguments);
  };
}
function emailWorthy(key, sev) {
  if (!sev) return false;
  return key.startsWith('eng:') ? true : sev >= 3;
}
/* a ticket only from what was emailed: the same alert emailed on N days in a row */
{
  const prev = tkHit;
  tkHit = function (key, name, equip, sev, vals) {
    const a = ALERTS[key];
    if (!emailWorthy(key, (a && a.sev) || sev)) return;
    return prev.apply(this, arguments);
  };
}
/* renaming a team: tickets, ticket rules and defaults follow */
document.addEventListener(
  'change',
  e => {
    const x = e.target;
    if (!x.matches || !x.matches('[data-rttn]')) return;
    const t = rtTeams()[+x.dataset.rttn];
    if (!t) return;
    const old = t.name,
      nw = x.value.trim();
    if (!nw || nw === old || rtTeams().some(o => o !== t && o.name === nw)) return;
    const T = tkDoc(),
      ren = n => (n === old ? nw : n);
    (T.list || []).forEach(tk => {
      tk.owner = ren(tk.owner);
      if (Array.isArray(tk.cc)) tk.cc = tk.cc.map(ren);
    });
    Object.values(T.rules || {}).forEach(r => {
      if (r.owner) r.owner = ren(r.owner);
      if (Array.isArray(r.cc)) r.cc = r.cc.map(ren);
    });
    ['owner', 'esc1', 'esc2'].forEach(k => T.set && T.set[k] && (T.set[k] = ren(T.set[k])));
    if (T.people) Object.keys(T.people).forEach(p => Array.isArray(T.people[p]) && (T.people[p] = T.people[p].map(ren)));
    engDoc().rules.forEach(r => r.escTo && (r.escTo = ren(r.escTo)));
  },
  true,
);

/* ---------- M4: print stickers only for a real web address ---------- */
function qrBaseOk(u) {
  return /^https?:\/\/[^\s/]+\.[^\s]+/i.test(String(u || '').trim());
}
{
  const guard = (fn, getBase) =>
    function () {
      const base = getBase();
      if (!qrBaseOk(base)) {
        toast('Set the web address of the live Digital Loop (https://…) on the Machine QR tab before printing stickers');
        const f = $('#mcBase');
        if (f) (f.focus(), f.classList.add('ad-badin'));
        return;
      }
      return fn.apply(this, arguments);
    };
  qcPrint = guard(qcPrint, () => ($('#mcBase') && $('#mcBase').value.trim()) || mcBase());
  mntPrintStickers = guard(mntPrintStickers, () => ($('#mcBase') && $('#mcBase').value.trim()) || mcBase());
}
document.head.insertAdjacentHTML('beforeend', '<style>.ad-badin{border-color:#dc2626!important;background:#fef2f2!important}</style>');
