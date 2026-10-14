/*! SandMan Digital Loop Studio — 15b-db-tags.js
 *  v4.2 — Equipment Property › Data connection: Database → Table → Tag + flow.
 *  1 Database (every database offered by a configured SQL / time-series data source)
 *  2 Table (loaded for that database only; loading and error states; changing the database resets it)
 *  3 Tag (value column of the table, row filter = key column, prefilled with the equipment name) → Tag +
 *  Each added tag becomes a normal reading linked to database.table.column (same link format as the Browse
 *  wizard), so every existing reading function keeps working. The selection is kept on the equipment
 *  (b.props.dbsel = {src, db, table}). */

const DBT = { cache: {}, delay: 350 };
/* v9.39 — sample values shown in this preview for text columns (the gateway replaces them with the database value) */
const DB_TXT = { pattern: 'PT-1042 Brake Disc', prev_pattern: 'PT-0988 Hub', state: 'RUNNING' };
/* "customer" always means the logged-in customer's default database (v4.9) */
const dbOf = sel => (sel && sel.src === 'customer' && typeof CUSTOMER !== 'undefined' ? CUSTOMER.defaultDb.db : sel && sel.db);
const dbKeyOf = sel => (sel && sel.src ? sel.src + '|' + dbOf(sel) : ''); // cache: "src|db" → {st: 'loading' | 'ok' | 'error', tables, msg}

/* databases: each SQL / time-series source offers its own database first; extra databases on the same server are
   listed only when no other source claims them (so the same database never appears twice) */
