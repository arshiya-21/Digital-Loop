/*! SandMan Digital Loop Studio — 20-live-monitor.js
 *  v9.47 — Live monitor panel in the Publish view + monitored-parameter picker.
 *  · The panel sits beside the drawing (left side by default, ⇄ moves it to the right) and stays visible while publishing; the
 *    drawing refits into the remaining area, so nothing is covered.
 *  · Alarms: every active alarm, critical first, then warnings, then advisories (newest first within a level);
 *    unacknowledged critical alarms flash. Ack, Ack all and Locate (the equipment is ringed on the drawing).
 *  · Monitored parameters: the readings chosen by the user (DOC.mon.tags), each with its equipment, live value
 *    coloured by its state and a small trend of the last minutes; click one for its full chart.
 *  · Picker (Publish › ✎ Choose, or Data › Live panel): all tags of the flowsheet with their equipment and area,
 *    searchable and filterable — thousands of tags are fine (the list shows the best 400 matches); tick the
 *    parameters to monitor, reorder or remove them; "Suggested set" picks the critical process checks.
 *  Saved with the flowsheet: DOC.mon = { on, side, tags: [tagId…] }. */

var MP = { ALV: -1, sig: '', show: false, wasP: false }; // v9.47.4: hidden on every Publish entry until “Live panel” is clicked
const mpCfg = () => (DOC.mon = DOC.mon || { on: true, tags: null });
const mpOn = () => !window.MP_OFF && MP.show === true; // window.MP_OFF: tests of the full-screen page fit

/* ---------- which parameters ---------- */
function mpSuggested() {
  const out = [],
    add = id => REG[id] && !out.includes(id) && out.push(id);
  (DOC.cps || []).forEach(c => (c.items || []).forEach(i => i.kind === 'auto' && i.crit && mpOwner(i.tag) && add(i.tag)));
  DOC.blocks.forEach(b => b.tags.forEach(t => t.show && REG[t.id] && (REG[t.id].hi != null || REG[t.id].lo != null) && add(t.id)));
  DOC.blocks.forEach(b => b.tags.forEach(t => t.show && add(t.id)));
  /*
   * Only the readings a database is answering for.
   *
   * The twelve are taken in order of importance — critical process checks,
   * then anything with a limit on it, then the rest — and on this plant most
   * of those are not linked to a database at all. The panel opened on twelve
   * squeeze pressures and compactabilities every one of which read "—".
   *
   * Putting the answering ones first was not enough: there are only a handful
   * of them, so the rest of the twelve filled with dashes underneath. A row
   * that will never carry a number is not a row, so it is not offered — and
   * on a loop where nothing is linked yet the panel says so plainly instead
   * of showing twelve of nothing.
   *
   * `val` returns null for a reading with no record — see
   * `showNothingWithoutData`, which is what stops the studio drawing its own
   * simulation as though it were the plant. That is the whole test.
   *
   * Importance still decides the order, because the list is only filtered,
   * never re-ranked. Anything left out is a tick away under ✎ Choose.
   */
  return out.filter(id => val(id) != null).slice(0, 12);
}
/**
 * The worst alert raised on a reading today, as a number. 0 means none.
 *
 * Today, not "still active": a bentonite level that went critical at nine and
 * was brought back by ten is the thing that mattered on this line this
 * morning, and burying it under the readings that behaved would be hiding the
 * one worth looking at. An alert from yesterday is yesterday's shift.
 *
 * `cleared` is not consulted — an alert that returned to normal is still an
 * alert that happened. `t` is when it was raised, which is the question.
 */
function mpWorstToday(id) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  let worst = 0;
  for (const a of Object.values(ALERTS)) {
    if (a.tagId !== id) continue;
    const at = a.t instanceof Date ? a.t : new Date(a.t);
    // A record with no readable time is not evidence about today either way.
    if (Number.isNaN(at.getTime()) || at < midnight) continue;
    if (a.sev > worst) worst = a.sev;
  }
  return worst;
}

/**
 * The monitored readings: worst first today, alphabetical under that.
 *
 * An operator walking up to this panel has one question — what needs me — and
 * the answer should be the top line, not something to scan for. So the worst
 * thing that happened today rises: critical, then warning, then advisory,
 * then everything that has behaved itself.
 *
 * One rule, not two. Sorting the alerted part by severity and leaving the
 * rest in whatever order they were picked was tried first, and it means the
 * bottom of the list rearranges itself the moment anything goes wrong — so
 * the reading somebody knows is fourth from the end moves while they are
 * looking away from it. With the name as the tie-break the quiet part of the
 * list never moves, and a day with no alerts at all is simply alphabetical,
 * which is the same rule with every severity at nought.
 *
 * Alphabetical by what is on screen — the description, falling back to the id
 * — because that is what somebody reads down, not the tag name underneath it.
 * `localeCompare` so an accented name sorts where a person looks for it.
 */
