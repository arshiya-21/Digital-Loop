/*! SandMan Process Flowsheet — 08-data-links.js
 *  Data sources manager and 4-step real-time data link wizard
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===================================================================
   Real-time data linking: data sources + 4-step link wizard
   =================================================================== */
const SRC_TYPES = {
  mssql: { n: 'SQL Server', fam: 'sql', port: 1433, icon: '🗄' },
  postgres: { n: 'PostgreSQL', fam: 'sql', port: 5432, icon: '🗄' },
  mysql: { n: 'MySQL / MariaDB', fam: 'sql', port: 3306, icon: '🗄' },
  oracle: { n: 'Oracle', fam: 'sql', port: 1521, icon: '🗄' },
  influx: { n: 'InfluxDB / time-series', fam: 'ts', port: 8086, icon: '📈' },
  historian: { n: 'SandMan Historian', fam: 'ts', port: 443, icon: '📈' },
  opcua: { n: 'OPC UA', fam: 'node', port: 4840, icon: '🔌' },
  mqtt: { n: 'MQTT broker', fam: 'topic', port: 1883, icon: '📡' },
  modbus: { n: 'Modbus TCP', fam: 'reg', port: 502, icon: '🔧' },
  rest: { n: 'REST / JSON API', fam: 'api', port: 443, icon: '🌐' },
};
const DEF_SOURCES = [
  {
    id: 'src_gw',
    name: 'SandMan Gateway (PLC)',
    type: 'opcua',
    host: 'opc.tcp://sandman-gw.local',
    port: 4840,
    db: '',
    user: '',
    poll: 1,
    timeout: 5,
    cred: 'gateway-vault:plc',
  },
  {
    id: 'src_db',
    name: 'SandMan Production DB',
    type: 'mssql',
    host: 'sql-prod.plant.local',
    port: 1433,
    db: 'SandMan_Prod',
    user: 'sandman_ro',
    poll: 5,
    timeout: 10,
    cred: 'gateway-vault:sqlprod',
  },
  {
    id: 'src_lims',
    name: 'Sand Lab LIMS',
    type: 'postgres',
    host: 'lims.plant.local',
    port: 5432,
    db: 'Plant_LIMS',
    user: 'lims_reader',
    poll: 60,
    timeout: 10,
    cred: 'gateway-vault:lims',
  },
];
function sources() {
  if (!DOC.sources) DOC.sources = JSON.parse(JSON.stringify(DEF_SOURCES));
  return DOC.sources;
}
const SRC = id => (id === 'customer' && typeof customerSource === 'function' ? customerSource() : sources().find(s => s.id === id)); // v4.9: customer default database
const C_ = (n, t = 'float') => ({ n, t });
const SQL_SCHEMA = {
  SandMan_Prod: [
    {
      name: 'equipment_status',
      key: 'equipment_id',
      cols: [
        C_('ts', 'datetime'),
        C_('equipment_id', 'varchar'),
        C_('state', 'varchar'),
        C_('current_a'),
        C_('speed_rpm'),
        C_('load_tph'),
        C_('level_pct'),
        C_('temp_c'),
        C_('vibration_mms'),
        C_('position_pct'),
        C_('flow'),
        C_('rate'),
        C_('count', 'int'),
      ],
    },
    {
      name: 'mixer_batches',
      key: 'mixer_id',
      cols: [
        C_('ts', 'datetime'),
        C_('mixer_id', 'varchar'),
        C_('batch_no', 'int'),
        C_('bentonite_kg'),
        C_('coal_kg'),
        C_('water_l'),
        C_('moisture'),
        C_('compactability'),
        C_('temp_c'),
        C_('current_a'),
        C_('speed_rpm'),
        C_('batch_time_s'),
      ],
    },
    {
      name: 'molding_cycles',
      key: 'machine_id',
      cols: [
        C_('ts', 'datetime'),
        C_('machine_id', 'varchar'),
        C_('molds_per_hour'),
        C_('squeeze_bar'),
        C_('hardness'),
        C_('cycle_s'),
        C_('pattern', 'varchar'), // v9.39 — running pattern (text)
        C_('prev_pattern', 'varchar'), // v9.39 — previous running pattern (text)
      ],
    },
    {
      name: 'melt_log',
      key: 'furnace_id',
      cols: [
        C_('ts', 'datetime'),
        C_('furnace_id', 'varchar'),
        C_('temp_c'),
        C_('power_kw'),
        C_('c_pct'),
        C_('si_pct'),
        C_('ce'),
        C_('pour_time_s'),
        C_('pattern', 'varchar'), // v9.39 — pattern being poured (text)
        C_('prev_pattern', 'varchar'), // v9.39 — previous poured pattern (text)
      ],
    },
    {
      name: 'shakeout_log',
      key: 'unit_id',
      cols: [
        C_('ts', 'datetime'),
        C_('unit_id', 'varchar'),
        C_('sand_temp_c'),
        C_('casting_temp_c'),
        C_('vibration_mms'),
        C_('cooling_time_min'),
      ],
    },
    {
      name: 'process_values',
      key: 'tag_name',
      tall: 1,
      cols: [C_('ts', 'datetime'), C_('tag_name', 'varchar'), C_('value'), C_('quality', 'int')],
    },
  ],
  Plant_LIMS: [
    {
      name: 'sand_lab_results',
      key: 'sample_point',
      cols: [
        C_('ts', 'datetime'),
        C_('sample_point', 'varchar'),
        C_('moisture'),
        C_('compactability'),
        C_('gcs'),
        C_('permeability'),
        C_('active_clay'),
        C_('loi'),
        C_('temp_c'),
      ],
    },
    {
      name: 'chemistry_results',
      key: 'heat_no',
      cols: [
        C_('ts', 'datetime'),
        C_('heat_no', 'varchar'),
        C_('c_pct'),
        C_('si_pct'),
        C_('mn_pct'),
        C_('ce'),
      ],
    },
  ],
  MES: [
    {
      name: 'production_orders',
      key: 'line_id',
      cols: [
        C_('ts', 'datetime'),
        C_('line_id', 'varchar'),
        C_('order_no', 'varchar'),
        C_('good_qty', 'int'),
        C_('scrap_qty', 'int'),
        C_('oee'),
      ],
    },
    {
      name: 'downtime_events',
      key: 'equipment_id',
      cols: [
        C_('ts', 'datetime'),
        C_('equipment_id', 'varchar'),
        C_('reason', 'varchar'),
        C_('duration_min'),
      ],
    },
  ],
};
const KEYMAP = {
  MOIST: ['moisture'],
  COMP: ['compactability'],
  TEMP: ['temp_c'],
  TOUT: ['temp_c'],
  TIN: ['temp_c'],
  MTEMP: ['temp_c'],
  CUR: ['current_a'],
  AMP: ['current_a'],
  LVL: ['level_pct'],
  LOAD: ['load_tph'],
  SPD: ['speed_rpm'],
  RPM: ['speed_rpm'],
  GCS: ['gcs'],
  PERM: ['permeability'],
  AC: ['active_clay'],
  LOI: ['loi'],
  BENT: ['bentonite_kg'],
  COAL: ['coal_kg'],
  BT: ['batch_time_s'],
  MPH: ['molds_per_hour'],
  SQZ: ['squeeze_bar'],
  HRD: ['hardness'],
  CYC: ['cycle_s'],
  PWR: ['power_kw'],
  C: ['c_pct'],
  SI: ['si_pct'],
  CE: ['ce'],
  FLOW: ['flow', 'water_l'],
  PV: ['value'],
  VIB: ['vibration_mms'],
  POS: ['position_pct'],
  RATE: ['rate'],
  PT: ['pour_time_s'],
  STMP: ['sand_temp_c'],
  CTMP: ['casting_temp_c'],
  CT: ['cooling_time_min'],
  CNT: ['count'],
  OEE: ['oee'],
};
const AREA_OF = b => CATS[EQ[b.type].cat] || 'Plant';
/* Browse a source: returns containers → tables → columns (simulated catalogue) */
function catalog(src) {
  const T = SRC_TYPES[src.type]?.fam;
  if (src.customer) {
    const sch = (CUSTOMER.defaultDb.schema && CUSTOMER.defaultDb.schema.length ? CUSTOMER.defaultDb.schema : SQL_SCHEMA.SandMan_Prod) || [];
    return [{ name: src.db, label: 'Database', tables: sch.map(t => ({ ...t, label: 'Table' })) }];
  }
  if (T === 'sql') {
    const dbs =
      src.db && SQL_SCHEMA[src.db]
        ? [src.db, ...Object.keys(SQL_SCHEMA).filter(d => d !== src.db)]
        : Object.keys(SQL_SCHEMA);
    return dbs.map(d => ({
      name: d,
      label: 'Database',
      tables: SQL_SCHEMA[d].map(t => ({ ...t, label: 'Table' })),
    }));
  }
  const eq = DOC.blocks.filter(b => !EQ[b.type].widget && b.tags.length),
    byArea = {};
  eq.forEach(b => {
    (byArea[AREA_OF(b)] = byArea[AREA_OF(b)] || []).push(b);
  });
  if (T === 'node')
    return [
      {
        name: 'Objects/Line1',
        label: 'Namespace',
        tables: Object.entries(byArea).map(([a, bs]) => ({
          name: a,
          label: 'Folder',
          node: 1,
          cols: bs
            .flatMap(b => EQ[b.type].tags.map(t => C_(`${b.name}.${t[0]}`)))
            .concat(bs.flatMap(b => b.tags.map(t => C_(t.id))))
            .filter((c, i, arr) => arr.findIndex(x => x.n === c.n) === i),
        })),
      },
    ];
  if (T === 'topic')
    return [
      {
        name: 'plant/line1',
        label: 'Topic root',
        tables: eq.map(b => ({
          name: b.name.toLowerCase(),
          label: 'Topic',
          node: 1,
          cols: EQ[b.type].tags.map(t => C_(t[0].toLowerCase())).concat([C_('ts', 'datetime')]),
        })),
      },
    ];
  if (T === 'reg') {
    let r = 40001;
    return [
      {
        name: 'Unit 1',
        label: 'Slave / unit',
        tables: [
          {
            name: 'Holding registers',
            label: 'Register map',
            node: 1,
            cols: eq.flatMap(b =>
              EQ[b.type].tags.map(t => {
                const c = C_(`${r} · ${b.name}.${t[0]}`, 'float32');
                r += 2;
                return c;
              }),
            ),
          },
        ],
      },
    ];
  }
  if (T === 'ts')
    return [
      {
        name: 'plant',
        label: 'Bucket',
        tables: Object.entries(byArea).map(([a, bs]) => ({
          name: a.toLowerCase().replace(/[^a-z]+/g, '_'),
          label: 'Measurement',
          key: 'equipment',
          cols: [
            C_('_time', 'datetime'),
            C_('equipment', 'tag'),
            ...[
              ...new Set(
                bs.flatMap(b => EQ[b.type].tags.map(t => (KEYMAP[t[0]] || [t[0].toLowerCase()])[0])),
              ),
            ].map(n => C_(n)),
          ],
        })),
      },
    ];
  return [
    {
      name: '/api/v1',
      label: 'Base path',
      tables: [
        { name: '/tags/latest', label: 'Endpoint', node: 1, cols: Object.keys(REG).map(id => C_(id)) },
      ],
    },
  ];
}
function autoCol(tbl, tagId, b) {
  const suf = tagId.split('.').pop(),
    cols = tbl.cols.map(c => c.n);
  if (tbl.tall) return 'value';
  if (tbl.node) {
    const cand = [tagId, `${b?.name}.${suf}`, suf.toLowerCase()];
    const hit = cols.find(c => cand.includes(c) || cand.some(x => c.endsWith(' · ' + x)));
    return hit || '';
  }
  for (const k of KEYMAP[suf] || [suf.toLowerCase()]) if (cols.includes(k)) return k;
  return '';
}
function linkText(t) {
  let L = t.link;
  if (!L) return '';
  const s = SRC(L.src);
  if (!s) return 'Source removed';
  if (s.customer) L = { ...L, db: s.db }; // v4.9: resolved for the logged-in customer
  const T = SRC_TYPES[s.type].fam;
  if (T === 'sql')
    return L.tall
      ? `${L.db}.${L.table} · ${L.keyCol}='${L.keyVal}' → value`
      : `${L.db}.${L.table}.${L.col}${L.keyCol ? ` · ${L.keyCol}='${L.keyVal}'` : ''}`;
  if (T === 'ts') return `${L.db}/${L.table}.${L.col} · ${L.keyCol}=${L.keyVal}`;
  if (T === 'topic') return `${L.db}/${L.table}/${L.col}`;
  return `${L.table} · ${L.col}`;
}
function linkQuery(t) {
  const L = t.link,
    s = L && SRC(L.src);
  if (!s) return '';
  const ty = s.type,
    col = L.tall ? 'value' : L.col,
    w = L.keyCol ? ` WHERE ${L.keyCol} = '${L.tall ? t.id : L.keyVal}'` : '';
  if (ty === 'mssql')
    return `SELECT TOP 1 ${L.tcol || 'ts'}, ${col} FROM [${L.db}].[dbo].[${L.table}]${w} ORDER BY ${L.tcol || 'ts'} DESC`;
  if (ty === 'oracle')
    return `SELECT ${L.tcol || 'ts'}, ${col} FROM ${L.table}${w} ORDER BY ${L.tcol || 'ts'} DESC FETCH FIRST 1 ROWS ONLY`;
  if (SRC_TYPES[ty].fam === 'sql')
    return `SELECT ${L.tcol || 'ts'}, ${col} FROM ${L.table}${w} ORDER BY ${L.tcol || 'ts'} DESC LIMIT 1`;
  if (SRC_TYPES[ty].fam === 'ts')
    return `from(bucket:"${L.db}") |> range(start:-1m) |> filter(fn:(r)=> r._measurement=="${L.table}" and r.${L.keyCol}=="${L.keyVal}" and r._field=="${L.col}") |> last()`;
  if (ty === 'opcua') return `Subscribe NodeId ns=2;s=${L.col} (sampling ${s.poll}s)`;
  if (ty === 'mqtt') return `Subscribe ${L.db}/${L.table} → JSON field "${L.col}"`;
  if (ty === 'modbus')
    return `Read holding register ${L.col.split(' ')[0]} (float32, 2 words) every ${s.poll}s`;
  return `GET ${s.host}${L.db}${L.table}?tag=${encodeURIComponent(L.col)}`;
}

