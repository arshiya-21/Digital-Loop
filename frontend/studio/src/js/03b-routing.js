/*! SandMan Digital Loop Studio — 03b-routing.js (loaded before the canvas so the first render can use it)
 *  v3.7 — connection line routing and bend editing (SCADA / PFD editor style)
 *  Routing modes per line (s.route):
 *    orth     Orthogonal 90° (default) — automatic right-angle path; once bends are edited it follows the user's
 *             bend points (s.pts) and adds right-angle elbows between them, so every segment stays horizontal/vertical
 *    auto     Auto (avoid equipment) — shortest clean right-angle path around equipment, recalculated when anything moves
 *    free     Free routing — straight segments through the user's bend points, any angle
 *    straight Straight — one direct segment
 *    curve    Curve — smooth curve (through the bend points, if any)
 *  Bend points are stored in canvas coordinates (s.pts = [{x, y}, …]); the two ends always stay on their ports, so
 *  moving equipment never breaks a connection. */

const ROUTES = {
  orth: 'Orthogonal 90°',
  auto: 'Auto (avoid equipment)',
  free: 'Free routing',
  straight: 'Straight',
  curve: 'Curve',
};
const routeOf = s => (s && ROUTES[s.route] ? s.route : 'orth');
const RDIR = { l: [-1, 0], r: [1, 0], t: [0, -1], b: [0, 1] };
const isH = side => side === 'l' || side === 'r';

/* right-angle path through the given points: elbows are added between points that are not aligned;
   the first leg leaves the start port in its direction, the last leg enters the end port in its direction */
function elbowPath(P, aSide, bSide) {
  const out = [P[0]];
  let dir = isH(aSide) ? 'H' : 'V';
  for (let i = 1; i < P.length; i++) {
    const p = out[out.length - 1],
      q = P[i];
    if (Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5) continue;
    if (Math.abs(p.y - q.y) < 0.5 || Math.abs(p.x - q.x) < 0.5) {
      dir = Math.abs(p.y - q.y) < 0.5 ? 'H' : 'V';
      out.push(q);
      continue;
    }
    let corner;
    if (i === P.length - 1) corner = isH(bSide) ? { x: p.x, y: q.y } : { x: q.x, y: p.y };
    else corner = dir === 'H' ? { x: q.x, y: p.y } : { x: p.x, y: q.y };
    out.push(corner, q);
    dir = Math.abs(corner.y - q.y) < 0.5 ? 'H' : 'V';
  }
  return out;
}
function simplify(pts) {
  const o = [];
  for (const p of pts) {
    const q = o[o.length - 1];
    if (q && Math.abs(q.x - p.x) < 0.5 && Math.abs(q.y - p.y) < 0.5) continue;
    o.push({ x: p.x, y: p.y });
  }
  for (let i = o.length - 2; i > 0; i--) {
    const a = o[i - 1],
      b = o[i],
      c = o[i + 1];
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) o.splice(i, 1);
  }
  return o;
}
/* smooth curve: Catmull-Rom through the points, sampled as a polyline (keeps flow animations and labels working) */
function curvePath(a, b, pts) {
  let P;
  if (pts && pts.length) P = [a, ...pts, b];
  else {
    const L = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y) / 2.2),
      da = RDIR[a.side] || [1, 0],
      db = RDIR[b.side] || [-1, 0];
    const c1 = { x: a.x + da[0] * L, y: a.y + da[1] * L },
      c2 = { x: b.x + db[0] * L, y: b.y + db[1] * L };
    const o = [];
    for (let i = 0; i <= 36; i++) {
      const t = i / 36,
        u = 1 - t;
      o.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
    }
    return o;
  }
  const o = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)],
      p1 = P[i],
      p2 = P[i + 1],
      p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < 14; k++) {
      const t = k / 14,
        t2 = t * t,
        t3 = t2 * t;
      const f = (v0, v1, v2, v3) => 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
      o.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  o.push({ x: b.x, y: b.y });
  return o;
}

