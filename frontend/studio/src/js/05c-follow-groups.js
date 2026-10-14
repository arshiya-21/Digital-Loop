/*! SandMan Digital Loop Studio — 05c-follow-groups.js
 *  v6.1 — 1. Follow the feed: process equipment whose feed has stopped runs on briefly (run-out, default 10 s) and
 *            then waits "Idle — no feed" (grey, not an alarm, not an operator stop); it starts again with its feed.
 *            Storage (silos, hoppers, bins, tanks) keeps running from stock. Per item: Follows its feed on / off.
 *         2. Group control: a group (Arrange › Group) can "Start / stop together" — stopping any member stops the
 *            group front to back (upstream first, so the line empties), starting starts it back to front
 *            (downstream first), with a delay between steps. A fault on a member stops everything feeding it in the
 *            group (interlock). Every start / stop (HMI rows and buttons, Properties, right-click) goes through here. */

const FOLLOW_SKIP = /silo|hopper|bin\b|_bin|tank|bunker|storage|buffer|truck|junction|weigh/i;
function followCapable(b) {
  const E = EQ[b.type];
  if (!E || E.widget || E.inst || E.notag || b.type === 'junction') return false;
  return !(FOLLOW_SKIP.test(b.type) || FOLLOW_SKIP.test(E.n || ''));
}
const follows = b => followCapable(b) && b.props.follow !== false;
/* equipment feeding b through material lines (data / signal lines and return lines do not feed) */
function feedersOf(b) {
  const out = [];
  DOC.streams.forEach(s => {
    if (s.to.b !== b.id || s.kind === 'data' || s.kind === 'ret') return;
    const u = B(s.from.b);
    if (!u) return;
    if (u.type === 'junction') DOC.streams.forEach(s2 => s2.to.b === u.id && s2.kind !== 'data' && B(s2.from.b) && out.push(B(s2.from.b)));
    else out.push(u);
  });
  return out.filter(x => x && x.id !== b.id);
}
// really running: its own switch, fault, idle AND the existing rules (a moulding line stops with its moulding machine …)
const liveNow = b => {
  try {
    return effRun(b);
  } catch (e) {
    return !b.props.oos && !IDLE[b.id];
  }
};
const GRP_TRIP = {};
function followTick() {
  if ((typeof RP !== 'undefined' && RP) || MODE !== 'monitor') {
    for (const k in IDLE) delete IDLE[k];
    for (const k in IDLE_SINCE) delete IDLE_SINCE[k];
    return;
  }
  const now = Date.now(),
    live = {};
  DOC.blocks.forEach(b => (live[b.id] = liveNow(b)));
  DOC.blocks.forEach(b => {
    if (!follows(b) || b.props.oos) {
      delete IDLE[b.id];
      delete IDLE_SINCE[b.id];
      return;
    }
    const F = feedersOf(b);
    if (!F.length || F.some(f => live[f.id])) {
      if (IDLE[b.id]) logEv(`${b.name} running again — feed back`);
      delete IDLE[b.id];
      delete IDLE_SINCE[b.id];
      return;
    }
    IDLE_SINCE[b.id] = IDLE_SINCE[b.id] || now;
    const ro = Math.max(0, b.props.runout ?? 10) * 1000;
    if (!IDLE[b.id] && now - IDLE_SINCE[b.id] >= ro) {
      IDLE[b.id] = true;
      logEv(`${b.name} idle — no feed (${F.map(f => f.name).join(', ')} stopped)`);
    }
  });
  // interlock: a faulted member of a control group stops everything feeding it in that group
  Object.entries(DOC.groups || {}).forEach(([g, info]) => {
    if (!info || !info.ctl) return;
    const seq = grpOrder(g);
    seq.forEach((m, i) => {
      const key = g + '|' + m.id,
        fault = !m.props.oos && blkSev(m) >= 3;
      if (!fault) return delete GRP_TRIP[key];
      if (GRP_TRIP[key]) return;
      GRP_TRIP[key] = true;
      const up = seq.slice(0, i).filter(x => !x.props.oos);
      if (!up.length) return;
      up.forEach(x => (x.props.oos = true));
      logEv(`Interlock: ${m.name} fault → stopped ${up.map(x => x.name).join(', ')} (${info.name || 'group'})`);
      toast(`Interlock: ${m.name} fault — ${up.map(x => x.name).join(', ')} stopped`);
      save();
    });
  });
}

/* ---------- groups: settings, order, start / stop together ---------- */
function grpInfo(g) {
  DOC.groups = DOC.groups || {};
  return DOC.groups[g] || (DOC.groups[g] = { name: '', ctl: false, delay: 2 });
}
const grpCtl = g => !!(g && DOC.groups && DOC.groups[g] && DOC.groups[g].ctl);
/* members in material-flow order, upstream first (members with no flow between them: left to right) */
function grpOrder(g) {
  const mem = grpMembers(g)
    .map(B)
    .filter(b => b && !EQ[b.type].widget);
  const ids = new Set(mem.map(b => b.id)),
    indeg = {},
    adj = {};
  mem.forEach(b => ((indeg[b.id] = 0), (adj[b.id] = [])));
  DOC.streams.forEach(s => {
    if (s.kind === 'data' || s.kind === 'ret') return;
    const a = s.from.b,
      c = s.to.b;
    if (ids.has(a) && ids.has(c) && a !== c) {
      adj[a].push(c);
      indeg[c]++;
    }
  });
  const byX = (p, q) => B(p).x - B(q).x;
  const q = mem.filter(b => !indeg[b.id]).map(b => b.id).sort(byX),
    out = [];
  while (q.length) {
    const id = q.shift();
    out.push(id);
    adj[id].forEach(n => --indeg[n] === 0 && (q.push(n), q.sort(byX)));
  }
  mem.forEach(b => !out.includes(b.id) && out.push(b.id)); // loops: the rest in place
  return out.map(B);
}
const GRP_TIMERS = {};
function groupRun(g, on, who = 'Operator') {
  const info = grpInfo(g),
    seq = grpOrder(g);
  if (on) seq.reverse(); // start back to front: downstream first, so nothing piles up
  (GRP_TIMERS[g] || []).forEach(clearTimeout);
  GRP_TIMERS[g] = [];
  const d = Math.max(0, +info.delay || 0) * 1000,
    nm = info.name || 'Group';
  const step = b => {
    b.props.oos = !on;
    delete IDLE[b.id];
    delete IDLE_SINCE[b.id];
  };
  seq.forEach((b, i) => {
    if (i === 0 || !d) step(b);
    else
      GRP_TIMERS[g].push(
        setTimeout(() => {
          step(b);
          evalAlerts();
          liveCanvas();
          renderDock();
          if (SEL) renderProps();
          save();
          if (i === seq.length - 1) toast(`${nm}: all ${on ? 'started' : 'stopped'}`);
        }, i * d),
      );
  });
  logEv(`${who}: ${on ? 'start' : 'stop'} ${nm} — ${seq.map(b => b.name).join(' → ')}`);
  toast(`${on ? 'Starting' : 'Stopping'} ${nm}: ${seq.map(b => b.name).join(' → ')}`);
}
/* the one way to start / stop equipment from the HMI, Properties and menus */
function setRunning(t, on, who) {
  if (!t) return;
  if (grpCtl(t.grp)) return groupRun(t.grp, on, who);
  t.props.oos = !on;
  delete IDLE[t.id];
  delete IDLE_SINCE[t.id];
}