function dbList() {
  const S = sources().filter(s => ['sql', 'ts'].includes(SRC_TYPES[s.type]?.fam));
  // v4.9 — the customer's default database (from the Sandman login) always comes first
  const cust = typeof CUSTOMER !== 'undefined' ? [{ src: 'customer', db: CUSTOMER.defaultDb.db, srcName: 'Customer default', type: SRC_TYPES[CUSTOMER.defaultDb.type]?.n || CUSTOMER.defaultDb.type, icon: '★', cust: true }] : [];
  const claimed = new Set(S.map(s => s.db).filter(Boolean));
  const out = [];
  for (const s of S) {
    let dbs;
    try {
      dbs = catalog(s).map(d => d.name);
    } catch (e) {
      dbs = s.db ? [s.db] : [];
    }
    dbs.filter(d => d === s.db || !claimed.has(d)).forEach(d => out.push({ src: s.id, db: d, srcName: s.name, type: SRC_TYPES[s.type]?.n || s.type, icon: SRC_TYPES[s.type]?.icon || '🗄' }));
    if (!s.db) dbs.forEach(d => claimed.add(d));
  }
  // de-duplicate by src + db
  return cust.concat(out.filter((x, i) => out.findIndex(y => y.src === x.src && y.db === x.db) === i));
}
/* load the tables of one database (asynchronous like a real gateway call: loading, ok or error) */
function dbFetchTables(srcId, db) {
  const key = srcId + '|' + db;
  const c = (DBT.cache[key] = { st: 'loading', tables: [], msg: '' });
  return new Promise(res => {
    setTimeout(() => {
      const s = SRC(srcId);
      try {
        if (!s) throw new Error('This data source no longer exists.');
        if (!s.host) throw new Error(`${s.name} has no server address — set it in Data › Data sources.`);
        if (s.offline) throw new Error(`${s.name} did not answer (${s.host}).`);
        const d = catalog(s).find(x => x.name === db);
        if (!d) throw new Error(`Database “${db}” was not found on ${s.name}.`);
        c.st = 'ok';
        c.tables = d.tables;
      } catch (e) {
        c.st = 'error';
        c.msg = e.message || 'The tables could not be retrieved.';
      }
      res(c);
    }, DBT.delay);
  });
}
const DB_UNIT = [
  [/_pct$/, '%'],
  [/moisture/, '%'],
  [/compactability/, '%'],
  [/temp_c$|_temp_c$/, '°C'],
  [/_a$/, 'A'],
  [/_rpm$/, 'rpm'],
  [/_tph$/, 't/h'],
  [/_kw$/, 'kW'],
  [/_kg$/, 'kg'],
  [/_l$/, 'L'],
  [/_s$/, 's'],
  [/_min$/, 'min'],
  [/_bar$/, 'bar'],
  [/_mms$/, 'mm/s'],
  [/^molds_per_hour$/, 'mold/h'],
  [/^gcs$/, 'N/cm²'],
  [/^oee$/, '%'],
];
const DB_TYP = { moisture: 3.4, compactability: 40, temp_c: 38, current_a: 180, speed_rpm: 60, load_tph: 90, level_pct: 60, vibration_mms: 4, position_pct: 50, bentonite_kg: 18, coal_kg: 5, water_l: 30, batch_time_s: 90, molds_per_hour: 380, squeeze_bar: 9, hardness: 85, cycle_s: 9.5, power_kw: 650, c_pct: 3.6, si_pct: 2.2, mn_pct: 0.4, ce: 4.3, gcs: 17, permeability: 140, active_clay: 9, loi: 3.5, sand_temp_c: 45, casting_temp_c: 600, oee: 78 };
function dbNice(col) {
  if (/(^|_)temp_c$/.test(col)) {
    const pre = col.replace(/_?temp_c$/, '');
    return pre ? pre[0].toUpperCase() + pre.slice(1).replace(/_/g, ' ') + ' temperature' : 'Temperature';
  }
  const up = { c: 'C', si: 'Si', mn: 'Mn', ce: 'CE', gcs: 'GCS', loi: 'LOI', oee: 'OEE', pct: '%', kg: 'kg', kw: 'kW', rpm: 'rpm', tph: 't/h', mms: 'mm/s', bar: 'bar', s: 's', a: 'A', l: 'L', min: 'min' };
  const w = col.split('_').map((x, i) => up[x] || (i === 0 ? x[0].toUpperCase() + x.slice(1) : x));
  return w.join(' ').replace(/ (%|kg|kW|rpm|t\/h|mm\/s|bar|s|A|L|min)$/, ' ($1)').replace('Temp', 'Temperature');
}
/* the panel block (HTML) — inserted at the top of Data connection */
function dbBlockHTML(b, ed) {
  const sel = b.props.dbsel || (typeof CUSTOMER !== 'undefined' ? { src: 'customer', db: CUSTOMER.defaultDb.db, table: '', auto: 1 } : {}),
    L = dbList(),
    key = sel.src === 'customer' ? 'customer|' + CUSTOMER.defaultDb.db : sel.src && sel.db ? sel.src + '|' + sel.db : '',
    c = key ? DBT.cache[key] : null;
  if (key && !c) dbFetchTables(sel.src, key.split('|')[1]).then(() => typeof renderProps === 'function' && renderProps());
  const tbl = c && c.st === 'ok' ? c.tables.find(t => t.name === sel.table) : null;
  const dbOpts =
    `<option value="">${L.length ? 'Choose a database…' : 'No database sources — add one'}</option>` +
    L.map(d => `<option value="${esc(d.src + '|' + d.db)}" ${key === d.src + '|' + d.db ? 'selected' : ''}>${d.cust ? `★ Customer default · ${esc(d.db)}` : `${d.icon} ${esc(d.db)} · ${esc(d.srcName)}`} (${esc(d.type)})</option>`).join('') +
    '<option value="__manage">Add or manage data sources…</option>';
  let tblCtl;
  if (!key) tblCtl = `<select id="dbTbl" disabled><option>Choose a database first</option></select>`;
  else if (!c || c.st === 'loading') tblCtl = `<select id="dbTbl" disabled><option>Loading tables…</option></select><span class="db-spin" aria-label="Loading"></span>`;
  else if (c.st === 'error') tblCtl = `<select id="dbTbl" disabled><option>Tables could not be loaded</option></select>`;
  else
    tblCtl = `<select id="dbTbl" ${ed}><option value="">${c.tables.length ? 'Choose a table…' : 'This database has no tables'}</option>${c.tables
      .map(t => `<option value="${esc(t.name)}" ${sel.table === t.name ? 'selected' : ''}>${esc(t.name)}${t.tall ? ' (tag / value rows)' : ''}</option>`)
      .join('')}</select>`;
  let tagCtl = '';
  if (tbl) {
    const cols = tbl.cols.filter(x => !['datetime', 'tag'].includes(x.t) && x.n !== tbl.key); // v9.39: text (varchar) columns too
    const already = new Set(b.tags.map(bt => REG[bt.id]?.link).filter(Boolean).filter(l => l.db === sel.db && l.table === sel.table).map(l => (l.tall ? l.keyVal : l.col)));
    tagCtl = tbl.tall
      ? `<label class="ix-f">Tag name in <span class="mono">${esc(tbl.key)}</span><input id="dbCol" class="mono" placeholder="e.g. ${esc(b.name)}.MOIST" ${ed} spellcheck="false"></label>`
      : `<label class="ix-f">Tag<select id="dbCol" ${ed}><option value="">Choose a tag…</option>${cols
          .map(x => `<option value="${esc(x.n)}" ${already.has(x.n) ? 'disabled' : ''}>${esc(dbNice(x.n))} — ${esc(x.n)}${x.t === 'varchar' ? ' (text)' : ''}${already.has(x.n) ? ' (added)' : ''}</option>`)
          .join('')}</select></label>
         ${tbl.key ? `<label class="ix-f">Row filter <span class="mono">${esc(tbl.key)} =</span><input id="dbKey" class="mono" value="${esc(sel.keyVal || b.name)}" ${ed} spellcheck="false"></label>` : ''}`;
    tagCtl += `<div class="db-add"><button class="ib pri" id="dbAdd" ${ed} disabled>Tag ＋</button><span class="db-q mono" id="dbQ"></span></div>`;
  }
  return `<div class="db-flow" id="dbFlow">
 <div class="db-step"><i>1</i><label class="ix-f">Database<select id="dbDb" ${ed}>${dbOpts}</select></label></div>
 <div class="db-step ${key ? '' : 'off'}"><i>2</i><label class="ix-f">Table<span class="db-row">${tblCtl}</span></label></div>
 ${c && c.st === 'error' ? `<div class="db-err" role="alert">${esc(c.msg)} <button class="lnk" id="dbRetry">Retry</button></div>` : ''}
 <div class="db-step ${tbl ? '' : 'off'}"><i>3</i><div class="db-tag">${tbl ? tagCtl : '<span class="ix-hint">Choose a table to add its tags as readings.</span>'}</div></div>
</div>`;
}
/* add one tag (column) as a reading of the equipment, linked to database + table */
function dbAddTag(b, sel, col, keyVal) {
  if (sel.src === 'customer') sel = { ...sel, db: dbOf(sel) };
  const c = DBT.cache[sel.src + '|' + sel.db],
    tbl = c && c.tables.find(t => t.name === sel.table);
  if (!tbl || !col) return null;
  const s = SRC(sel.src);
  const tall = !!tbl.tall;
  const suffix = (tall ? col.split('.').pop() : col).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  let id = `${b.name}.${suffix}`;
  if (REG[id] && b.tags.some(x => x.id === id)) {
    const L = REG[id].link;
    if (L && L.db === sel.db && L.table === sel.table && (L.tall ? L.keyVal : L.col) === col) {
      toast('This tag is already a reading of this equipment');
      return null;
    }
  }
  let n = 2;
  while (REG[id]) id = `${b.name}.${suffix}_${n++}`;
  const name = tall ? col : col;
  const unit = tall ? '' : (DB_UNIT.find(([re]) => re.test(col)) || [, ''])[1];
  const typ = DB_TYP[tall ? '' : col] ?? 50;
  mkTag(id, { desc: tall ? col : dbNice(col), unit, typ, noise: Math.max(Math.abs(typ) * 0.01, 0.05), src: s ? s.name : 'Database', addr: `${sel.db}.${sel.table}.${tall ? 'value' : col}`, d: Math.abs(typ) >= 100 ? 0 : 1 });
  REG[id].link = { src: sel.src, db: sel.db, table: sel.table, col: tall ? 'value' : col, tall, keyCol: tbl.key || '', keyVal: tall ? name : keyVal || b.name, tcol: (tbl.cols.find(x => x.t === 'datetime') || {}).n || 'ts' };
  // v9.39 — a text (varchar) column becomes a Text tag: the gateway delivers text (setTagText), not a number
  const ct = !tall && (tbl.cols.find(x => x.n === col) || {}).t;
  if (ct === 'varchar') {
    Object.assign(REG[id], { txt: DB_TXT[col] || 'Text from the database', unit: '', d: 0, noise: 0, typ: 0, sd: null, ll: null, lo: null, hi: null, hh: null });
    REG[id].link.text = true;
  }
  b.tags.push({ id, show: true, own: true });
  return id;
}
/* wire the block (called after the panel is rendered) */
function dbWire(root, b) {
  const dbs = root.querySelector('#dbDb');
  if (!dbs) return;
  const persist = () => {
    try {
      save(); // the selection is part of the saved flowsheet
    } catch (e) {}
  };
  dbs.onchange = () => {
    if (dbs.value === '__manage') {
      dbs.value = b.props.dbsel && b.props.dbsel.src ? b.props.dbsel.src + '|' + b.props.dbsel.db : '';
      sourcesForm();
      return;
    }
    if (!dbs.value) {
      delete b.props.dbsel;
      persist();
      renderProps();
      return;
    }
    const [src, db] = dbs.value.split('|');
    b.props.dbsel = { src, db, table: '' }; // a new database resets the table
    delete DBT.cache[src + '|' + db];
    persist();
    renderProps();
  };
  const t = root.querySelector('#dbTbl');
  if (t && !t.disabled)
    t.onchange = () => {
      const base = b.props.dbsel || { src: 'customer', db: dbOf({ src: 'customer' }) }; // the automatic customer default becomes explicit
      b.props.dbsel = { ...base, table: t.value };
      delete b.props.dbsel.auto;
      persist();
      renderProps();
    };
  const rt = root.querySelector('#dbRetry');
  if (rt)
    rt.onclick = () => {
      const s = b.props.dbsel || { src: 'customer' };
      delete DBT.cache[dbKeyOf(s)];
      renderProps();
    };
  const col = root.querySelector('#dbCol'),
    add = root.querySelector('#dbAdd'),
    key = root.querySelector('#dbKey'),
    q = root.querySelector('#dbQ');
  if (col && add) {
    const upd = () => {
      const s = b.props.dbsel,
        v = col.value.trim();
      add.disabled = !v || MODE !== 'design';
      const c = DBT.cache[dbKeyOf(s)],
        tbl = c && c.tables.find(x => x.name === s.table);
      if (q) q.textContent = v && tbl ? `${dbOf(s)}.${s.table}.${tbl.tall ? 'value' : v}${tbl.key ? ` · ${tbl.key} = ${tbl.tall ? v : key ? key.value : b.name}` : ''}` : '';
    };
    col.oninput = col.onchange = upd;
    if (key) key.oninput = () => ((b.props.dbsel = b.props.dbsel || { src: 'customer', db: dbOf({ src: 'customer' }), table: '' }), (b.props.dbsel.keyVal = key.value.trim()), upd());
    upd();
    add.onclick = () => {
      const v = col.value.trim();
      if (!v) return;
      pushUndo();
      const id = dbAddTag(b, b.props.dbsel, v, key ? key.value.trim() : b.name);
      if (!id) return;
      IXOPEN = null;
      logEv(`${b.name}: tag ${id} added from ${dbOf(b.props.dbsel)}.${b.props.dbsel.table}`);
      changed();
      toast(`Tag added under Readings: ${REG[id].desc} (${dbOf(b.props.dbsel)}.${b.props.dbsel.table})`);
    };
  }
}