/* ---------- Auto routing: right-angle path that avoids equipment (orthogonal visibility grid + Dijkstra) ---------- */
const AUTO_CACHE = new Map();
function autoObstacles(a, b, s) {
  const x0 = Math.min(a.x, b.x) - 500,
    x1 = Math.max(a.x, b.x) + 500,
    y0 = Math.min(a.y, b.y) - 500,
    y1 = Math.max(a.y, b.y) + 500,
    M = 12;
  const R = [];
  for (const o of DOC.blocks) {
    const E = EQ[o.type];
    if (!E || E.widget || o.type === 'junction') continue;
    const d = dims(o);
    if (o.x > x1 || o.x + d.W < x0 || o.y > y1 || o.y + d.H < y0) continue;
    R.push([o.x - M, o.y - M, o.x + d.W + M, o.y + d.H + M]);
  }
  return R;
}
function autoRoute(a, b, s) {
  const S = 22,
    da = RDIR[a.side] || [1, 0],
    db = RDIR[b.side] || [-1, 0];
  const s1 = { x: a.x + da[0] * S, y: a.y + da[1] * S },
    s2 = { x: b.x + db[0] * S, y: b.y + db[1] * S };
  const R = autoObstacles(a, b, s);
  const key = `${a.x},${a.y},${a.side}|${b.x},${b.y},${b.side}|${R.map(r => r.join(',')).join(';')}`;
  if (AUTO_CACHE.has(key)) return AUTO_CACHE.get(key);
  const inside = (x, y) => R.some(r => x > r[0] + 0.5 && x < r[2] - 0.5 && y > r[1] + 0.5 && y < r[3] - 0.5);
  const segFree = (x1, y1, x2, y2) =>
    !R.some(r => {
      if (y1 === y2) return y1 > r[1] + 0.5 && y1 < r[3] - 0.5 && Math.max(x1, x2) > r[0] + 0.5 && Math.min(x1, x2) < r[2] - 0.5;
      return x1 > r[0] + 0.5 && x1 < r[2] - 0.5 && Math.max(y1, y2) > r[1] + 0.5 && Math.min(y1, y2) < r[3] - 0.5;
    });
  const XS = [...new Set([s1.x, s2.x, ...R.flatMap(r => [r[0], r[2]])].map(v => Math.round(v)))].sort((p, q) => p - q);
  const YS = [...new Set([s1.y, s2.y, ...R.flatMap(r => [r[1], r[3]])].map(v => Math.round(v)))].sort((p, q) => p - q);
  const nx = XS.length,
    ny = YS.length,
    id = (i, j) => j * nx + i;
  const sx = XS.indexOf(Math.round(s1.x)),
    sy = YS.indexOf(Math.round(s1.y)),
    tx = XS.indexOf(Math.round(s2.x)),
    ty = YS.indexOf(Math.round(s2.y));
  let res = null;
  if (nx * ny <= 40000 && sx >= 0 && sy >= 0 && tx >= 0 && ty >= 0) {
    // Dijkstra on (node, direction); a bend costs extra so the path stays clean
    const BEND = 60,
      N = nx * ny,
      dist = new Float64Array(N * 2).fill(Infinity),
      prev = new Int32Array(N * 2).fill(-1);
    const heap = [];
    const push = (c, k) => {
      heap.push([c, k]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0],
        last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1,
            r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const startDir = isH(a.side) ? 0 : 1; // 0 = horizontal, 1 = vertical
    const k0 = id(sx, sy) * 2 + startDir;
    dist[k0] = 0;
    push(0, k0);
    let goal = -1;
    while (heap.length) {
      const [c, k] = pop();
      if (c > dist[k]) continue;
      const n = k >> 1,
        dir = k & 1,
        i = n % nx,
        j = (n / nx) | 0;
      if (i === tx && j === ty) {
        goal = k;
        break;
      }
      const nb = [
        [i - 1, j, 0],
        [i + 1, j, 0],
        [i, j - 1, 1],
        [i, j + 1, 1],
      ];
      for (const [ii, jj, nd] of nb) {
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const x1 = XS[i],
          y1 = YS[j],
          x2 = XS[ii],
          y2 = YS[jj];
        if (inside(x2, y2) && !(ii === tx && jj === ty)) continue;
        if (!segFree(x1, y1, x2, y2)) continue;
        const k2 = id(ii, jj) * 2 + nd,
          c2 = c + Math.abs(x2 - x1) + Math.abs(y2 - y1) + (nd !== dir ? BEND : 0);
        if (c2 < dist[k2]) {
          dist[k2] = c2;
          prev[k2] = k;
          push(c2, k2);
        }
      }
    }
    if (goal >= 0) {
      const path = [];
      for (let k = goal; k >= 0; k = prev[k]) {
        const n = k >> 1;
        path.push({ x: XS[n % nx], y: YS[(n / nx) | 0] });
      }
      path.reverse();
      res = simplify([a, s1, ...path, s2, b]);
    }
  }
  if (!res) res = null;
  if (AUTO_CACHE.size > 600) AUTO_CACHE.clear();
  AUTO_CACHE.set(key, res);
  return res;
}

/* the path of a line for its routing mode; called by streamGeom (04-canvas.js) */
function streamPath(s, a, b) {
  const mode = routeOf(s),
    up = Array.isArray(s.pts) && s.pts.length ? s.pts : null;
  if (mode === 'straight') return { pts: [a, b], axis: null, mode };
  if (mode === 'free') return { pts: simplify([a, ...(up || []), b]), axis: null, mode };
  if (mode === 'curve') return { pts: curvePath(a, b, up), axis: null, mode, curve: true };
  if (mode === 'auto') {
    const p = autoRoute(a, b, s);
    if (p) return { pts: p, axis: null, mode };
  }
  if (up) return { pts: simplify(elbowPath([a, ...up, b], a.side, b.side)), axis: null, mode };
  const R = route(a, b, s.mid);
  return { ...R, mode };
}

/* ---------- editing ---------- */
// the user's bend points = the interior corners of what is drawn now (so editing starts from the visible route)
function materialize(s) {
  const G = streamGeom(s);
  if (!G) return;
  const mode = routeOf(s);
  if (mode === 'curve') {
    s.pts = (s.pts || []).map(p => ({ x: p.x, y: p.y }));
    return;
  }
  if (mode === 'auto' || mode === 'straight') s.route = mode === 'straight' ? 'free' : 'orth';
  s.pts = G.pts.slice(1, -1).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  s.mid = null;
}
function routeHandles(s, G, hs) {
  if (!(SEL && SEL.t === 's' && SEL.id === s.id) || MODE !== 'design' || PRESENT) return '';
  const mode = routeOf(s);
  let h = '';
  // corners / bend points
  const corners = mode === 'curve' ? (s.pts || []) : G.pts.slice(1, -1);
  corners.forEach((p, i) => {
    h += `<circle class="bp" data-bs="${s.id}" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${hs * 0.55}"><title>Drag to move this bend · double-click to remove it</title></circle>`;
  });
  // segment handles: drag to shift the segment, or to add a bend on a sloping segment
  const P = mode === 'curve' ? [G.pts[0], ...(s.pts || []), G.pts[G.pts.length - 1]] : G.pts;
  for (let i = 0; i < P.length - 1; i++) {
    const p = P[i],
      q = P[i + 1],
      L = Math.hypot(q.x - p.x, q.y - p.y);
    if (L < hs * 3.2) continue;
    const hor = Math.abs(p.y - q.y) < 0.5,
      ver = Math.abs(p.x - q.x) < 0.5,
      cur = mode !== 'curve' && hor ? 'ns-resize' : mode !== 'curve' && ver ? 'ew-resize' : 'copy';
    const z = hs * 0.78;
    h += `<rect class="bseg" data-bs="${s.id}" data-g="${i}" x="${(p.x + q.x) / 2 - z / 2}" y="${(p.y + q.y) / 2 - z / 2}" width="${z}" height="${z}" rx="${z * 0.25}" style="cursor:${cur}"><title>${cur === 'copy' ? 'Drag to add a bend here' : 'Drag to move this segment'} · double-click the line to add a bend</title></rect>`;
  }
  return h;
}
const snapV = v => (typeof SNAP !== 'undefined' && SNAP ? Math.round(v / 10) * 10 : Math.round(v));
function alignTo(p, nbs, tol) {
  for (const n of nbs) {
    if (!n) continue;
    if (Math.abs(p.x - n.x) <= tol) p.x = n.x;
    if (Math.abs(p.y - n.y) <= tol) p.y = n.y;
  }
  return p;
}
function redrawStream(s) {
  const el = document.getElementById('st_' + s.id);
  if (el && typeof svgSwap === 'function') svgSwap(el, streamSVG(s));
  else renderSoon();
}
// start dragging a bend point (index into s.pts after materialize)
function bendDragStart(s, i, w) {
  return { k: 'bend', s, i, sx: w.x, sy: w.y, moved: false, mode0: routeOf(s) };
}
/* v5.1 — index of the segment nearest to a canvas point (same segment list the drag uses) */
function nearestSeg(s, w) {
  const G = streamGeom(s);
  if (!G) return 0;
  const P = routeOf(s) === 'curve' ? [G.pts[0], ...(s.pts || []), G.pts[G.pts.length - 1]] : G.pts;
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const p = P[i],
      q = P[i + 1],
      L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1,
      t = Math.max(0, Math.min(1, ((w.x - p.x) * (q.x - p.x) + (w.y - p.y) * (q.y - p.y)) / L2)),
      d = Math.hypot(p.x + t * (q.x - p.x) - w.x, p.y + t * (q.y - p.y) - w.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
function segDragStart(s, gi, w) {
  return { k: 'bseg', s, gi, sx: w.x, sy: w.y, moved: false };
}
function routeDragMove(drag, w, e) {
  const s = drag.s;
  if (!drag.moved) {
    if (Math.hypot(w.x - drag.sx, w.y - drag.sy) < 3) return;
    pushUndo();
    drag.moved = true;
    const was = routeOf(s);
    if (drag.k === 'bend') {
      if (was !== 'curve') {
        materialize(s);
        drag.i = Math.min(drag.i, s.pts.length - 1);
      }
    } else {
      // segment drag
      const G = streamGeom(s);
      const mode = routeOf(s);
      const P = mode === 'curve' ? [G.pts[0], ...(s.pts || []), G.pts[G.pts.length - 1]] : G.pts.map(p => ({ x: p.x, y: p.y }));
      const p = P[drag.gi],
        q = P[drag.gi + 1];
      const hor = mode !== 'curve' && Math.abs(p.y - q.y) < 0.5,
        ver = mode !== 'curve' && Math.abs(p.x - q.x) < 0.5;
      if (mode !== 'curve') materialize(s);
      const pts = s.pts || (s.pts = []);
      if (hor || ver) {
        // move the whole segment sideways; ends on a port get a short fixed stub so the port stays put
        let i0 = drag.gi - 1,
          i1 = drag.gi; // indices in s.pts of the segment's two ends (-1 / pts.length = a port)
        const a = P[0],
          b = P[P.length - 1];
        if (i0 < 0) {
          const d = RDIR[portSide(s, 'from')] || [1, 0],
            st = { x: a.x + d[0] * 20, y: a.y + d[1] * 20 };
          if (hor && d[1] !== 0) st.y = a.y; // keep the stub on the segment line
          if (ver && d[0] !== 0) st.x = a.x;
          pts.unshift({ ...st }, { ...st });
          i0 = 1;
          i1 += 2;
        }
        if (i1 >= pts.length) {
          const d = RDIR[portSide(s, 'to')] || [-1, 0],
            st = { x: b.x + d[0] * 20, y: b.y + d[1] * 20 };
          if (hor && d[1] !== 0) st.y = b.y;
          if (ver && d[0] !== 0) st.x = b.x;
          pts.push({ ...st }, { ...st });
          i1 = pts.length - 2;
        }
        drag.seg = { i0, i1, hor, o0: { ...pts[i0] }, o1: { ...pts[i1] } };
      } else {
        // sloping (free / curve / straight): add a bend in the middle and drag it
        const ins = mode === 'curve' ? drag.gi : drag.gi; // new point index in s.pts
        pts.splice(ins, 0, { x: Math.round((p.x + q.x) / 2), y: Math.round((p.y + q.y) / 2) });
        drag.k = 'bend';
        drag.i = ins;
      }
    }
    if (was === 'auto') toast('Line switched to Orthogonal 90° so your bends are kept');
    if (was === 'straight') toast('Line switched to Free routing so your bend is kept');
  }
  if (drag.k === 'bend') {
    const pts = s.pts;
    if (!pts || !pts[drag.i]) return;
    const G = streamGeom(s);
    const a = G.pts[0],
      b = G.pts[G.pts.length - 1];
    let p = { x: snapV(w.x), y: snapV(w.y) };
    const prev = drag.i > 0 ? pts[drag.i - 1] : a,
      next = drag.i < pts.length - 1 ? pts[drag.i + 1] : b;
    if (e.shiftKey && prev) {
      // Shift: horizontal or vertical from the previous point
      if (Math.abs(p.x - prev.x) > Math.abs(p.y - prev.y)) p.y = prev.y;
      else p.x = prev.x;
    } else alignTo(p, [prev, next], 8 / (VIEW.k || 1));
    pts[drag.i] = p;
  } else if (drag.seg) {
    const { i0, i1, hor, o0, o1 } = drag.seg,
      pts = s.pts;
    if (hor) {
      const y = snapV(o0.y + (w.y - drag.sy));
      pts[i0] = { x: o0.x, y };
      pts[i1] = { x: o1.x, y };
    } else {
      const x = snapV(o0.x + (w.x - drag.sx));
      pts[i0] = { x, y: o0.y };
      pts[i1] = { x, y: o1.y };
    }
  }
  redrawStream(s);
}
function routeDragEnd(drag) {
  if (!drag.moved) return;
  const s = drag.s;
  if (s.pts && routeOf(s) !== 'curve') {
    // tidy: drop duplicate and straight-through points, keep the path the same
    const G = streamGeom(s);
    if (G) s.pts = simplify(G.pts).slice(1, -1).map(p => ({ x: p.x, y: p.y }));
  }
  changed();
}
function portSide(s, end) {
  const e = s[end],
    p = portOf(B(e.b), e.p);
  return p ? p.side : 'r';
}
function addBendAt(s, w) {
  pushUndo();
  const mode = routeOf(s);
  if (mode !== 'curve') materialize(s);
  const G = streamGeom(s);
  const P = mode === 'curve' ? [G.pts[0], ...(s.pts || []), G.pts[G.pts.length - 1]] : G.pts;
  let best = 0,
    bd = Infinity;
  for (let i = 0; i < P.length - 1; i++) {
    const p = P[i],
      q = P[i + 1],
      L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1,
      t = Math.max(0, Math.min(1, ((w.x - p.x) * (q.x - p.x) + (w.y - p.y) * (q.y - p.y)) / L2)),
      d = Math.hypot(p.x + t * (q.x - p.x) - w.x, p.y + t * (q.y - p.y) - w.y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  const p = P[best],
    q = P[best + 1],
    L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 || 1,
    t = Math.max(0.05, Math.min(0.95, ((w.x - p.x) * (q.x - p.x) + (w.y - p.y) * (q.y - p.y)) / L2));
  const np = { x: snapV(p.x + t * (q.x - p.x)), y: snapV(p.y + t * (q.y - p.y)) };
  if (Math.abs(p.y - q.y) < 0.5) np.y = p.y;
  if (Math.abs(p.x - q.x) < 0.5) np.x = p.x;
  s.pts = s.pts || [];
  s.pts.splice(best, 0, np);
  if (routeOf(s) === 'straight') s.route = 'free';
  changed();
  toast('Bend added — drag the round handle to move it, double-click it to remove it');
}
function removeBend(s, i) {
  if (!s.pts || !s.pts[i]) return;
  pushUndo();
  if (routeOf(s) !== 'curve') materialize(s);
  s.pts.splice(i, 1);
  if (!s.pts.length) delete s.pts;
  changed();
}
function resetRoute(s) {
  pushUndo();
  delete s.pts;
  s.mid = null;
  changed();
  toast(`${s.name}: route reset (${ROUTES[routeOf(s)]})`);
}
function setRoute(s, r) {
  if (!ROUTES[r]) return;
  pushUndo();
  // keep the visible shape when moving between the editable modes
  if ((r === 'free' || r === 'orth' || r === 'curve') && routeOf(s) !== r && routeOf(s) !== 'curve' && !(s.pts && s.pts.length) && r !== 'orth') {
    const G = streamGeom(s);
    if (G) s.pts = G.pts.slice(1, -1).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
  s.route = r;
  if (r === 'auto' || r === 'straight') s.mid = null;
  changed();
  toast(`${s.name}: ${ROUTES[r]}`);
}
function reverseLine(s) {
  if (typeof reverseStream !== 'function') return;
  const from0 = s.from.b + '|' + s.from.p,
    pts = s.pts ? s.pts.slice().reverse() : null;
  reverseStream(s);
  if (pts && s.from.b + '|' + s.from.p !== from0) {
    s.pts = pts; // same path, drawn from the other end
    changed();
  }
}

/* ---------- right-click menu for a line ---------- */
function lineMenuItems(s, e, w) {
  const ds = MODE !== 'design';
  const col = s.color || KIND[s.kind]?.c || '#555';
  const toJ = B(s.to.b)?.type === 'junction';
  const sub = (items, title) => () => setTimeout(() => menu(e, items, { title }), 0);
  const symItems = key =>
    Object.entries(LINE_SYMS).map(([v, t]) => {
      const cur = key === 'endSym' ? s.endSym || (toJ ? 'none' : 'triangle') : s.startSym || 'none';
      return {
        t: `<span class="msym big" title="${esc(t)}">${symPreview(key, v, col, 'mpv')}</span><span class="msr">${esc(t)}</span>`,
        tip: t,
        sym: 1,
        k: cur === v ? '✓' : '',
        f: () => {
          pushUndo();
          s[key] = v;
          changed();
        },
        dis: ds,
      };
    });
  const G = streamGeom(s);
  const nearBend =
    w && s.pts && routeOf(s) !== 'auto'
      ? (routeOf(s) === 'curve' ? s.pts : G ? G.pts.slice(1, -1) : []).findIndex(p => Math.hypot(p.x - w.x, p.y - w.y) < 14 / (VIEW.k || 1))
      : -1;
  return [
    { t: 'Start point symbol ▸', f: sub(symItems('startSym'), 'Start point symbol'), dis: ds },
    { t: 'End point symbol ▸', f: sub(symItems('endSym'), 'End point symbol'), dis: ds },
    {
      t: 'Line style ▸',
      f: sub([
        ...Object.entries(LINE_DASH).map(([k, [n]]) => ({ t: n, k: (s.dash || 'solid') === k ? '✓' : '', f: () => (pushUndo(), (s.dash = k), changed()), dis: ds })),
        '-',
        ...[1, 1.5, 2, 2.6, 3, 4, 6].map(px => ({ t: `Width ${px} px`, k: (s.width || 2.6) === px ? '✓' : '', f: () => (pushUndo(), (s.width = px), changed()), dis: ds })),
      ], 'Line style'),
      dis: ds,
    },
    {
      t: 'Line type ▸',
      f: sub(
        Object.keys(KIND)
          .filter(k => k !== 'any')
          .map(k => ({ t: KIND[k].n, sw: KIND[k].c, k: s.kind === k ? '✓' : '', f: () => (pushUndo(), (s.kind = k), changed()), dis: ds }))
          .concat([{ t: 'Signal / data (any)', sw: KIND.any.c, k: s.kind === 'any' ? '✓' : '', f: () => (pushUndo(), (s.kind = 'any'), changed()), dis: ds }]),
        'Line type',
      ),
      dis: ds,
    },
    { t: 'Change line direction (reverse)', f: () => reverseLine(s), dis: ds },
    { t: `Routing: ${ROUTES[routeOf(s)]} ▸`, f: sub(Object.entries(ROUTES).map(([k, n]) => ({ t: n, k: routeOf(s) === k ? '✓' : '', f: () => setRoute(s, k), dis: ds })), 'Routing'), dis: ds },
    '-',
    { t: 'Add bend point here', f: () => w && addBendAt(s, w), dis: ds || !w || routeOf(s) === 'auto' },
    { t: 'Delete this bend point', f: () => removeBend(s, nearBend), dis: ds || nearBend < 0 },
    { t: 'Reset route', f: () => resetRoute(s), dis: ds || (!(s.pts && s.pts.length) && s.mid == null) },
    '-',
    {
      t: `Animation: ${(FLOW_STYLES || {})[s.anim || 'inherit']?.[0] || 'Same as flowsheet'} ▸`,
      f: () => setTimeout(() => menu(e, flowMenuItems(s)), 0),
    },
    { t: 'Properties…', f: () => (select({ t: 's', id: s.id }), openRight && openRight()) },
    '-',
    { t: 'Delete connection', k: 'Del', f: delSel, dis: ds },
  ];
}

/* ===================== v5.3 — insert a valve / fitting INTO a line =====================
 * Drop (library), place (click) or drag an unconnected two-port item (valve, control valve, damper, pump, flow
 * meter, reducer …) onto a line: the line splits into  source → item → destination.  The item turns to the line's
 * direction (rotated on vertical segments, mirrored against the flow) and its two ports sit on the line.
 * Hold Alt to drop without inserting. */
const INLINE_RE = /valve|damper|reducer|strainer|filter|pump|meter|_fv$|_ft$|coupler|ctrlvalve|flowmeter/i;
function inlinePorts(b) {
  const P = ports(b);
  if (P.length !== 2) return null;
  const inn = P.find(p => p.dir === 'in') || P.find(p => p.dir === 'io'),
    out = P.find(p => p !== inn && (p.dir === 'out' || p.dir === 'io'));
  return inn && out ? { inn, out } : null;
}
function inlineKind(b) {
  const E = b && EQ[b.type];
  if (!E || E.widget || b.type === 'junction') return '';
  if (!(INLINE_RE.test(b.type) || INLINE_RE.test(E.n || '') || E.inline)) return '';
  if (inlinePorts(b)) return 'split'; // two connection points: the line is split through the item
  return ports(b).length === 0 ? 'snap' : ''; // a plain valve symbol (no points): snapped onto the line
}
const inlineCapable = b => !!inlineKind(b);
const isFree = b => !DOC.streams.some(s => s.from.b === b.id || s.to.b === b.id);
/* the line under an item (its centre within reach of a segment), with the nearest point and the segment */
function inlineTarget(b) {
  if (!inlineCapable(b) || !isFree(b)) return null;
  const d = dims(b),
    c = { x: b.x + d.W / 2, y: b.y + d.H / 2 },
    reach = Math.max(14, Math.min(d.W, d.H) * 0.45);
  let best = null;
  for (const s of DOC.streams) {
    if (s.from.b === b.id || s.to.b === b.id) continue;
    const G = streamGeom(s);
    if (!G) continue;
    for (let i = 0; i < G.pts.length - 1; i++) {
      const p = G.pts[i],
        q = G.pts[i + 1],
        L2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (L2 < 400) continue; // segment too short to hold an item
      const t = Math.max(0.08, Math.min(0.92, ((c.x - p.x) * (q.x - p.x) + (c.y - p.y) * (q.y - p.y)) / L2)),
        x = p.x + t * (q.x - p.x),
        y = p.y + t * (q.y - p.y),
        dd = Math.hypot(x - c.x, y - c.y);
      if (dd <= reach && (!best || dd < best.d)) best = { s, i, p, q, x, y, d: dd };
    }
  }
  return best;
}
/* put the item on the segment: try the four orientations, keep the one whose ports lie on the line with the
   inlet upstream, then centre it on the drop point */
function inlineFit(b, T) {
  const E = EQ[b.type],
    hor = Math.abs(T.p.y - T.q.y) < 0.5,
    ver = Math.abs(T.p.x - T.q.x) < 0.5,
    dirx = Math.sign(T.q.x - T.p.x),
    diry = Math.sign(T.q.y - T.p.y);
  const tries = E.noflip ? [[0, false]] : [[0, false], [0, true], [90, false], [270, false], [180, false]];
  let best = null;
  for (const [rot, flip] of tries) {
    b.rot = rot;
    b.flip = flip;
    const io = inlinePorts(b);
    if (!io) continue;
    const vx = io.out.x - io.inn.x,
      vy = io.out.y - io.inn.y;
    // aligned with the segment and pointing downstream
    const along = hor ? Math.abs(vy) < 1 && Math.sign(vx) === dirx : ver ? Math.abs(vx) < 1 && Math.sign(vy) === diry : vx * (T.q.x - T.p.x) + vy * (T.q.y - T.p.y) > 0;
    const score = (along ? 0 : 1000) + (rot ? 1 : 0) + (flip ? 0.5 : 0);
    if (!best || score < best.score) best = { rot, flip, score };
  }
  b.rot = best.rot;
  b.flip = best.flip;
  const io = inlinePorts(b),
    mx = (io.inn.x + io.out.x) / 2,
    my = (io.inn.y + io.out.y) / 2;
  b.x = Math.round(b.x + (T.x - mx));
  b.y = Math.round(b.y + (T.y - my));
  if (hor) b.y = Math.round(b.y + (T.p.y - inlinePorts(b).inn.y)); // exactly on the line
  if (ver) b.x = Math.round(b.x + (T.p.x - inlinePorts(b).inn.x));
}
function insertInline(b, T) {
  const s = T.s,
    A = s.from,
    Bt = s.to;
  inlineFit(b, T);
  const io = inlinePorts(b);
  // first part keeps the line's name, tag and look; the second copies the look
  const keep = ['kind', 'dash', 'color', 'width', 'anim', 'route', 'startSym'];
  const s1 = connect(A.b, A.p, b.id, io.inn.id, s.kind),
    s2 = connect(b.id, io.out.id, Bt.b, Bt.p, s.kind);
  keep.forEach(k => {
    if (s[k] !== undefined) {
      s1[k] = s[k];
      if (k !== 'startSym') s2[k] = s[k];
    }
  });
  if (s.endSym !== undefined) s2.endSym = s.endSym;
  s1.name = s.name;
  s1.tag = s.tag || null;
  DOC.streams = DOC.streams.filter(x => x !== s);
  if (s1.route === 'free' || s1.route === 'curve') s1.route = s2.route = 'orth';
  return { s1, s2 };
}
/* highlight the line an item would go into while it is dragged */
function inlineHint(b) {
  const T = b ? inlineTarget(b) : null,
    id = T ? T.s.id : null;
  document.querySelectorAll('#Lstreams .stream.dropline').forEach(el => el.id !== 'st_' + id && el.classList.remove('dropline'));
  if (id) document.getElementById('st_' + id)?.classList.add('dropline');
  return T;
}
/* called after an item was dropped / placed / moved */
function tryInline(b, e) {
  inlineHint(null);
  if (!b || (e && e.altKey) || MODE !== 'design') return false;
  const T = inlineTarget(b);
  if (!T) return false;
  const n = T.s.name;
  if (inlineKind(b) === 'snap') {
    // symbol without connection points: centre it on the line and turn it with the line
    const ver = Math.abs(T.p.x - T.q.x) < 0.5;
    if (!EQ[b.type].noflip) b.rot = ver ? 90 : 0;
    const d = dims(b);
    b.x = Math.round(T.x - d.W / 2);
    b.y = Math.round(T.y - d.H / 2);
    toast(`${b.name} placed on line ${n}`);
    return true;
  }
  const r = insertInline(b, T);
  logEv(`${b.name} inserted into line ${n}`);
  toast(`${b.name} inserted into line ${n} (${B(r.s1.from.b)?.name || ''} → ${b.name} → ${B(r.s2.to.b)?.name || ''}) · hold Alt to drop without inserting`);
  return true;
}