/* ---------- Data sources manager ---------- */
function sourcesForm(back) {
  const S = sources(),
    cnt = id => Object.values(REG).filter(t => t.link && t.link.src === id).length;
  openModal(
    `<div style="display:flex;align-items:center;gap:10px"><h3 style="margin:0">Data sources</h3><span class="note">Databases, PLCs and brokers SandMan reads live values from.</span></div>
 <div class="src-g"><div class="src cust-src"><div class="src-h"><span class="src-i">🏢</span><div style="min-width:0"><b>Customer default database</b><div class="note mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(SRC_TYPES[CUSTOMER.defaultDb.type]?.n || CUSTOMER.defaultDb.type)} · ${esc(CUSTOMER.defaultDb.host)} · ${esc(CUSTOMER.defaultDb.db)}</div></div></div>
  <div class="note">${esc(CUSTOMER.name)} · from your Sandman login · ${cnt('customer')} tag(s) linked</div><div class="src-a"><button class="sb" data-st="customer">Test connection</button><span class="lockn" title="Chosen by your Sandman login — cannot be edited or deleted here">🔒 Managed by Sandman</span></div><div id="tst_customer" class="note"></div></div>${S.map(
   s => `<div class="src"><div class="src-h"><span class="src-i">${SRC_TYPES[s.type]?.icon || '•'}</span><div style="min-width:0"><b>${esc(s.name)}</b><div class="note mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(SRC_TYPES[s.type]?.n)} · ${esc(s.host)}${s.db ? ' · ' + esc(s.db) : ''}</div></div></div>
  <div class="note">${cnt(s.id)} tag(s) linked · poll every ${s.poll}s</div><div class="src-a"><button class="sb" data-se="${s.id}">Edit</button><button class="sb" data-st="${s.id}">Test connection</button><button class="lb" data-sd="${s.id}" style="color:var(--crit);margin-left:auto">Delete</button></div><div class="note" id="tst_${s.id}"></div></div>`,
 ).join('')}
  <button class="src src-add" id="srcAdd">＋ Add data source</button></div>
 <div class="note" style="margin-top:10px">Passwords are never stored in the flowsheet — enter a credential reference that the SandMan Gateway service resolves on the server. This preview cannot reach plant networks, so tests and browsing use a sample catalogue and values stay simulated.</div>
 <div class="mact">${back ? '<button class="ib" id="srcBack">Back to linking</button>' : ''}<button class="ib pri" id="srcClose">Done</button></div>`,
    'xl',
  );
  $('#srcClose').onclick = () => {
    closeModal();
    renderHeader();
  };
  if (back) $('#srcBack').onclick = back;
  $('#srcAdd').onclick = () => sourceEdit(null, back);
  $$('#mbox [data-se]').forEach(b => (b.onclick = () => sourceEdit(b.dataset.se, back)));
  $$('#mbox [data-st]').forEach(
    b => (b.onclick = () => testSource(SRC(b.dataset.st), $('#tst_' + b.dataset.st))),
  );
  $$('#mbox [data-sd]').forEach(
    b =>
      (b.onclick = () => {
        const s = SRC(b.dataset.sd),
          n = cnt(s.id);
        pushUndo();
        DOC.sources = S.filter(x => x !== s);
        Object.values(REG).forEach(t => {
          if (t.link && t.link.src === s.id) {
            delete t.link;
            t.src = 'Simulated';
          }
        });
        save();
        toast(`Removed ${s.name}${n ? ` · ${n} tag(s) unlinked` : ''}`);
        sourcesForm(back);
      }),
  );
}
function testSource(s, el) {
  if (!s || !el) return;
  el.innerHTML = '<span class="tx1">Testing…</span>';
  setTimeout(
    () => {
      const c = catalog(s),
        n = c.reduce((a, x) => a + x.tables.length, 0),
        fam = SRC_TYPES[s.type].fam;
      if (!s.host) {
        el.innerHTML = '<span class="tx3">✕ Enter a host / endpoint first</span>';
        return;
      }
      el.innerHTML = `<span class="tx0">✓ Reachable (simulated) · ${Math.round(8 + Math.random() * 30)} ms · ${n} ${fam === 'sql' ? 'tables' : fam === 'node' ? 'folders' : fam === 'topic' ? 'topics' : 'groups'} found</span>`;
    },
    500 + Math.random() * 400,
  );
}
function sourceEdit(id, back) {
  const s = id
    ? JSON.parse(JSON.stringify(SRC(id)))
    : {
        id: 'src_' + Date.now().toString(36),
        name: 'New data source',
        type: 'mssql',
        host: '',
        port: 1433,
        db: 'SandMan_Prod',
        user: '',
        poll: 5,
        timeout: 10,
        cred: '',
      };
  const draw = () => {
    const fam = SRC_TYPES[s.type].fam;
    openModal(`<h3>${id ? 'Edit' : 'Add'} data source</h3>
 <div class="row2" style="margin-top:10px"><div class="fld"><label>Name</label><input id="sN" value="${esc(s.name)}"></div><div class="fld"><label>Type</label><select id="sT">${Object.entries(
   SRC_TYPES,
 )
   .map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v.n}</option>`)
   .join('')}</select></div></div>
 <div class="row2"><div class="fld"><label>${fam === 'node' ? 'Endpoint URL' : fam === 'api' ? 'Base URL' : 'Host / server'}</label><input id="sH" class="mono" value="${esc(s.host)}" placeholder="${fam === 'node' ? 'opc.tcp://192.168.1.10' : fam === 'api' ? 'https://mes.plant.local' : 'sql-prod.plant.local'}"></div><div class="fld"><label>Port</label><input id="sP" type="number" value="${s.port}"></div></div>
 ${
   fam === 'sql'
     ? `<div class="row2"><div class="fld"><label>Default database</label><input id="sD" class="mono" value="${esc(s.db)}" list="dbl"><datalist id="dbl">${Object.keys(
         SQL_SCHEMA,
       )
         .map(d => `<option value="${d}">`)
         .join(
           '',
         )}</datalist></div><div class="fld"><label>User (read-only account)</label><input id="sU" value="${esc(s.user)}"></div></div>`
     : ''
 }
 ${fam === 'ts' ? `<div class="fld"><label>Organisation / bucket</label><input id="sD" class="mono" value="${esc(s.db || 'plant')}"></div>` : ''}
 <div class="row3"><div class="fld"><label>Poll / sample (s)</label><input id="sPo" type="number" min="1" value="${s.poll}"></div><div class="fld"><label>Timeout (s)</label><input id="sTo" type="number" min="1" value="${s.timeout}"></div><div class="fld"><label>Credential reference</label><input id="sC" class="mono" value="${esc(s.cred)}" placeholder="gateway-vault:name"></div></div>
 <div class="note" id="sTest"></div>
 <div class="mact"><button class="ib" id="sB">Back</button><button class="ib" id="sX">Test connection</button><button class="ib pri" id="sS">Save source</button></div>`);
    const read = () => {
      s.name = $('#sN').value.trim() || s.name;
      s.host = $('#sH').value.trim();
      s.port = +$('#sP').value || s.port;
      if ($('#sD')) s.db = $('#sD').value.trim();
      if ($('#sU')) s.user = $('#sU').value.trim();
      s.poll = Math.max(1, +$('#sPo').value || 1);
      s.timeout = Math.max(1, +$('#sTo').value || 5);
      s.cred = $('#sC').value.trim();
    };
    $('#sT').onchange = e => {
      read();
      s.type = e.target.value;
      s.port = SRC_TYPES[s.type].port;
      draw();
    };
    $('#sB').onclick = () => sourcesForm(back);
    $('#sX').onclick = () => {
      read();
      testSource(s, $('#sTest'));
    };
    $('#sS').onclick = () => {
      read();
      if (!s.host) {
        toast('Enter the host or endpoint');
        return;
      }
      pushUndo();
      const L = sources(),
        i = L.findIndex(x => x.id === s.id);
      if (i >= 0) L[i] = s;
      else L.push(s);
      save();
      toast(`Saved ${s.name}`);
      sourcesForm(back);
    };
  };
  draw();
}

/* ---------- Link wizard ---------- */
let LW = null;
function linkWizard(blockId, tagIds) {
  const b = B(blockId);
  const ids = tagIds || (b ? b.tags.map(t => t.id) : []);
  if (!ids.length) {
    toast('This item has no tags to link');
    return;
  }
  const first = REG[ids[0]]?.link;
  const s0 = first ? SRC(first.src) : null;
  LW = {
    b: blockId,
    ids,
    step: s0 ? 3 : 1,
    src: s0 ? s0.id : sources()[0]?.id || null,
    db: first?.db || null,
    table: first?.table || null,
    keyCol: first?.keyCol || '',
    keyVal: first?.keyVal || (b ? b.name : ''),
    tcol: first?.tcol || 'ts',
    map: Object.fromEntries(
      ids.map(id => [
        id,
        {
          col: REG[id]?.link?.col || '',
          scale: REG[id]?.link?.scale ?? 1,
          offset: REG[id]?.link?.offset ?? 0,
        },
      ]),
    ),
  };
  lwRender();
}
function lwTable() {
  const s = SRC(LW.src);
  if (!s) return null;
  const c = catalog(s).find(x => x.name === LW.db);
  return c ? c.tables.find(t => t.name === LW.table) : null;
}
function lwRender() {
  const st = LW.step,
    b = B(LW.b),
    s = SRC(LW.src),
    stepN = ['Data source', 'Location', 'Variables', 'Review'];
  const head = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Link real-time data${b ? ` — ${esc(b.name)}` : ''}</h3><span class="note">${b ? esc(EQ[b.type].n) + ' · ' : ''}${LW.ids.length} tag(s)</span></div>
 <div class="lw-steps">${stepN.map((n, i) => `<button class="lw-st ${i + 1 === st ? 'on' : ''} ${i + 1 < st ? 'done' : ''}" data-go="${i + 1}" ${i + 1 > st && !(i + 1 === 2 && LW.src) && !(i + 1 === 3 && LW.table) && !(i + 1 === 4 && LW.table) ? 'disabled' : ''}><b>${i + 1 < st ? '✓' : i + 1}</b>${n}</button>`).join('')}</div>`;
  let body = '',
    foot = '';
  if (st === 1) {
    body = `<div class="note" style="margin-bottom:8px">Where does this equipment's data live?</div><div class="src-g">${sources()
      .map(
        x =>
          `<label class="src pick ${LW.src === x.id ? 'on' : ''}"><input type="radio" name="lwS" value="${x.id}" ${LW.src === x.id ? 'checked' : ''}><div class="src-h"><span class="src-i">${SRC_TYPES[x.type].icon}</span><div style="min-width:0"><b>${esc(x.name)}</b><div class="note mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(SRC_TYPES[x.type].n)} · ${esc(x.host)}</div></div></div></label>`,
      )
      .join('')}<button class="src src-add" id="lwNew">＋ Add or manage data sources</button></div>`;
    foot = `<button class="ib" id="lwSkip">Keep simulated for now</button><button class="ib pri" id="lwNext" ${LW.src ? '' : 'disabled'}>Next: location</button>`;
  } else if (st === 2) {
    const cat = catalog(s);
    if (!LW.db || !cat.some(c => c.name === LW.db)) LW.db = cat[0]?.name;
    const C = cat.find(c => c.name === LW.db);
    const fam = SRC_TYPES[s.type].fam;
    if (!LW.table || !C.tables.some(t => t.name === LW.table)) {
      LW.table = null;
      let best = null,
        bs = -1;
      C.tables.forEach(t => {
        const n = LW.ids.filter(id => autoCol(t, id, b)).length - (t.tall ? 0.5 : 0);
        if (n > bs) {
          bs = n;
          best = t;
        }
      });
      LW.table = best?.name || C.tables[0]?.name;
    }
    const q = (LW.q || '').toLowerCase();
    body = `<div class="lw-2"><div><div class="fld"><label>${esc(cat[0]?.label || 'Container')}</label><select id="lwDb">${cat.map(c => `<option ${c.name === LW.db ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
   <div class="fld"><label>${esc(C.tables[0]?.label || 'Table')} <span class="note">(ranked by how many tags match)</span></label><input type="search" id="lwQ" placeholder="Filter" value="${esc(LW.q || '')}"><div class="lw-list">${C.tables
     .filter(t => !q || t.name.toLowerCase().includes(q))
     .map(t => {
       const m = LW.ids.filter(id => autoCol(t, id, b)).length;
       return `<button class="${t.name === LW.table ? 'on' : ''}" data-tb="${esc(t.name)}"><b class="mono">${esc(t.name)}</b>${t.tall ? '<span class="chip" style="background:#7b5ab8">tall</span>' : ''}<span class="note" style="margin-left:auto">${m}/${LW.ids.length} match</span></button>`;
     })
     .join('')}</div></div></div>
   <div><div class="fld"><label>Columns / variables in <span class="mono">${esc(LW.table)}</span></label><div class="lw-cols">${(lwTable()?.cols || []).map(c => `<span class="mono">${esc(c.n)} <i>${c.t}</i></span>`).join('')}</div></div>
   ${fam === 'sql' || fam === 'ts' ? `<div class="note">${lwTable()?.tall ? 'Tall table: one row per tag. Each tag is filtered by its own name.' : `Rows for many machines share this table — pick the column that identifies <b>${esc(b?.name || 'this equipment')}</b> on the next step.`}</div>` : ''}</div></div>`;
    foot = `<button class="ib" id="lwBack">Back</button><button class="ib pri" id="lwNext">Next: variables</button>`;
  } else if (st === 3) {
    const t = lwTable(),
      fam = SRC_TYPES[s.type].fam,
      cols = (t?.cols || []).filter(c => c.t !== 'datetime' && c.t !== 'varchar' && c.t !== 'tag');
    if (t && !t.node && !LW.keyCol) LW.keyCol = t.key || '';
    body = `${
      t && !t.node
        ? `<div class="row3"><div class="fld"><label>Timestamp column</label><select id="lwT">${t.cols
            .filter(c => c.t === 'datetime')
            .map(c => `<option ${c.n === LW.tcol ? 'selected' : ''}>${c.n}</option>`)
            .join('')}</select></div>
   <div class="fld"><label>Row filter column</label><select id="lwK"><option value="">No filter</option>${t.cols
     .filter(c => c.t === 'varchar' || c.t === 'tag')
     .map(c => `<option ${c.n === LW.keyCol ? 'selected' : ''}>${c.n}</option>`)
     .join('')}</select></div>
   <div class="fld"><label>${t.tall ? 'Filter value' : 'equals'}</label>${t.tall ? '<input disabled value="each tag’s own name">' : `<input id="lwV" class="mono" value="${esc(LW.keyVal)}">`}</div></div>`
        : ''
    }
   <div style="display:flex;align-items:center;gap:8px;margin:6px 0"><b style="font-size:12px">Map tags to ${t?.node ? 'variables' : 'columns'}</b><button class="sb" id="lwAuto">Auto-map by name</button><button class="sb" id="lwClr">Clear</button><span class="note" style="margin-left:auto" id="lwCount"></span></div>
   <div class="tbl-wrap"><table class="dz-t"><thead><tr><th>Tag</th><th>Description</th><th>Unit</th><th>${t?.node ? 'Variable / node' : 'Column'}</th><th>× Scale</th><th>+ Offset</th><th>Preview</th></tr></thead><tbody>${LW.ids
     .map(id => {
       const tg = REG[id],
         m = LW.map[id];
       return `<tr><td class="mono"><b>${esc(id)}</b></td><td>${esc(tg?.desc)}</td><td>${esc(tg?.unit)}</td>
    <td>${t?.tall ? `<span class="mono note">value WHERE ${esc(LW.keyCol || 'tag_name')}='${esc(id)}'</span>` : `<select data-mc="${esc(id)}"><option value="">— not linked (simulated) —</option>${(t?.node ? t.cols : cols).map(c => `<option ${c.n === m.col ? 'selected' : ''}>${esc(c.n)}</option>`).join('')}</select>`}</td>
    <td><input type="number" step="any" data-ms="${esc(id)}" value="${m.scale}" style="width:64px"></td><td><input type="number" step="any" data-mo="${esc(id)}" value="${m.offset}" style="width:64px"></td><td class="mono" data-mp="${esc(id)}"></td></tr>`;
     })
     .join('')}</tbody></table></div>
   <div class="cc-title" style="margin-top:12px">Sample rows <span class="note" style="font-weight:400">(simulated preview of what SandMan will read)</span></div><div class="tbl-wrap" id="lwPrev"></div>`;
    foot = `<button class="ib" id="lwBack">Back</button><button class="ib pri" id="lwNext">Next: review</button>`;
  } else {
    const t = lwTable(),
      rows = LW.ids.map(id => ({ id, m: LW.map[id] })).filter(r => t?.tall || r.m.col);
    body = `<div class="note" style="margin-bottom:8px">${rows.length} of ${LW.ids.length} tag(s) will read live data from <b>${esc(s.name)}</b> every ${s.poll} s. Unmapped tags stay simulated.</div>
   <div class="tbl-wrap"><table class="dz-t"><thead><tr><th>Tag</th><th>Reads</th><th>Query / subscription the gateway will run</th></tr></thead><tbody>${
     rows
       .map(r => {
         const fake = { id: r.id, link: lwLinkFor(r.id) };
         return `<tr><td class="mono"><b>${esc(r.id)}</b></td><td class="mono">${esc(linkText(fake))}</td><td class="mono lw-q">${esc(linkQuery(fake))}${r.m.scale != 1 || r.m.offset != 0 ? ` → ×${r.m.scale} +${r.m.offset}` : ''}</td></tr>`;
       })
       .join('') ||
     '<tr><td colspan="3" class="note">Nothing mapped — go back to map at least one tag.</td></tr>'
   }</tbody></table></div>
   <div class="row2" style="margin-top:10px"><div class="fld"><label>Mark value as stale after (s)</label><input id="lwStale" type="number" min="1" value="${Math.max(3, s.poll * 3)}"></div><div class="fld"><label>When stale</label><select id="lwOnStale"><option value="hold">Hold last value, grey badge</option><option value="alert">Hold value and raise an advisory</option></select></div></div>`;
    foot = `<button class="ib" id="lwBack">Back</button><button class="ib" id="lwCopy">Copy configuration (JSON)</button><button class="ib pri" id="lwSave" ${rows.length ? '' : 'disabled'}>Save links</button>`;
  }
  openModal(
    head +
      `<div class="lw-body">${body}</div><div class="mact"><label class="chk" style="margin-right:auto"><input type="checkbox" id="lwAutoOpen" ${PREF.autolink !== false ? 'checked' : ''}> Open this after placing new equipment</label>${foot}</div>`,
    'xl',
  );
  $('#lwAutoOpen').onchange = e => {
    PREF.autolink = e.target.checked;
    savePref();
  };
  $$('#mbox [data-go]').forEach(
    x =>
      (x.onclick = () => {
        LW.step = +x.dataset.go;
        lwRender();
      }),
  );
  const on = (sel, fn) => {
    const el = $(sel);
    if (el) el.onclick = fn;
  };
  on('#lwBack', () => {
    LW.step--;
    lwRender();
  });
  on('#lwSkip', closeModal);
  on('#lwNew', () => sourcesForm(() => lwRender()));
  if (st === 1) {
    $$('#mbox input[name=lwS]').forEach(
      r =>
        (r.onchange = () => {
          LW.src = r.value;
          LW.db = null;
          LW.table = null;
          LW.keyCol = '';
          lwRender();
        }),
    );
    on('#lwNext', () => {
      LW.step = 2;
      lwRender();
    });
  }
  if (st === 2) {
    $('#lwDb').onchange = e => {
      LW.db = e.target.value;
      LW.table = null;
      lwRender();
    };
    $('#lwQ').oninput = e => {
      LW.q = e.target.value;
      const p = e.target.selectionStart;
      lwRender();
      const q = $('#lwQ');
      q.focus();
      q.setSelectionRange(p, p);
    };
    $$('#mbox [data-tb]').forEach(
      x =>
        (x.onclick = () => {
          LW.table = x.dataset.tb;
          LW.keyCol = '';
          lwRender();
        }),
    );
    on('#lwNext', () => {
      const t = lwTable();
      if (!t) {
        toast('Choose a table');
        return;
      }
      LW.ids.forEach(id => {
        if (!LW.map[id].col || !t.cols.some(c => c.n === LW.map[id].col)) LW.map[id].col = autoCol(t, id, b);
      });
      LW.keyCol = t.node ? '' : t.key || '';
      LW.step = 3;
      lwRender();
    });
  }
  if (st === 3) {
    const t = lwTable();
    const sel = (s2, f) => {
      const el = $(s2);
      if (el) el.onchange = f;
    };
    sel('#lwT', e => {
      LW.tcol = e.target.value;
      lwPrev();
    });
    sel('#lwK', e => {
      LW.keyCol = e.target.value;
      lwPrev();
    });
    const v = $('#lwV');
    if (v)
      v.oninput = () => {
        LW.keyVal = v.value;
        lwPrev();
      };
    $$('#mbox [data-mc]').forEach(
      el =>
        (el.onchange = () => {
          LW.map[el.dataset.mc].col = el.value;
          lwPrev();
        }),
    );
    $$('#mbox [data-ms]').forEach(
      el =>
        (el.oninput = () => {
          LW.map[el.dataset.ms].scale = +el.value || 1;
          lwPrev();
        }),
    );
    $$('#mbox [data-mo]').forEach(
      el =>
        (el.oninput = () => {
          LW.map[el.dataset.mo].offset = +el.value || 0;
          lwPrev();
        }),
    );
    on('#lwAuto', () => {
      let n = 0;
      LW.ids.forEach(id => {
        const c = autoCol(t, id, b);
        if (c) {
          LW.map[id].col = c;
          n++;
        }
      });
      lwRender();
      toast(`Auto-mapped ${n} of ${LW.ids.length} tags`);
    });
    on('#lwClr', () => {
      LW.ids.forEach(id => (LW.map[id].col = ''));
      lwRender();
    });
    on('#lwNext', () => {
      if (!t.tall && !LW.ids.some(id => LW.map[id].col)) {
        toast('Map at least one tag, or go back and pick another table');
        return;
      }
      if (!t.node && LW.keyCol && !t.tall && !LW.keyVal.trim()) {
        toast('Enter the filter value that identifies this equipment');
        return;
      }
      LW.step = 4;
      lwRender();
    });
    lwPrev();
  }
  if (st === 4) {
    on('#lwCopy', () =>
      copyText(
        JSON.stringify(
          LW.ids
            .filter(id => lwTable()?.tall || LW.map[id].col)
            .map(id => ({
              tag: id,
              source: s.name,
              sourceType: s.type,
              host: s.host,
              ...lwLinkFor(id),
              query: linkQuery({ id, link: lwLinkFor(id) }),
            })),
          null,
          1,
        ),
        'Link configuration copied',
      ),
    );
    on('#lwSave', () => {
      pushUndo();
      const stale = +$('#lwStale').value || 10,
        onStale = $('#lwOnStale').value;
      let n = 0;
      LW.ids.forEach(id => {
        const t = REG[id];
        if (!t) return;
        const L = lwLinkFor(id);
        if (!lwTable()?.tall && !L.col) {
          if (t.link && t.link.src === LW.src) {
            delete t.link;
            t.src = 'Simulated';
          }
          return;
        }
        L.stale = stale;
        L.onStale = onStale;
        t.link = L;
        t.src = s.name;
        t.addr = linkText(t);
        n++;
      });
      logEv(`Linked ${n} tag(s)${b ? ` on ${b.name}` : ''} to ${s.name}`);
      closeModal();
      changed();
      toast(`${n} tag(s) linked to ${s.name}`);
    });
  }
}
function lwLinkFor(id) {
  const t = lwTable(),
    m = LW.map[id];
  return {
    src: LW.src,
    db: LW.db,
    table: LW.table,
    col: t?.tall ? 'value' : m.col,
    tall: !!t?.tall,
    keyCol: t?.node ? '' : LW.keyCol,
    keyVal: t?.tall ? id : LW.keyVal,
    tcol: LW.tcol,
    scale: m.scale,
    offset: m.offset,
  };
}
function lwPrev() {
  const t = lwTable(),
    P = $('#lwPrev');
  if (!t || !P) return;
  const mapped = LW.ids.filter(id => t.tall || LW.map[id].col);
  $('#lwCount').textContent = `${mapped.length} of ${LW.ids.length} mapped`;
  LW.ids.forEach(id => {
    const el = document.querySelector(`[data-mp="${CSS.escape(id)}"]`);
    if (!el) return;
    const m = LW.map[id],
      tg = REG[id];
    el.textContent = (t.tall || m.col) && tg ? `${fmtN(val(id) * m.scale + m.offset, tg.d)} ${tg.unit}` : '—';
  });
  if (t.node) {
    P.innerHTML = `<table><thead><tr><th>Variable</th><th>Value</th><th>Quality</th><th>Source timestamp</th></tr></thead><tbody>${mapped.map(id => `<tr><td class="mono">${esc(t.tall ? id : LW.map[id].col)}</td><td class="mono">${fmtN(val(id), REG[id].d)}</td><td><span class="chip sv0">Good</span></td><td class="mono">${hms(new Date())}</td></tr>`).join('') || '<tr><td colspan="4" class="note">Map a tag to see live samples.</td></tr>'}</tbody></table>`;
    return;
  }
  const cols = t.tall
    ? [LW.tcol, LW.keyCol || 'tag_name', 'value', 'quality']
    : [LW.tcol, ...(LW.keyCol ? [LW.keyCol] : []), ...[...new Set(mapped.map(id => LW.map[id].col))]];
  const rows = t.tall
    ? mapped.slice(0, 6).map(id => [hms(new Date()), id, fmtN(val(id), REG[id].d), '192'])
    : [0, 1, 2, 3, 4].map(i => [
        hms(new Date(Date.now() - i * (SRC(LW.src).poll * 1000))),
        ...(LW.keyCol ? [LW.keyVal || '?'] : []),
        ...[...new Set(mapped.map(id => LW.map[id].col))].map(c => {
          const id = mapped.find(x => LW.map[x].col === c),
            V = VAL[id],
            h = V && V.h[V.h.length - 1 - i * SRC(LW.src).poll];
          return fmtN(h ? h.v : val(id), REG[id].d);
        }),
      ]);
  P.innerHTML = `<table><thead><tr>${cols.map(c => `<th class="mono">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(v => `<td class="mono">${esc(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="note">Map a tag to see sample rows.</td></tr>`}</tbody></table>`;
}
function dataTab(b) {
  const L = b.tags.map(bt => REG[bt.id]).filter(Boolean),
    n = L.filter(t => t.link).length;
  return `<div class="sec"><div style="display:flex;align-items:center;gap:8px"><div><b>${n} of ${L.length} tags linked</b><div class="note">${n ? 'Live values come from the linked sources.' : 'All values are simulated until linked.'}</div></div><button class="ib pri" id="pLink" style="margin-left:auto">${n ? 'Edit links' : 'Link data…'}</button></div></div>
 <div class="sec">${L.map(t => `<div class="trow"><div class="top"><span class="bar" style="background:${t.link ? '#1f9d55' : '#94a3b8'}"></span><div style="min-width:0"><div class="id">${esc(t.id)}</div><div class="ds">${t.link ? `<span class="tx0">●</span> ${esc(SRC(t.link.src)?.name || '?')}` : '<span class="note">Simulated</span>'}</div>${t.link ? `<div class="ds mono" style="white-space:normal">${esc(linkText(t))}</div>` : ''}</div><span class="v" data-live="${esc(t.id)}">${fmtT(t.id)}</span>${t.link ? `<button class="lb" data-unl="${esc(t.id)}" title="Unlink" style="color:var(--crit)">×</button>` : ''}</div></div>`).join('') || '<div class="note">No tags on this item.</div>'}
 <button class="ib" id="pSrc" style="width:100%;margin-top:6px">Manage data sources…</button></div>`;
}

$('#rClose').onclick = () => {
  PREF.right = false;
  savePref();
  applyPrefs(); // no refit: the plant stays where it is
  toast('Properties closed — ☰ Properties or double-click equipment to reopen');
};
$('#rWide').onclick = () => {
  PREF.rw = (PREF.rw || 320) > 420 ? 320 : 640;
  PREF.right = true;
  savePref();
  applyPrefs();
};
$('#bProps').onclick = () => {
  if (innerWidth <= 960) {
    $('#right').classList.toggle('open');
    $('#backdrop').classList.toggle('on', $('#right').classList.contains('open'));
    return;
  }
  PREF.right = !PREF.right;
  savePref();
  applyPrefs();
};
(() => {
  const g = $('#rGrip');
  let sx = 0,
    sw = 0,
    on = false;
  g.addEventListener('pointerdown', e => {
    if (innerWidth <= 960) return;
    on = true;
    sx = e.clientX;
    sw = PREF.rw || 320;
    g.setPointerCapture(e.pointerId);
    g.classList.add('drag');
    e.preventDefault();
  });
  g.addEventListener('pointermove', e => {
    if (!on) return;
    PREF.rw = clamp(
      Math.round(sw - (e.clientX - sx) / (PREF.ui || 1)),
      260,
      Math.round((innerWidth * 0.6) / (PREF.ui || 1)),
    );
    layoutCols();
  });
  g.addEventListener('pointerup', () => {
    if (!on) return;
    on = false;
    g.classList.remove('drag');
    savePref();
    applyPrefs(true);
  });
  g.addEventListener('dblclick', () => {
    PREF.rw = 320;
    savePref();
    applyPrefs(true);
  });
})();