function mpTags() {
  const c = mpCfg();
  const list = Array.isArray(c.tags) ? c.tags : mpSuggested();
  const picked = list.filter(id => REG[id]);

  /*
   * A reading that went into alarm today is on this panel whether it was
   * picked or not.
   *
   * Ordering alone is not enough, and the first build of this proved it: the
   * bentonite bin level went to warning, and the panel showed twelve squeeze
   * pressures and compactabilities with no bentonite anywhere — because the
   * suggested set had filled up before reaching it. Sorting a list the
   * reading is not in cannot put it first.
   *
   * So what is in alarm joins the list. The picked set is what somebody
   * chose to watch; this is what is asking to be watched, and a panel headed
   * "Fault alarm" that leaves out the reading in alarm is answering the wrong
   * question.
   */
  /*
   * ...unless somebody has chosen. An explicit selection — including an empty
   * one — is the person's decision and is honoured exactly: unticking the
   * bentonite level and saving must take it off the panel, and it must not be
   * ticked again next time the picker opens. The alarm itself is still listed
   * in the Alarms section above; this is only the Monitored parameters list.
   */
  const alarming = Array.isArray(c.tags)
    ? []
    : [...new Set(Object.values(ALERTS).map(a => a.tagId))]
        .filter(id => id && REG[id] && !picked.includes(id) && mpWorstToday(id) > 0);

  const shown = picked.concat(alarming);
  const worst = new Map(shown.map(id => [id, mpWorstToday(id)]));
  const named = id => String(REG[id].desc || id);

  return shown.sort((a, b) =>
    worst.get(b) - worst.get(a) || named(a).localeCompare(named(b)));
}
function mpOwner(id) {
  const o = tagOwner(id);
  if (o) return o.b ? o.b.name : o.s ? o.s.name : '';
  // a process-check reading names its equipment ("Prepared sand moisture — MX-1")
  for (const c of DOC.cps || [])
    for (const i of c.items || [])
      if (i.tag === id && / — /.test(i.name || '')) {
        const n = i.name.split(' — ').pop().trim();
        if (DOC.blocks.some(b => b.name === n)) return n;
      }
  return '';
}
function mpArea(id) {
  const o = tagOwner(id);
  if (!o || !o.b) return '';
  const c = (DOC.cps || []).find(c => (c.blocks || []).includes(o.b.id));
  return c ? c.name : '';
}

/* ---------- panel ---------- */
function mpEnsure() {
  let p = $('#mpanel');
  if (!p) {
    p = document.createElement('aside');
    p.className = 'mpanel';
    p.id = 'mpanel';
    p.setAttribute('aria-label', 'Live monitor');
    $('.work').appendChild(p);
  }
  if (!p.dataset.ready) {
    p.dataset.ready = '1';
    p.innerHTML = `<div class="mp-hd"><span class="mp-live"><i></i>LIVE MONITOR</span><span class="mp-clk" id="mpClk"></span><button class="mp-sd" id="mpSide" title="Move the panel to the other side">⇄</button><button class="mp-x" id="mpHide" title="Hide the live panel (the drawing uses the full width)">✕</button></div>
<section class="mp-sec mp-als"><div class="mp-sh"><b>Alarms</b><span class="mp-cnt" id="mpCnt"></span><button class="mp-b" id="mpAckAll" title="Acknowledge all alarms">Ack all</button></div><div class="mp-list" id="mpAl"></div></section>
<section class="mp-sec mp-pas"><div class="mp-sh"><b>Monitored parameters</b><span class="mp-n" id="mpN"></span><button class="mp-b" id="mpEdit" title="Choose the parameters shown here">✎ Choose</button></div><div class="mp-list" id="mpPa"></div></section>`;
    $('#mpHide').onclick = () => mpSet(false);
    $('#mpSide').onclick = () => {
      mpCfg().side = mpCfg().side === 'right' ? 'left' : 'right';
      save();
      mpSync();
      requestAnimationFrame(() => requestAnimationFrame(() => PRESENT && presentFit()));
    };
    $('#mpAckAll').onclick = () => (ackAll(), mpRender(true));
    $('#mpEdit').onclick = mpPicker;
  }
  return p;
}
function mpSet(on) {
  MP.show = !!on;
  mpSync();
  requestAnimationFrame(() => requestAnimationFrame(() => typeof presentFit === 'function' && PRESENT && presentFit()));
}
function mpSync() {
  if (!!PRESENT !== MP.wasP) {
    MP.wasP = !!PRESENT;
    MP.show = false; // v9.47.4: each Publish entry starts with the panel closed
  }
  const on = PRESENT && mpOn();
  document.body.classList.toggle('mpon', on);
  document.body.classList.toggle('mpright', mpCfg().side === 'right'); // v9.47: left by default
  const b = $('#pMon');
  if (b) b.classList.toggle('on', mpOn());
  if (on) {
    mpEnsure();
    mpRender(true);
  }
}
function mpAlarmList() {
  return Object.values(ALERTS)
    .filter(a => a.active || !a.acked)
    .sort((a, b) => b.active - a.active || b.sev - a.sev || a.acked - b.acked || b.t - a.t);
}
function mpRender(force) {
  if (!PRESENT || !mpOn()) return;
  mpEnsure();
  const d = new Date();
  $('#mpClk').textContent = hms(d);
  // alarms (rebuilt only when they change)
  const al = mpAlarmList();
  const sig = al.map(a => a.key + a.sev + (a.acked ? 'a' : '') + (a.active ? 'x' : '')).join('|');
  if (force || sig !== MP.sig) {
    MP.sig = sig;
    const n = [3, 2, 1].map(s => al.filter(a => a.active && a.sev === s).length);
    $('#mpCnt').innerHTML = [3, 2, 1].map((s, i) => `<i class="mpc${s}" title="${SEVN[s]}">${n[i]}</i>`).join('');
    $('#mpAl').innerHTML = al.length
      ? al
          .map(
            /*
             * Every unacknowledged alarm flashes, not only the criticals.
             *
             * Flashing one severity and not the others reads as the warning
             * having been seen when nobody has touched it — and being seen is
             * exactly what acknowledging means. So the flash follows the
             * acknowledgement, and the colour follows the severity: see
             * `.mps1/.mps2/.mps3 .mp-a.flash` in the stylesheet, where a
             * warning flashes amber rather than borrowing a critical's red.
             *
             * One that has returned to normal does not flash. It stays in the
             * list until it is acknowledged, because somebody should know it
             * happened, but it is no longer asking for a hand.
             */
            a => `<div class="mp-a mps${a.sev}${a.acked ? ' ack' : ''}${a.active ? '' : ' rtn'}${!a.acked && a.active ? ' flash' : ''}" data-k="${esc(a.key)}">
  <div class="mp-a1"><span class="mp-chip">${SEVN[a.sev].toUpperCase()}</span><b>${esc(a.where)}</b><span class="mp-t">${hms(a.t)}</span></div>
  <div class="mp-a2">${esc(a.msg)}${a.tagId ? ` <span class="mp-v" data-live="${esc(a.tagId)}">${fmtT(a.tagId)}</span>` : ''}</div>
  <div class="mp-a3">${a.active ? (a.acked ? 'Active · acknowledged' : 'Active · not acknowledged') : 'Back to normal · not acknowledged'}${a.blk ? `<button class="mp-b" data-loc="${a.blk}">⌖ Locate</button>` : ''}${a.acked ? '' : `<button class="mp-b" data-ack="${esc(a.key)}">Ack</button>`}</div></div>`,
          )
          .join('')
      : `<div class="mp-ok"><i>✓</i>No active alarms — unit running normally</div>`;
    $$('#mpAl [data-ack]').forEach(x => (x.onclick = () => (ack(x.dataset.ack), mpRender(true))));
    $$('#mpAl [data-loc]').forEach(x => (x.onclick = () => mpLocate(x.dataset.loc)));
  }
  // parameters
  const tags = mpTags();
  $('#mpN').textContent = tags.length;
  const pa = $('#mpPa'),
    want = tags.join('|');
  if (force || pa.dataset.k !== want) {
    pa.dataset.k = want;
    pa.innerHTML = tags.length
      ? tags
          .map(id => {
            const t = REG[id];
            return `<div class="mp-p" data-t="${esc(id)}" title="${esc(t.desc || id)} (${esc(id)}) — click for the full chart"><div class="mp-p1">${mpOwner(id) ? `<b>${esc(mpOwner(id))}</b>` : ''}<span>${esc(t.desc || t.short || id)}</span></div><div class="mp-p2"><span class="mp-pv" id="mpv_${esc(id)}"></span><svg class="mp-sp" viewBox="0 0 120 30" preserveAspectRatio="none"><path class="mp-band" id="mpb_${esc(id)}"/><polyline id="mps_${esc(id)}"/></svg></div></div>`;
          })
          .join('')
      : `<div class="mp-ok mp-empty">No parameters chosen.<button class="mp-b" id="mpEdit2">✎ Choose parameters</button></div>`;
    $$('#mpPa [data-t]').forEach(x => (x.onclick = () => openTrend(x.dataset.t)));
    if ($('#mpEdit2')) $('#mpEdit2').onclick = mpPicker;
  }
  tags.forEach(id => {
    const t = REG[id],
      v = val(id),
      s = tagSev(id),
      el = document.getElementById('mpv_' + id);
    if (el) {
      el.innerHTML = tagIsText(t) ? esc(tagTxt(id)) : `${fmtN(v, t.d)}<small>${esc(t.unit || '')}</small>`;
      el.className = 'mp-pv mpv' + s;
    }
    const pl = document.getElementById('mps_' + id),
      bd = document.getElementById('mpb_' + id);
    /*
     * The poll's own history, or the plant's records where it has none.
     *
     * `VAL[id].h` gains a point only when a *new* record arrives, so a
     * reading the plant stamps every few minutes has one point for the first
     * few minutes and no line beside a value that is plainly live. The
     * records behind the trend answer it and are already fetched — see
     * `seedPanelHistory` — so they stand in until the poll has built a run
     * of its own.
     *
     * The poll's history wins once it is the longer of the two: it is this
     * minute's, where the records are the window's.
     */
    const polled = (VAL[id] && VAL[id].h) || [];
    const stored = typeof window.dlHistory === 'function' ? window.dlHistory(id) : [];
    const H = polled.length > 1 && polled.length >= stored.length ? polled : stored.length > 1 ? stored : polled;
    if (pl && H.length > 1) {
      const pts = H.slice(-120),
        vs = pts.map(p => p.v);
      /*
       * Scaled to the readings, not to the limits.
       *
       * The range used to be stretched to take in Min and Max, and on a
       * reading that sits well inside them that leaves no room for the
       * reading itself: a bentonite level moving between 52.5 and 52.9 was
       * drawn across a scale running 15 to 92, which is a flat line in a
       * 30-pixel strip. The limits are already on the row — the value is
       * coloured by them, and an alarm says so in the list above — so the
       * strip is free to be about the one thing nothing else shows, which is
       * whether the reading is moving and which way.
       *
       * The Min / Max band goes with it. Drawn against a scale that no longer
       * reaches the limits it would fill the whole strip, saying nothing and
       * hiding the line behind it.
       */
      let lo = Math.min(...vs),
        hi = Math.max(...vs);
      /*
       * A flat run still needs a scale to be drawn against. Without this the
       * range is nought wide and every point divides by zero — a reading
       * parked on one value draws nothing at all rather than a straight line.
       */
      const spread = hi - lo;
      const pad = spread > 0 ? spread * 0.18 : Math.max(Math.abs(hi) * 0.01, 0.5);
      lo -= pad;
      hi += pad;
      const y = v => (30 - ((v - lo) / (hi - lo)) * 30).toFixed(1);
      pl.setAttribute('points', pts.map((p, i) => `${((i / (pts.length - 1)) * 120).toFixed(1)},${y(p.v)}`).join(' '));
      pl.setAttribute('class', 'mpl' + s);
      if (bd) bd.setAttribute('d', '');
    }
  });
}
/* ring the equipment of an alarm on the drawing for a few seconds */
function mpLocate(id) {
  const b = B(id),
    g = document.getElementById('bk_' + id);
  if (!b || !g) return;
  if (typeof afClear === 'function') afClear(true);
  const { W, H } = dims(b),
    r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  Object.entries({ class: 'mp-ring', x: -10, y: -10, width: W + 20, height: H + 20, rx: 10 }).forEach(([k, v]) => r.setAttribute(k, v));
  g.appendChild(r);
  setTimeout(() => r.remove(), 6000);
  toast(`${b.name} — ${b.props.desc || EQ[b.type].n || ''}`);
}

/* ---------- picker ---------- */
function mpPicker() {
  const all = Object.keys(REG).sort((a, b) => (mpOwner(a) + a).localeCompare(mpOwner(b) + b));
  // What was saved (or the suggested set if nothing was) — never the alarm auto-joins.
  let sel = (Array.isArray(mpCfg().tags) ? mpCfg().tags : mpSuggested()).filter(id => REG[id]);
  const eqs = [...new Set(all.map(mpOwner).filter(Boolean))].sort();
  openModal(
    `<h3>Monitored parameters</h3><div class="note">Choose the readings shown in the Publish view's live panel. Search by tag, description or equipment, tick the ones to monitor and order them on the right. Keep it to the parameters that matter on the shop floor — about 10 to 20 reads best on a TV.</div>
<div class="mpk">
 <div class="mpk-l"><div class="mpk-bar"><input id="mpkQ" type="search" placeholder="Search tags — name, description, equipment…" aria-label="Search tags"><select id="mpkEq" aria-label="Equipment"><option value="">All equipment</option>${eqs.map(e => `<option>${esc(e)}</option>`).join('')}</select><label class="chk"><input type="checkbox" id="mpkLim"> With alarm limits</label><label class="chk" title="Tags left over from other loops are not on any equipment of this flowsheet"><input type="checkbox" id="mpkOwn" checked> On this flowsheet</label><label class="chk" title="Only the readings a database is answering for. The rest have no value to show and would sit on the panel as a dash."><input type="checkbox" id="mpkLive" checked> Reading from the plant</label></div>
  <div class="mpk-tbl"><table><thead><tr><th></th><th>Tag</th><th>Description</th><th>Equipment</th><th>Area</th><th class="num">Value</th></tr></thead><tbody id="mpkRows"></tbody></table></div><div class="note" id="mpkMore"></div></div>
 <div class="mpk-r"><div class="mpk-sh"><b>Selected</b> <span id="mpkN"></span></div><div id="mpkSel" class="mpk-sel"></div></div>
</div>
<div class="mact"><button class="ib" id="mpkClr">Clear all</button><button class="ib" id="mpkSug" title="The critical process checks and the readings shown on the drawing">Suggested set</button><span style="flex:1"></span><button class="ib" id="mpkCancel">Cancel</button><button class="ib pri" id="mpkOk">Save</button></div>`,
    'xxl',
  );
  const rows = () => {
    const q = $('#mpkQ').value.trim().toLowerCase(),
      eq = $('#mpkEq').value,
      lim = $('#mpkLim').checked,
      live = $('#mpkLive').checked,
      own = $('#mpkOwn').checked;
    const words = q.split(/\s+/).filter(Boolean);
    const hit = all.filter(id => {
      const t = REG[id],
        own = mpOwner(id);
      if (eq && own !== eq) return false;
      if (own === '' && $('#mpkOwn').checked && !sel.includes(id)) return false;
      if (lim && t.hi == null && t.lo == null && t.hh == null && t.ll == null) return false;
      /*
       * Only the readings a database is answering for, by default.
       *
       * `val` is null for a reading with no record — see
       * `showNothingWithoutData` — so this is the difference between a
       * reading that would carry a number on the panel and one that would
       * sit there as a dash. The whole list is still a tick away; this only
       * decides what somebody is offered first, which on this plant is a few
       * dozen rather than every tag in the loop.
       *
       * One already chosen is never filtered out, or unticking the box would
       * be the only way to see what is on the panel.
       */
      if (live && !sel.includes(id) && val(id) == null) return false;
      const hay = `${id} ${t.desc || ''} ${t.short || ''} ${own} ${mpArea(id)}`.toLowerCase();
      return words.every(w => hay.includes(w));
    });
    const shown = hit.slice(0, 400);
    $('#mpkRows').innerHTML = shown
      .map(id => {
        const t = REG[id];
        return `<tr class="${sel.includes(id) ? 'on' : ''}" data-t="${esc(id)}"><td><input type="checkbox" ${sel.includes(id) ? 'checked' : ''} aria-label="Monitor ${esc(id)}"></td><td class="mono">${esc(id)}</td><td>${esc(t.desc || '')}</td><td><b>${esc(mpOwner(id))}</b></td><td class="note">${esc(mpArea(id))}</td><td class="num mono">${esc(tagTxt(id))}</td></tr>`;
      })
      .join('') || `<tr><td colspan="6" class="note" style="padding:14px">No tag matches.</td></tr>`;
    $('#mpkMore').textContent = hit.length > shown.length ? `Showing ${shown.length} of ${hit.length} matches — type more to narrow the list.` : `${hit.length} tag${hit.length === 1 ? '' : 's'}`;
    $$('#mpkRows tr[data-t]').forEach(tr => (tr.onclick = e => {
      const id = tr.dataset.t;
      sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
      rows();
      side();
    }));
  };
  const side = () => {
    $('#mpkN').textContent = `${sel.length}${sel.length > 30 ? ' — many for one screen' : ''}`;
    $('#mpkSel').innerHTML = sel.length
      ? sel
          .map((id, i) => `<div class="mpk-it" data-i="${i}"><span class="mpk-no">${i + 1}</span><div><b>${esc(mpOwner(id) || '—')}</b><span>${esc(REG[id].desc || id)}</span></div><button class="sb" data-up="${i}" title="Move up" ${i ? '' : 'disabled'}>↑</button><button class="sb" data-dn="${i}" title="Move down" ${i < sel.length - 1 ? '' : 'disabled'}>↓</button><button class="sb" data-rm="${i}" title="Remove">✕</button></div>`)
          .join('')
      : '<div class="note" style="padding:12px">Nothing selected — tick parameters on the left.</div>';
    const mv = (i, d) => {
      const j = i + d;
      [sel[i], sel[j]] = [sel[j], sel[i]];
      side();
    };
    $$('#mpkSel [data-up]').forEach(x => (x.onclick = () => mv(+x.dataset.up, -1)));
    $$('#mpkSel [data-dn]').forEach(x => (x.onclick = () => mv(+x.dataset.dn, 1)));
    $$('#mpkSel [data-rm]').forEach(x => (x.onclick = () => ((sel = sel.filter((_, k) => k !== +x.dataset.rm)), rows(), side())));
  };
  $('#mpkQ').oninput = rows;
  $('#mpkEq').onchange = rows;
  $('#mpkLim').onchange = rows;
  $('#mpkOwn').onchange = rows;
  $('#mpkLive').onchange = rows;
  $('#mpkClr').onclick = () => ((sel = []), rows(), side());
  $('#mpkSug').onclick = () => ((sel = mpSuggested()), rows(), side());
  $('#mpkCancel').onclick = closeModal;
  $('#mpkOk').onclick = async () => {
    const ok = $('#mpkOk');
    pushUndo();
    mpCfg().tags = sel.slice();
    save();
    /*
     * Straight to the database, the way the Publish view buttons are saved:
     * the choice is on the loop (DOC.mon) and the loop is written with it.
     * The studio's own save() is a no-op in this app. If the write fails the
     * dialog stays open so nothing is lost.
     */
    if (typeof window.dlPersistLoop === 'function') {
      ok.disabled = true;
      ok.textContent = 'Saving…';
      try {
        await window.dlPersistLoop();
      } catch (e) {
        ok.disabled = false;
        ok.textContent = 'Save';
        toast('Could not save the monitored parameters: ' + (e && e.message ? e.message : e));
        return;
      }
    }
    closeModal();
    mpRender(true);
    toast(`Fault alarm panel: ${sel.length} monitored parameter${sel.length === 1 ? '' : 's'}`);
  };
  rows();
  side();
}

/* ---------- wiring ---------- */
(() => {
  // Publish bar: show / hide the live panel
  const al = $('#pAlarm');
  if (al && !$('#pMon')) {
    al.insertAdjacentHTML('afterend', '<button class="p9" id="pMon" title="Show or hide the Fault alarm panel (alarms and monitored parameters)">🔔 Fault alarm</button>');
    $('#pMon').onclick = () => mpSet(!mpOn());
  }
  // Data ribbon: choose the monitored parameters from Design / Simulate too
  const dp = document.querySelector('.rpanel[data-rp="data"]');
  if (dp && !$('#dMon')) {
    dp.insertAdjacentHTML(
      'beforeend',
      `<div class="grp" role="group" aria-label="Publish"><div class="gi"><button class="ib rbig" id="dMon" title="Choose the parameters shown in the Publish view's Fault alarm panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M6 9h6M6 13h4M17.5 9h1M17.5 13h1"/></svg><span class="rl">Fault alarm</span></button></div><span class="gl">Publish</span></div>`,
    );
    $('#dMon').onclick = mpPicker;
  }
  // follow Publish on / off
  new MutationObserver(() => mpSync()).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  setInterval(() => PRESENT && mpOn() && mpRender(false), 1000);
})();
