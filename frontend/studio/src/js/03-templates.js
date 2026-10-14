/*! SandMan Process Flowsheet — 03-templates.js
 *  Built-in flowsheet templates (sand handling & molding line, complete foundry line)
 *  Classic script; shares the global scope with the other files. Load order matters (see index.html). */

/* ===== Templates ===== */
function loadSandLine() {
  DOC = blankDoc();
  REG = {};
  const A = (type, name, x, y, o = {}) =>
    addBlock(
      type,
      x,
      y,
      Object.assign(
        { name, show: EQ[type].inst && type !== 'valve' && type !== 'ctrlValve' ? undefined : [] },
        o,
      ),
    );
  const C = (a, ap, b, bp, k) => connect(byName(a).id, ap, byName(b).id, bp, k);
  A('title', 'TITLE-1', 470, 6, { w: 600 });
  A('clock', 'CLK-1', 1418, 24);
  // Bond & additive storage
  A('additiveBin', 'SOT-BIN', 66, 80, { w: 70, h: 215, props: { label: 'SOT\nAdditive\nBin' } });
  A('truck', 'TRK-1', 156, 234);
  A('additiveBin', 'SAND-BIN', 242, 75, { w: 72, h: 220, props: { label: 'SAND\nAdditive\nBin' } });
  A('additiveBin', 'ACK-BIN', 393, 100, { w: 72, h: 200, props: { label: 'ACK\nSAND BIN' } });
  A('screwFeeder', 'SF-1', 89, 322, { w: 56 });
  A('screwFeeder', 'SF-2', 266, 322, { w: 56 });
  A('screwFeeder', 'SF-3', 417, 322, { w: 56 });
  A('junction', 'J-3', 410, 388);
  A('contMixer', 'CM-1', 377, 430);
  A('belt', 'P-16', 377, 505, { w: 140 });
  A('inclinedBelt', 'P-18', 521, 463, { w: 268, h: 58 });
  A('dischargeGate', 'DG-1', 578, 530);
  A('elevator', 'T-2', 776, 92, { h: 300, flip: true });
  A('junction', 'J-2', 662, 107);
  A('junction', 'J-1', 575, 107);
  A('gaugeSilo', 'SILO-1', 553, 140, { w: 56, h: 150, props: { label: 'SILO-1\nADD 1' } });
  A('gaugeSilo', 'SILO-2', 640, 140, { w: 56, h: 150, props: { label: 'SILO-2\nADD 2' } });
  A('dosingFeeder', 'DF-1', 538, 342, { props: { label: 'DOSING\nFEEDER 1' } });
  A('dosingFeeder', 'DF-2', 623, 342, { props: { label: 'DOSING\nFEEDER 2' } });
  // Main sand loop
  A('waterInlet', 'W-1', 842, 205);
  A('sandMixer', 'SM-1', 930, 250);
  A('belt', 'P-13', 965, 372, { w: 160 });
  A('belt', 'SDC', 780, 405, { w: 340, flip: true });
  A('elevator', 'T-1', 1165, 58, { h: 338, flip: true });
  A('polygonSieve', 'PS-1', 1062, 84);
  A('blowerHopper', 'BH-1', 1060, 138);
  A('belt', 'P-12', 980, 232, { w: 150, flip: true });
  A('belt', 'P-11', 1215, 320, { w: 88, flip: true });
  A('belt', 'P-10', 1295, 280, { w: 115, flip: true });
  A('belt', 'P-RET', 1391, 300, { w: 500, rot: 90, flip: true });
  A('junction', 'J-4', 838, 425);
  A('junction', 'J-5', 838, 525);
  A('junction', 'J-6', 838, 630);
  const rows = [
    [440, '1', 'P-7', '3#'],
    [545, '2', 'P-4', '2#'],
    [650, '3', 'P-1', '1#'],
  ];
  rows.forEach(([y0, k, pl, so]) => {
    A('holdingHopper', 'HH-' + k, 968, y0, { props: { label: '24M' } });
    A('belt', 'C-' + k, 979, y0 + 80, { w: 47, h: 12 });
    A('disaMini', 'DISA-' + k, 1026, y0 + 68, { tagset: { MPH: { typ: [380, 345, 410][+k - 1] } } });
    A('moldLine', pl, 1080, y0 + 106, { w: 255 });
    A('pourLadle', 'PL-' + k, 1236, y0 + 56, { show: ['TEMP'], off: [50, -40] });
    A('shakeoutUnit', 'SO-' + k, 1420, y0 + 95, { props: { desc: `${so} mold dump / ${so} shakeout` } });
    A('belt', ['P-9', 'P-3', 'P-2'][+k - 1], 1412, y0 + 132, { w: 56, h: 12, flip: true });
    A('toggleBtn', 'BTN-' + k, 1150, y0 + 64, {
      props: { label: `DISA-${k}\nON/OFF`, target: byName('DISA-' + k).id },
    });
  });
  // Instruments
  A('levelTx', 'LT-101', 140, 118, { bind: ['SOT-BIN.LVL'] });
  A('levelTx', 'LT-102', 318, 112, { bind: ['SAND-BIN.LVL'] });
  A('flowTx', 'FT-01', 298, 358, {
    tagset: { PV: { desc: 'Bond transfer flow', unit: 't/h', typ: 6.5, lo: 4, hi: 9, hh: 10, noise: 0.08 } },
  });
  A('ctrlValve', 'XV-01', 406, 404);
  A('valve', 'V-01', 844, 256);
  A('flowTx', 'FIT-01', 864, 262, {
    tagset: {
      PV: {
        desc: 'Mixer water flow',
        unit: 'L/min',
        typ: 24,
        lo: 12,
        hi: 34,
        hh: 40,
        noise: 0.3,
        role: 'water',
      },
    },
  });
  A('tempSensor', 'TE-01', 1036, 262, { bind: ['SM-1.TEMP'] });
  A('speedMon', 'SE-01', 1036, 284, { bind: ['SM-1.RPM'] });
  A('motor', 'M-1', 354, 452);
  A('motor', 'M-2', 462, 494);
  A('motor', 'M-3', 905, 330);
  A('motor', 'M-4', 1058, 330);
  const AN = [
    ['A-01', 592, 84, 'P-14 sand temperature', '°C', 38, null, null, 45, 50, 0.2, ''],
    ['A-02', 796, 86, 'T-2 elevator load', '%', 62, null, null, 85, 92, 0.4, ''],
    ['A-03', 508, 335, 'Bond premix moisture', '%', 6.2, 5, 5.5, 7, 7.6, 0.04, 'pmoist'],
    ['A-04', 502, 484, 'Premix temperature', '°C', 34, null, null, 42, 48, 0.2, ''],
    ['A-05', 995, 196, 'Blower hopper sand temperature', '°C', 41, null, null, 47, 52, 0.25, 'cooltemp'],
    ['A-06', 1186, 38, 'T-1 sand temperature', '°C', 46, null, null, 50, 55, 0.25, 'rtemp'],
    ['A-07', 812, 382, 'Prepared sand compactability', '%', 40, 33, 36, 44, 47, 0.35, 'compact'],
    ['A-08', 982, 384, 'Prepared sand moisture', '%', 3.4, 2.8, 3.0, 3.8, 4.1, 0.035, 'moist'],
    ['A-09', 1300, 256, 'Return sand temperature', '°C', 48, null, null, 52, 58, 0.3, 'rtemp'],
    ['A-10', 1210, 298, 'Return sand moisture', '%', 2.0, 1.5, 1.7, 2.6, 2.9, 0.025, 'cmoist'],
    ['A-11', 1414, 302, 'Return sand lump content', '%', 1.2, null, null, 2.5, 3.5, 0.03, ''],
  ];
  rows.forEach(([y0, k]) => {
    AN.push([
      `A-${11 + +k}`,
      1098,
      y0 + 92,
      `DISA-${k} mold hardness`,
      'B-scale',
      88,
      78,
      82,
      94,
      97,
      0.35,
      'hard',
    ]);
    AN.push([
      `A-${14 + +k}`,
      1312,
      y0 + 92,
      `Line ${k} mold temp before shakeout`,
      '°C',
      320,
      null,
      null,
      420,
      480,
      3,
      '',
    ]);
    AN.push([
      `A-${17 + +k}`,
      1396,
      y0 + 86,
      `Shakeout ${k} sand temperature`,
      '°C',
      85,
      null,
      null,
      110,
      130,
      0.6,
      'shsand',
    ]);
  });
  AN.forEach(a =>
    A('analyzer', a[0], a[1], a[2], {
      tagset: {
        PV: {
          desc: a[3],
          unit: a[4],
          typ: a[5],
          ll: a[6],
          lo: a[7],
          hi: a[8],
          hh: a[9],
          noise: a[10],
          role: a[11],
          d: a[4] === '%' ? 2 : a[5] > 100 ? 0 : 1,
        },
      },
      show: ['PV'],
    }),
  );
  // Streams — bond loop
  C('TRK-1', 'out', 'SAND-BIN', 'in');
  C('SOT-BIN', 'out', 'SF-1', 'in');
  C('SAND-BIN', 'out', 'SF-2', 'in');
  C('ACK-BIN', 'out', 'SF-3', 'in');
  C('SF-1', 'out', 'J-3', 'l', 'add');
  C('SF-2', 'out', 'J-3', 'l', 'add');
  C('SF-3', 'out', 'J-3', 'r', 'add');
  C('J-3', 'b', 'CM-1', 'in', 'add');
  C('CM-1', 'out', 'P-16', 'feed');
  C('P-16', 'out', 'P-18', 'in');
  C('P-18', 'tap', 'DG-1', 'in');
  C('P-18', 'out', 'T-2', 'in');
  C('T-2', 'out', 'J-2', 'r');
  C('J-2', 'l', 'J-1', 'r');
  C('J-2', 'b', 'SILO-2', 'in');
  C('J-1', 'b', 'SILO-1', 'in');
  C('SILO-1', 'out', 'DF-1', 'in');
  C('SILO-2', 'out', 'DF-2', 'in');
  C('DF-1', 'out', 'SM-1', 'add', 'add');
  C('DF-2', 'out', 'SM-1', 'add', 'add');
  // Main loop
  C('W-1', 'out', 'SM-1', 'water', 'water');
  C('SM-1', 'out', 'P-13', 'feed');
  C('P-13', 'drop', 'SDC', 'feed');
  C('SDC', 'drop', 'J-4', 'l');
  C('J-4', 'b', 'J-5', 't');
  C('J-5', 'b', 'J-6', 't');
  C('J-4', 'r', 'HH-1', 'in');
  C('J-5', 'r', 'HH-2', 'in');
  C('J-6', 'r', 'HH-3', 'in');
  rows.forEach(([y0, k, pl]) => {
    const pb = ['P-9', 'P-3', 'P-2'][+k - 1];
    C('HH-' + k, 'out', 'C-' + k, 'feed');
    C('C-' + k, 'out', 'DISA-' + k, 'sand');
    C('DISA-' + k, 'out', pl, 'in', 'mold');
    C(pl, 'out', 'SO-' + k, 'in', 'mold');
    C('SO-' + k, 'sand', pb, 'feed');
    C(pb, 'out', 'P-RET', 'feed');
  });
  C('P-RET', 'out', 'P-10', 'feedb');
  C('P-10', 'out', 'P-11', 'feed');
  C('P-11', 'out', 'T-1', 'in');
  C('T-1', 'out', 'PS-1', 'in');
  C('PS-1', 'out', 'BH-1', 'in');
  C('BH-1', 'out', 'P-12', 'feed');
  C('P-12', 'drop', 'SM-1', 'sand');
  C('P-10', 'drop', 'SDC', 'in', 'ret');
  // HMI panels
  const ids = n => n.map(x => byName(x).id);
  A('controlPanel', 'BOND', 22, 376, {
    w: 132,
    props: {
      title: 'BOND TRANSFER',
      rows: [{ label: '', kind: 'cmd', targets: ids(['SF-1', 'SF-2', 'SF-3', 'CM-1', 'P-16', 'P-18']) }],
    },
  });
  A('notice', 'NT-1', 22, 452, { w: 132 });
  A('controlPanel', 'SYS', 22, 588, {
    w: 246,
    props: {
      title: 'SYSTEM CONTROLS',
      rows: [
        { label: 'SAND TRANSFER', kind: 'cmd', targets: ids(['T-1', 'T-2', 'P-10', 'P-11', 'P-RET', 'SDC']) },
        { label: 'COOLER SYS. START', kind: 'cmd', targets: ids(['PS-1', 'BH-1', 'P-12']) },
        { label: 'MOLDING SAND SYS.', kind: 'cmd', targets: ids(['C-1', 'C-2', 'C-3', 'P-7', 'P-4', 'P-1']) },
        { label: 'MIXER SYS.', kind: 'cmd', targets: ids(['SM-1', 'P-13', 'DF-1', 'DF-2']) },
        { label: 'CO2 CABINET', kind: 'cmd', targets: [], on: true },
        { label: 'POWER START', kind: 'cmd', targets: [], on: true },
        { label: 'CONTROL POWER START', kind: 'light', targets: [], on: true },
        { label: 'DUST COLLECTOR RUNNING', kind: 'light', targets: [], on: true },
      ],
    },
  });
  A('requestStation', 'REQ', 370, 668, {
    w: 170,
    props: {
      title: 'MOLDING SAND\nREQUEST STATION',
      rows: [
        { label: 'P-14', target: byName('T-2').id },
        { label: 'P-19-1', target: byName('C-1').id },
        { label: 'P-19-2', target: byName('C-2').id },
        { label: 'P-19-3', target: byName('C-3').id },
      ],
    },
  });
  A('statusMatrix', 'MSS', 553, 640, {
    w: 266,
    props: { title: 'MOLDING SAND STATION', cols: ids(['DISA-1', 'DISA-2', 'DISA-3']) },
  });
  A('legend', 'LEG', 22, 846, { w: 1476 });
  [
    'SOT-BIN',
    'SAND-BIN',
    'ACK-BIN',
    'SILO-1',
    'SILO-2',
    'DF-1',
    'DF-2',
    'W-1',
    'C-1',
    'C-2',
    'C-3',
    'DG-1',
    'BH-1',
    'SM-1',
    'CM-1',
    'P-9',
    'P-3',
    'P-2',
  ].forEach(n => (byName(n).props.hideName = true));
  seedHist();
  SEL = null;
}
function loadFoundry() {
  DOC = blankDoc();
  DOC.name = 'Green Sand Foundry — Line 1';
  REG = {};
  const A = (type, name, x, y, o = {}) => addBlock(type, x, y, Object.assign({ name }, o));
  const C = (a, ap, b, bp, k) => connect(byName(a).id, ap, byName(b).id, bp, k);
  A('elevator', 'BE-1', 50, 60, { h: 120, w: 24 });
  A('returnBin', 'RSB-1', 130, 40, { show: ['TEMP'], off: [0, 40] });
  A('magSep', 'MS-1', 230, 130, { show: ['FE'] });
  A('screen', 'SC-1', 350, 130, { show: ['VIB'] });
  A('cooler', 'SCL-1', 480, 110, { show: ['TOUT'], off: [0, 22] });
  A('silo', 'SL-1', 600, 40, { show: [] });
  A('addBin', 'BB-1', 725, 60, { show: [], props: { material: 'Bentonite' } });
  A('addBin', 'CD-1', 790, 60, { show: [], props: { material: 'Coal dust' } });
  A('waterDose', 'WD-1', 860, 200, { show: ['FLOW'] });
  A('mixer', 'MX-1', 700, 200, { show: ['MOIST', 'COMP', 'BENT'], off: [-114, -88] });
  A('sandLab', 'ST-1', 800, 310, { show: ['GCS'] });
  A('aerator', 'AE-1', 900, 310, { show: [] });
  A('belt', 'BC-1', 1000, 322, { w: 140 });
  A('moldHopper', 'MH-1', 1180, 330, { show: [] });
  A('disa', 'DM-1', 1120, 440, { flip: true, show: ['MPH', 'SQZ'] });
  A('moldConv', 'MC-1', 870, 480, { flip: true, show: ['SPD'] });
  A('pourUnit', 'PU-1', 740, 440, { flip: true, show: ['TEMP'], off: [-92, -110] });
  A('coolConv', 'CL-1', 480, 480, { flip: true, show: ['CT'] });
  A('shakeout', 'SO-1', 330, 470, { flip: true, show: ['STMP'], off: [0, -108] });
  A('belt', 'BC-2', 230, 600, { w: 140, flip: true });
  A('charge', 'CB-1', 420, 600, { show: [] });
  A('induction', 'IF-1', 520, 585, { show: ['TEMP'] });
  A('holding', 'HF-1', 630, 600, { show: ['TEMP'] });
  A('ladle', 'LD-1', 755, 600, { show: ['TEMP'], off: [50, -20] });
  A('spectro', 'SP-1', 650, 690, { show: ['CE'] });
  A('castCooler', 'CC-1', 60, 700, { show: ['TOUT'] });
  A('shotBlast', 'SB-1', 190, 690, { show: [] });
  A('fettling', 'FG-1', 310, 695, { show: [] });
  A('inspection', 'IN-1', 420, 695, { show: ['REJ'] });
  C('BE-1', 'out', 'RSB-1', 'in');
  C('RSB-1', 'out', 'MS-1', 'in');
  C('MS-1', 'out', 'SC-1', 'in');
  C('SC-1', 'out', 'SCL-1', 'in');
  C('SCL-1', 'out', 'SL-1', 'in');
  C('SL-1', 'out', 'MX-1', 'sand');
  C('BB-1', 'out', 'MX-1', 'add1');
  C('CD-1', 'out', 'MX-1', 'add2');
  C('WD-1', 'out', 'MX-1', 'water');
  C('MX-1', 'out', 'ST-1', 'in');
  C('ST-1', 'out', 'AE-1', 'in');
  C('AE-1', 'out', 'BC-1', 'in');
  C('BC-1', 'out', 'MH-1', 'in');
  C('MH-1', 'out', 'DM-1', 'sand');
  C('DM-1', 'out', 'MC-1', 'in', 'mold');
  C('MC-1', 'out', 'PU-1', 'mold', 'mold');
  C('PU-1', 'out', 'CL-1', 'in', 'mold');
  C('CL-1', 'out', 'SO-1', 'in', 'mold');
  C('SO-1', 'sand', 'BC-2', 'in');
  C('BC-2', 'out', 'BE-1', 'in');
  C('SO-1', 'cast', 'CC-1', 'in');
  C('CC-1', 'out', 'SB-1', 'in');
  C('SB-1', 'out', 'FG-1', 'in');
  C('FG-1', 'out', 'IN-1', 'in');
  C('CB-1', 'out', 'IF-1', 'in');
  C('IF-1', 'out', 'HF-1', 'in');
  C('HF-1', 'out', 'LD-1', 'in');
  C('LD-1', 'out', 'PU-1', 'metal');
  A('legend', 'LEG', 40, 800, { w: 1100 });
  seedHist();
  SEL = null;
}

/* v4.0 — reference loop: Control & IT communication (PLC → Gateway → SCADA → Cloud) */
function loadIIoT() {
  DOC = blankDoc();
  DOC.name = 'IIoT communication';
  REG = {};
  const zone = (name, x, y, w, h) => {
    const z = addBlock('areaBox', x, y, { name });
    z.w = w;
    z.h = h;
    z.props.text = name;
    return z;
  };
  zone('Field level', 20, 300, 520, 360);
  zone('Control level', 560, 300, 400, 360);
  zone('Supervisory / IT', 980, 60, 660, 600);
  zone('Cloud', 1660, 60, 300, 260);
  const A = (t, name, x, y) => addBlock(t, x, y, { name });
  const s1 = A('sm6_ct_sensor_node', 'TE-101', 60, 340),
    s2 = A('sm6_ct_sensor_node', 'ME-102', 170, 340),
    iot = A('sm6_ct_iot_gateway', 'IoT-GW', 330, 330),
    mb = A('sm6_ct_modbus', 'MB-1', 80, 520),
    plc = A('sm6_ct_plc', 'PLC-1', 600, 500),
    hmi = A('sm6_ct_hmi', 'HMI-1', 600, 340),
    sw = A('sm6_ct_switch', 'SW-1', 790, 470),
    gw = A('sm6_ct_gateway', 'EDGE-GW', 1010, 450),
    opc = A('sm6_ct_opcua', 'OPC-UA', 1180, 450),
    sc = A('sm6_ct_scada', 'SCADA', 1360, 440),
    db = A('sm6_ct_database', 'DB-1', 1380, 250),
    srv = A('sm6_ct_server', 'SRV-1', 1200, 230),
    rt = A('sm6_ct_router', 'RTR-1', 1520, 120),
    cl = A('sm6_ct_cloud', 'Cloud', 1730, 120);
  const C = (a, b) => {
    const pp = lfiBestPorts(a, b);
    if (pp) connect(a.id, pp.a, b.id, pp.b, 'data');
  };
  C(s1, iot);
  C(s2, iot);
  C(mb, plc);
  C(plc, sw);
  C(hmi, sw);
  C(sw, gw);
  C(gw, opc);
  C(opc, sc);
  C(sc, db);
  C(sc, srv);
  C(sc, rt);
  C(rt, cl);
  C(iot, cl);
  DOC.streams.forEach(s => (s.route = 'auto'));
  const t = addBlock('title', 30, 20, {});
  t.props.title = 'IIoT COMMUNICATION';
  t.props.sub = 'PLC → GATEWAY → SCADA → CLOUD';
}

/* v9.0 — Sandman Digital Twin: complete foundry sand loop (default demonstration template).
   Raw storage → preparation & mixing → three DISA moulding lines → shakeout (castings separated) → recovery →
   polygon sleeve → sieve hopper → cooling drum → bucket elevator → return sand hopper → return sand bin → mixing.
   Built from the SandMan SVG library; laid out on the Full HD publish page (1920 × 1026) so it publishes 1 : 1.
   All values are SAMPLE data (source "Sample data (demo)") — no database or PLC mapping is implied. */
function loadSandTwin(opt = {}) {
  // v9.24 — the default reference loop follows the customer's SCADA reference screen (03f-sandtwin.js); DemoLoop, the batch
  // mixer preview and the builder (legacy) still use the drawing code below
  if (!opt.demo && !opt.mixer && !opt.legacy && typeof SANDTWIN !== 'undefined') return loadSandTwinRef();
  const BATCH = opt.mixer === 'batch'; // v9.4 preview: batch mixer station (integrated weighing hopper) as the centrepiece
  const DEMO = !!opt.demo; // v9.8 DemoLoop: + Control & IT zone (4 PLCs → SCADA-1), demo data on every equipment
  DOC = blankDoc();
  DOC.name = DEMO ? 'DemoLoop' : 'Sandman Digital Twin — Foundry Sand Loop';
  REG = {};
  DOC.page = { preset: 'fhd', w: 1920, h: 1026, x: 0, y: 0, n: 'Full HD 1920 × 1080' };
  const BLUE = '#1f6fd8', // fresh material / mixed sand supply
    AMBER = '#d97706', // hot recovered sand
    TEAL = '#0d9488'; // cooled return sand
  const A = (type, name, x, y, o = {}) => {
    const E = EQ[type],
      w = o.w || E.w,
      h = o.w ? Math.round((w * E.h) / E.w) : E.h; // aspect ratio always kept
    const b = addBlock(type, x, y, { name, bind: [], flip: !!o.flip, props: o.props || {} });
    if (o.w) {
      b.w = w;
      b.h = h;
    }
    if (o.desc) b.props.desc = o.desc;
    return b;
  };
  const tag = (b, id, desc, unit, typ, o = {}) => {
    mkTag(id, {
      desc,
      unit,
      typ,
      d: o.d != null ? o.d : 1,
      noise: o.noise != null ? o.noise : Math.abs(typ) * 0.008,
      lo: o.lo != null ? o.lo : null,
      hi: o.hi != null ? o.hi : null,
      ll: o.ll != null ? o.ll : null,
      hh: o.hh != null ? o.hh : null,
      role: o.role || '',
      short: o.short || '',
      ...(o.states ? { states: o.states } : {}), // short label beside the value; the full tag ID stays in the tooltip, Properties and tag lists
      src: 'Sample data (demo)',
      addr: '',
    });
    b.tags.push({ id, show: !!o.show });
  };
  const status = (b, id, show) => tag(b, id, 'Status', '', 1, { d: 0, noise: 0, states: { 1: 'RUNNING', 0: 'STOPPED' }, short: 'STATUS', show: !!show });
  const C = (a, ap, b, bp, color) => {
    const s = connect(a.id, ap, b.id, bp);
    if (s) {
      s.route = 'auto';
      if (color) s.color = color;
    }
    return s;
  };
  const J = (name, x, y) => A('junction', name, x - 5, y - 5);
  const zone = (name, x, y, w, h) => {
    const z = addBlock('areaBox', x, y, { name: name.split(' ·')[0] });
    z.w = w;
    z.h = h;
    z.props.text = name;
    z.props.zstyle = 'panel'; // v9.2: soft panel, no dotted border
    return z;
  };
  // ---------- process zones ----------
  zone('A · RAW MATERIAL STORAGE', 10, 54, 460, 458);
  zone('B · SAND PREPARATION & MIXING', 480, 54, BATCH ? 590 : 295, BATCH ? 458 : 498); // v9.12: room for a larger mixer
  zone('E · SCREENING · F · COOLING · G · RETURN SAND', 1080, 54, 830, 458);
  zone('C · DISA MOULDING LINES', BATCH ? 790 : 785, 514, BATCH ? 608 : 613, 510);
  zone('D · SHAKEOUT & SAND RECOVERY', 1406, 514, 504, 510);
  // ---------- ZONE A — raw material storage ----------
  const BEN = A('additiveBin', 'BEN-BIN', 40, 84, { w: 52, desc: 'Bentonite additive bin', props: { label: 'BENTONITE', hideName: true } });
  const NSB = A('additiveBin', 'NS-BIN', 170, 84, { w: 52, desc: 'New sand bin', props: { label: 'NEW\nSAND', hideName: true } });
  const RSB = A('additiveBin', 'RS-BIN', 300, 84, { w: 52, desc: 'Return sand bin / silo', props: { label: 'RETURN\nSAND', hideName: true } });
  const BF = A('sm6_sm_screw_feeder', 'BF-1', 40.7, 256, { w: 110, desc: 'Bentonite screw feeder' });
  const NF = A('sm6_sm_screw_feeder', 'NSF-1', 170.7, 256, { w: 110, desc: 'New sand screw feeder' });
  const RF = A('sm6_sm_screw_feeder', 'RSF-1', 300.7, 256, { w: 110, desc: 'Return sand screw feeder' });
  // ---------- ZONE B — preparation & mixing ----------
  const WH = BATCH ? null : A('sm6_sm_storage_hopper', 'WH-1', 526, 306, { w: 60, desc: 'Weighing hopper' });
  const MX = BATCH
    ? A('sm6_sm_batch_mixer', 'MX-1', 488, 330, { w: 150, desc: 'Batch sand mixer station (weighing hopper + mixer)', props: { hideName: true } })
    : A('sm6_sm_muller_picture_red', 'MX-1', 523.9, 410, { w: 100, flip: true, desc: 'Sand muller (mixer)', props: { hideName: true } });
  const mxl = addBlock('label', BATCH ? 650 : 636, BATCH ? 336 : 412, { name: 'MX-1 label' });
  mxl.props.text = BATCH ? 'MX-1 · Batch mixer station' : 'MX-1 · Sand muller';
  const DC = BATCH
    ? A('sm6_sm_belt_conveyor', 'P-19', 577, 490, { w: 200, desc: 'Mixed sand distribution conveyor' })
    : A('sm6_sm_belt_conveyor', 'P-19', 400, 556, { w: 200, desc: 'Mixed sand distribution conveyor' }); // v9.12: below the larger muller
  // ---------- ZONE C — three DISA moulding lines ----------
  const rows = [546, 702, 858];
  const IF = [],
    PO = [],
    MH = [],
    DS = [],
    ML = [],
    SO = [],
    CC = [];
  rows.forEach((R, i) => {
    const n = i + 1;
    MH.push(A('sm6_sm_storage_hopper', `MH-${n}`, 1000, R, { w: 50, desc: `DISA ${n} moulding hopper`, props: { hideName: true } }));
    DS.push(A('sm6_sm_moulding_machine', `DISA-${n}`, 954, R + 78, { w: 80, desc: `DISA moulding line ${n} — moulding machine` }));
    ML.push(A('sm6_sm_flaskless_moulding_line', `ML-${n}`, 1040, R + 109.3, { w: 220, desc: `DISA ${n} mould line` }));
    // v9.13 — melting and pouring on every line: induction furnace above the mould line → pouring station at its end
    IF.push(A('sm6_sm_induction_furnace', `IF-${n}`, 1170, R + 8, { w: 64, desc: `Induction furnace ${n} (melting)` }));
    PO.push(A('sm6_sm_pouring_station', `POUR-${n}`, 1272, R + 66.3, { w: 110, desc: `Pouring station ${n}` }));
    SO.push(A('sm6_sm_vibratory_shakeout', `SO-${n}`, 1420, R + 95, { w: 120, desc: `Mould dump / shakeout ${n}` }));
    CC.push(A('sm6_sm_belt_conveyor', `CC-${n}`, 1580, R + 104, { w: 110, desc: `Castings to finishing ${n}` }));
  });
  // ---------- ZONE D/E/F/G — recovery, screening, cooling, return ----------
  const RC = A('sm6_sm_belt_conveyor', 'RC-1', 1650, 140, { w: 200, flip: true, desc: 'Recovery conveyor' });
  const PS = A('sm6_sm_polygon_screen', 'PS-1', 1481, 128, { w: 150, flip: true, desc: 'Polygonal sleeve (polygon screen)' });
  const SH = A('sm6_sm_sieve_hopper', 'SH-1', 1515, 200, { w: 86, desc: 'Sieve hopper' });
  const CD = A('sm6_sm_sand_cooler_drum', 'CD-1', 1290, 330, { w: 280, flip: true, desc: 'Sand cooling drum' });
  const BE = A('sm6_sm_bucket_elevator', 'BE-1', 1230, 96, { w: 66, desc: 'Return sand bucket elevator' });
  const RH = A('sm6_sm_return_sand_hopper', 'RH-1', 1100, 150, { w: 70, desc: 'Return sand hopper' });
  // ---------- belt conveyors (built-in belt: stretches in length, keeps its thickness, animates) ----------
  const RB = rows.map((R, i) => {
    const bl = addBlock('belt', 1468, R + 151, { name: `P-${[1, 4, 7][i]}`, bind: [] });
    bl.w = 400;
    bl.props.desc = `Return sand belt under shakeout ${i + 1}`;
    return bl;
  });
  const PRET = addBlock('belt', 600, 262, { name: 'P-RET', flip: true, bind: [] });
  PRET.w = 460;
  PRET.props.desc = 'Return sand belt (return hopper → return sand bin)';
  // ---------- junctions (clean merges / branches) ----------
  const J1 = J('J-1', 403.7, 296); // new + return sand → weighing hopper
  const J2 = BATCH ? J('J-2', 563, 318) : null; // v9.9: in the default loop all three materials go to the weighing hopper
  const JB = rows.map((R, i) => J(`J-B${i + 1}`, BATCH ? 780 : 740, R - 5)); // distribution branches
  const JR = rows.map((R, i) => J(`J-R${i + 1}`, 1880, R + 159)); // recovery riser
  // ---------- connections ----------
  C(BEN, 'out', BF, 'sand-in', BLUE);
  C(NSB, 'out', NF, 'sand-in', BLUE);
  C(RSB, 'out', RF, 'sand-in', TEAL);
  C(NF, 'sand-out', J1, 'l', BLUE);
  C(RF, 'sand-out', J1, 't', TEAL);
  if (BATCH) {
    C(J1, 'r', J2, 't', BLUE);
    C(BF, 'sand-out', J2, 'l', BLUE);
    C(J2, 'b', MX, 'sand-in', BLUE);
    C(MX, 'sand-out', DC, 'sand-in', BLUE);
  } else {
    // v9.9 — bentonite, new sand and return sand all go to the weighing hopper; the hopper feeds the mixer directly
    C(BF, 'sand-out', J1, 'b', BLUE);
    C(J1, 'r', WH, 'sand-in', BLUE);
    C(WH, 'sand-out', MX, 'in', BLUE);
    C(MX, 'out', DC, 'sand-in', BLUE);
  }
  C(DC, 'sand-out', JB[0], BATCH ? 't' : 'l', BLUE);
  C(JB[0], 'b', JB[1], 't', BLUE);
  C(JB[1], 'b', JB[2], 't', BLUE);
  rows.forEach((R, i) => {
    C(JB[i], 'r', MH[i], 'sand-in', BLUE);
    C(MH[i], 'sand-out', DS[i], 'sand-in', BLUE);
    C(DS[i], 'mould-out', ML[i], 'in');
    C(ML[i], 'out', PO[i], 'mould-in');
    C(IF[i], 'metal-out', PO[i], 'metal-in'); // molten metal
    C(PO[i], 'mould-out', SO[i], 'mould-in'); // poured moulds → shakeout
    C(SO[i], 'casting-out', CC[i], 'sand-in'); // castings leave the loop (to finishing)
    C(SO[i], 'sand-out', RB[i], 'feed', AMBER); // only the moulding sand is recovered — it drops onto the return belt
    C(RB[i], 'out', JR[i], 'l', AMBER);
  });
  C(JR[2], 't', JR[1], 'b', AMBER);
  C(JR[1], 't', JR[0], 'b', AMBER);
  C(JR[0], 't', RC, 'sand-in', AMBER);
  C(RC, 'sand-out', PS, 'sand-in', AMBER);
  C(PS, 'fines-out', SH, 'sand-in', AMBER);
  C(SH, 'sand-out', CD, 'sand-in', AMBER);
  C(CD, 'sand-out', BE, 'sand-in', TEAL);
  C(BE, 'sand-out', RH, 'sand-in', TEAL);
  C(RH, 'sand-out', PRET, 'feed', TEAL);
  C(PRET, 'out', RSB, 'in2', TEAL); // the loop closes: return sand back to storage → mixing
  // ---------- sample tags (demo values, existing tag system) ----------
  tag(BEN, 'BENTONITE_LEVEL_PCT', 'Bentonite bin level', '%', 68, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(BEN, 'BENTONITE_WEIGHT_KG', 'Bentonite weight in bin', 'kg', 125, { d: 0 });
  tag(NSB, 'NEW_SAND_LEVEL_PCT', 'New sand bin level', '%', 75, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(NSB, 'NEW_SAND_FLOW_KG_MIN', 'New sand feed rate', 'kg/min', 120, { d: 0 });
  tag(RSB, 'RETURN_SAND_LEVEL_PCT', 'Return sand bin level', '%', 62, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(RSB, 'RETURN_SAND_TEMP_C', 'Return sand temperature', '°C', 85, {});
  tag(WH || MX, 'HOPPER_WEIGHT_KG', 'Weighing hopper batch weight', 'kg', 450, { d: 0, show: true , short: 'WEIGHT' });
  tag(WH || MX, 'HOPPER_LEVEL_PCT', 'Weighing hopper level', '%', 70, { d: 0, show: true, short: 'LEVEL' });
  status(MX, 'MIXER_STATUS', true);
  tag(MX, 'MIXER_RPM', 'Mixer rotor speed', 'rpm', 28, { d: 0, show: true , short: 'SPEED' });
  tag(MX, 'MIXING_TIME_SEC', 'Mixing time', 's', 120, { d: 0 });
  tag(MX, 'MIXER_MOTOR_CURRENT_A', 'Mixer motor current', 'A', 18, { d: 0, hi: 30, show: false , short: 'CURRENT' });
  status(DC, 'CONVEYOR_STATUS');
  tag(DC, 'CONVEYOR_SPEED_M_S', 'Distribution conveyor speed', 'm/s', 1.2, { d: 2 });
  tag(DC, 'CONVEYOR_MOTOR_CURRENT_A', 'Distribution conveyor motor current', 'A', 12, { d: 0 });
  tag(DC, 'MIXED_SAND_FLOW_KG_MIN', 'Mixed sand flow', 'kg/min', 2500, { d: 0, show: true , short: 'FLOW' });
  [1, 2, 3].forEach((n, i) => {
    status(DS[i], `DISA${n}_STATUS`);
    tag(DS[i], `DISA${n}_PRODUCTION_RATE`, `DISA ${n} production rate`, 'moulds/h', [120, 115, 118][i], { d: 0, show: true , short: 'RATE' });
    tag(DS[i], `DISA${n}_MOULD_PRESSURE_BAR`, `DISA ${n} squeeze pressure`, 'bar', [4.5, 4.4, 4.6][i], { lo: 3, hi: 6, show: true , short: 'SQUEEZE' });
    tag(IF[i], `FURNACE${n}_TEMP_C`, `Induction furnace ${n} metal temperature`, '°C', [1520, 1515, 1525][i], { d: 0, show: true, short: 'TEMP' });
    tag(IF[i], `FURNACE${n}_POWER_KW`, `Induction furnace ${n} power`, 'kW', [850, 830, 860][i], { d: 0 });
    status(PO[i], `POUR${n}_STATUS`);
    tag(PO[i], `POUR${n}_TEMP_C`, `Pouring ${n} metal temperature`, '°C', [1420, 1415, 1425][i], { d: 0 });
    tag(PO[i], `POUR${n}_WEIGHT_KG`, `Pouring ${n} poured weight per mould`, 'kg', [18, 17.5, 18.5][i], { d: 1 });
    status(SO[i], `SHAKEOUT${n}_STATUS`);
    tag(SO[i], `SHAKEOUT${n}_VIBRATION_MM_S`, `Shakeout ${n} vibration`, 'mm/s', 4.2, { hi: 12, show: true , short: 'VIBRATION' });
    tag(SO[i], `SHAKEOUT${n}_MOTOR_CURRENT_A`, `Shakeout ${n} motor current`, 'A', 22, { d: 0 });
  });
  status(RC, 'RECOVERY_CONVEYOR_STATUS');
  tag(RC, 'RECOVERY_CONVEYOR_SPEED_M_S', 'Recovery conveyor speed', 'm/s', 1.0, { d: 2, show: true , short: 'SPEED' });
  status(PS, 'POLYGON_SLEEVE_STATUS');
  tag(PS, 'POLYGON_SLEEVE_RPM', 'Polygonal sleeve speed', 'rpm', 18, { d: 0, show: true , short: 'SPEED' });
  status(SH, 'SIEVE_STATUS');
  tag(SH, 'SIEVE_VIBRATION_MM_S', 'Sieve vibration', 'mm/s', 3.5, { show: true , short: 'VIBRATION' });
  status(CD, 'SAND_COOLER_STATUS');
  tag(CD, 'SAND_OUTLET_TEMP_C', 'Sand outlet temperature', '°C', 38, { hi: 48, hh: 55, show: true , short: 'OUTLET' });
  tag(CD, 'SAND_COOLER_RPM', 'Cooling drum speed', 'rpm', 12, { show: true , short: 'SPEED' });
  status(BE, 'BUCKET_ELEVATOR_STATUS');
  tag(BE, 'BUCKET_ELEVATOR_SPEED_M_S', 'Bucket elevator speed', 'm/s', 1.5, { d: 2, show: true , short: 'SPEED' });
  tag(PRET, 'RETURN_BELT_SPEED_M_S', 'Return sand belt speed', 'm/s', 1.25, { d: 2, show: true , short: 'SPEED' });
  RB.forEach((bl, i) => tag(bl, `RETURN_BELT${i + 1}_LOAD_PCT`, `Return belt ${i + 1} load`, '%', [62, 58, 64][i], { d: 0 }));
  tag(RH, 'RETURN_HOPPER_LEVEL_PCT', 'Return sand hopper level', '%', 65, { role: 'level', d: 0, show: true , short: 'LEVEL' });
  tag(RH, 'RETURN_HOPPER_TEMP_C', 'Return sand hopper temperature', '°C', 40, { hi: 48, hh: 55 });
  // ---------- data label positions (clear of names, lines and equipment) ----------
  const off = (b, x, y) => (b.tagOff = { x, y });
  DS.forEach(b => off(b, -150, -140));
  IF.forEach(b => off(b, -108, -40)); // furnace temperature left of the furnace, above the mould line
  SO.forEach(b => off(b, 278, -48));
  if (BATCH) off(MX, 162, -120);
  else {
    off(MX, 112, -106);
    off(WH, 64, -60);
  }
  off(PS, -96, -57);
  off(BE, -120, -50);
  off(RH, -84, -50);
  off(RSB, 60, -90);
  // ---------- HMI panels and header ----------
  const t = addBlock('title', 560, 2, {});
  t.props.title = 'SANDMAN DIGITAL TWIN — FOUNDRY SAND LOOP';
  t.props.sub = '';
  addBlock('clock', 1840, 2, { name: 'CLK-1' }).w = 52;
  const ids = arr => arr.map(b => b.id);
  if (!DEMO) {
  addBlock('controlPanel', 20, 620, {
    name: 'SYS',
    props: {
      title: 'SYSTEM CONTROLS',
      rows: [
        { label: 'SAND PREPARATION', kind: 'cmd', targets: ids([BF, NF, RF, MX, DC]), on: true },
        { label: 'DISA LINE 1', kind: 'cmd', targets: ids([MH[0], DS[0], ML[0]]), on: true },
        { label: 'DISA LINE 2', kind: 'cmd', targets: ids([MH[1], DS[1], ML[1]]), on: true },
        { label: 'DISA LINE 3', kind: 'cmd', targets: ids([MH[2], DS[2], ML[2]]), on: true },
        { label: 'SHAKEOUT & RECOVERY', kind: 'cmd', targets: ids([...SO, RC, PS, SH]), on: true },
        { label: 'COOLING & RETURN', kind: 'cmd', targets: ids([CD, BE, RH]), on: true },
      ],
    },
  }).w = 330;
  const mss = addBlock('statusMatrix', 370, 620, { name: 'MSS', props: { title: 'DISA MOULDING LINES', cols: ids(DS) } });
  mss.w = 340;
  }
  const leg = addBlock('legend', 20, DEMO ? 958 : 940, {
    name: 'LEG',
    props: {
      items: [
        ['#1f6fd8', 'Fresh / mixed sand supply'],
        ['#d97706', 'Hot recovered sand'],
        ['#0d9488', 'Cooled return sand'],
        ['mold', ''],
        ['cast', ''],
        ['A', 'Sample value (demo)'],
      ],
    },
  });
  leg.w = 690;
  if (DEMO) {
    // ---------- v9.8 DemoLoop: demo data on every equipment that had none ----------
    const T = (b, id, desc, unit, v, o = {}) => tag(b, id, desc, unit, v, o);
    T(BF, 'BF1_SPEED_RPM', 'Bentonite feeder speed', 'rpm', 38, { d: 0, short: 'Speed' });
    T(NF, 'NSF1_SPEED_RPM', 'New sand feeder speed', 'rpm', 46, { d: 0, short: 'Speed' });
    T(RF, 'RSF1_SPEED_RPM', 'Return sand feeder speed', 'rpm', 52, { d: 0, short: 'Speed' });
    MH.forEach((b, i) => T(b, `MH${i + 1}_LEVEL_PCT`, `Moulding hopper ${i + 1} level`, '%', [72, 66, 70][i], { role: 'level', d: 0, short: 'Level' }));
    ML.forEach((b, i) => T(b, `ML${i + 1}_COOLING_MIN`, `Mould line ${i + 1} cooling time`, 'min', [45, 44, 46][i], { d: 0, short: 'Cooling' }));
    CC.forEach((b, i) => T(b, `CC${i + 1}_SPEED_M_S`, `Castings conveyor ${i + 1} speed`, 'm/s', [0.6, 0.58, 0.62][i], { d: 2, short: 'Speed' }));
    // ---------- Control & IT: 4 PLCs → SCADA-1 ----------
    const z = addBlock('areaBox', 10, 620, { name: 'H' });
    Object.assign(z, { w: 720, h: 330 });
    Object.assign(z.props, { text: 'H · CONTROL & IT — PLC → SCADA', zstyle: 'panel' });
    const ttl = DOC.blocks.find(b => b.type === 'title');
    if (ttl) ttl.props.title = 'DEMOLOOP — FOUNDRY SAND LOOP';
    const PL = [
      ['Preparation PLC', 'PLC-PREP', [BEN, NSB, RSB, BF, NF, RF, WH || MX, MX, DC, PRET]],
      ['Moulding PLC', 'PLC-MOULD', [...MH, ...DS, ...ML, ...IF, ...PO]],
      ['Shakeout & Recovery PLC', 'PLC-REC', [...SO, ...CC, ...RB, RC, PS, SH]],
      ['Cooling & Return PLC', 'PLC-RET', [CD, BE, RH]],
    ].map(([name, id, eqs], i) => {
      const p = addBlock('sm6_ct_plc_skyblue', 30 + i * 176, 684, { name, bind: [], props: { dmId: id, dmName: name, desc: name } }); // v9.11 blue PLC
      p.w = 140;
      p.h = 92;
      eqs.filter(Boolean).forEach(e => {
        if (!e.props.dmId) e.props.dmId = 'EQ-' + e.name.replace(/[^A-Za-z0-9]+/g, '');
      });
      return [p, id, [...new Set(eqs.filter(Boolean).map(e => e.props.dmId))]];
    });
    const SC = addBlock('sm6_ct_scada', 280, 816, { name: 'SCADA-1', bind: [], props: { dmId: 'SCADA-01', dmName: 'SCADA-1 · Sand plant', desc: 'Plant SCADA — click in Publish view for the PLC Tag Monitor' } });
    SC.w = 170;
    SC.h = Math.round((170 * EQ.sm6_ct_scada.h) / EQ.sm6_ct_scada.w);
    PL.forEach(([p]) => {
      const st = connect(p.id, 'bus-io', SC.id, 'eth-in', 'data');
      if (st) st.route = 'auto';
    });
    DOC.dmap = { v: 1, tags: [], scada: { 'SCADA-01': { plcs: PL.map(x => x[1]) } }, plcEq: Object.fromEntries(PL.map(x => [x[1], x[2]])) };
    const nt = addBlock('notice', 480, 850, { name: 'NT-DEMO' });
    nt.props.text = 'Demo data (simulation).\nClick SCADA-1 or a PLC in Publish view.';
    nt.w = 236;
  }
}

/* v9.4 preview — Digital Twin loop, "control room" layout (from the customer's sketch): four numbered zones, DISA lines
   across the full width, each machine in its own colour, value cards, dark look. Same process graph and tags. */
function loadSandTwinCR() {
  DOC = blankDoc();
  DOC.name = 'Sandman Digital Twin — Foundry Sand Loop (control room)';
  REG = {};
  DOC.page = { preset: 'fhd', w: 1920, h: 1026, x: 0, y: 0, n: 'Full HD 1920 × 1080' };
  DOC.look = 'dark';
  DOC.tagStyle = 'card'; // larger light value cards, as in the sketch
  const BLUE = '#2f8cff',
    AMBER = '#f59e0b',
    TEAL = '#14b8a6';
  const A = (type, name, x, y, o = {}) => {
    const E = EQ[type],
      w = o.w || E.w,
      h = o.w ? Math.round((w * E.h) / E.w) : E.h;
    const b = addBlock(type, x, y, { name, bind: [], flip: !!o.flip, props: o.props || {} });
    if (o.w) {
      b.w = w;
      b.h = h;
    }
    if (o.desc) b.props.desc = o.desc;
    return b;
  };
  const tag = (b, id, desc, unit, typ, o = {}) => {
    mkTag(id, { desc, unit, typ, d: o.d != null ? o.d : 1, noise: o.noise != null ? o.noise : Math.abs(typ) * 0.008, lo: o.lo ?? null, hi: o.hi ?? null, ll: null, hh: o.hh ?? null, role: o.role || '', short: o.short || '', src: 'Sample data (demo)', addr: '' });
    b.tags.push({ id, show: !!o.show });
  };
  const status = (b, id) => tag(b, id, 'Status (1 = running, 0 = stopped)', '', 1, { d: 0, noise: 0 });
  const C = (a, ap, b, bp, color) => {
    const s = connect(a.id, ap, b.id, bp);
    if (s) {
      s.route = 'auto';
      if (color) s.color = color;
    }
    return s;
  };
  const J = (name, x, y) => A('junction', name, x - 5, y - 5);
  const zone = (num, name, x, y, w, h) => {
    const z = addBlock('areaBox', x, y, { name: 'Zone ' + num });
    Object.assign(z, { w, h });
    Object.assign(z.props, { text: name, zstyle: 'panel', num });
    return z;
  };
  zone(1, 'Raw material storage', 16, 14, 540, 504);
  zone(2, 'Sand preparation & mixing', 566, 14, 560, 504);
  zone(3, 'Screening · Cooling · Return sand', 1136, 14, 768, 504);
  zone(4, 'DISA moulding lines', 16, 530, 1888, 490);
  // ① storage
  const BEN = A('additiveBin', 'BEN-BIN', 60, 64, { w: 60, desc: 'Bentonite additive bin', props: { label: 'BENTO-\nNITE', hideName: true } });
  const NSB = A('additiveBin', 'NS-BIN', 200, 64, { w: 60, desc: 'New sand bin', props: { label: 'NEW\nSAND', hideName: true } });
  const RSB = A('additiveBin', 'RS-BIN', 340, 64, { w: 60, desc: 'Return sand bin / silo', props: { label: 'RETURN\nSAND', hideName: true } });
  const BF = A('sm6_sm_screw_feeder', 'BF-1', 67, 258, { w: 100, desc: 'Bentonite screw feeder' });
  const NF = A('sm6_sm_screw_feeder', 'NSF-1', 207, 258, { w: 100, desc: 'New sand screw feeder' });
  const RF = A('sm6_sm_screw_feeder', 'RSF-1', 347, 258, { w: 100, desc: 'Return sand screw feeder' });
  // ② preparation
  const WH = A('sm6_sm_storage_hopper', 'WH-1', 600, 306, { w: 60, desc: 'Weighing hopper' });
  const MX = A('sm6_sm_muller_picture_red', 'MX-1', 697.5, 424, { w: 70, flip: true, desc: 'Sand muller (mixer)', props: { hideName: true } });
  const mxl = addBlock('label', 790, 418, { name: 'MX-1 label' });
  mxl.props.text = 'MX-1 · Sand muller';
  const DC = A('sm6_sm_belt_conveyor', 'P-19', 519.6, 504, { w: 170, flip: true, desc: 'Mixed sand distribution conveyor' });
  const PRET = addBlock('belt', 700, 266, { name: 'P-RET', flip: true, bind: [] });
  PRET.w = 400;
  PRET.props.desc = 'Return sand belt (return hopper → return sand bin)';
  // ③ screening, cooling, return
  const RH = A('sm6_sm_return_sand_hopper', 'RH-1', 1160, 160, { w: 76, desc: 'Return sand hopper' });
  const BE = A('sm6_sm_bucket_elevator', 'BE-1', 1290, 80, { w: 70, desc: 'Return sand bucket elevator' });
  const PS = A('sm6_sm_polygon_screen', 'PS-1', 1567, 160, { w: 160, flip: true, desc: 'Polygonal sleeve (polygon screen)' });
  const RC = A('sm6_sm_belt_conveyor', 'RC-1', 1740, 172, { w: 140, flip: true, desc: 'Recovery conveyor' });
  const SH = A('sm6_sm_sieve_hopper', 'SH-1', 1604, 230, { w: 90, desc: 'Sieve hopper' });
  const CD = A('sm6_sm_sand_cooler_drum', 'CD-1', 1362, 345, { w: 300, flip: true, desc: 'Sand cooling drum' });
  // ④ DISA lines, shakeouts, castings, return belts
  const rows = [560, 710, 860];
  const MH = [], DS = [], ML = [], SO = [], CC = [], RB = [];
  rows.forEach((R, i) => {
    const n = i + 1;
    MH.push(A('sm6_sm_storage_hopper', `MH-${n}`, 457, R, { w: 46, desc: `DISA ${n} moulding hopper`, props: { hideName: true } }));
    DS.push(A('sm6_sm_moulding_machine', `DISA-${n}`, 403.2, R + 72, { w: 86, desc: `DISA moulding line ${n} — moulding machine` }));
    ML.push(A('sm6_sm_flaskless_moulding_line', `ML-${n}`, 510, R + 101.4, { w: 340, desc: `DISA ${n} mould line (pouring & cooling)` }));
    SO.push(A('sm6_sm_vibratory_shakeout', `SO-${n}`, 1000, R + 82, { w: 130, desc: `Mould dump / shakeout ${n}` }));
    CC.push(A('sm6_sm_belt_conveyor', `CC-${n}`, 1160, R + 92, { w: 140, desc: `Castings to finishing ${n}` }));
    const bl = addBlock('belt', 1053, R + 141, { name: `P-${[1, 4, 7][i]}`, bind: [] });
    bl.w = 800;
    bl.props.desc = `Return sand belt under shakeout ${n}`;
    RB.push(bl);
  });
  // junctions
  const J1 = J('J-1', 440.7, 296),
    J2 = J('J-2', 720, 414),
    JB = rows.map((R, i) => J(`J-B${i + 1}`, 505, R - 5)),
    JR = rows.map((R, i) => J(`J-R${i + 1}`, 1890, R + 149));
  // connections (same process graph as the default loop)
  C(BEN, 'out', BF, 'sand-in', BLUE);
  C(NSB, 'out', NF, 'sand-in', BLUE);
  C(RSB, 'out', RF, 'sand-in', TEAL);
  C(NF, 'sand-out', J1, 'l', BLUE);
  C(RF, 'sand-out', J1, 't', TEAL);
  C(J1, 'r', WH, 'sand-in', BLUE);
  C(WH, 'sand-out', J2, 't', BLUE);
  C(BF, 'sand-out', J2, 'l', BLUE);
  C(J2, 'b', MX, 'in', BLUE);
  C(MX, 'out', DC, 'sand-in', BLUE);
  C(DC, 'sand-out', JB[0], 't', BLUE);
  C(JB[0], 'b', JB[1], 't', BLUE);
  C(JB[1], 'b', JB[2], 't', BLUE);
  rows.forEach((R, i) => {
    C(JB[i], 'l', MH[i], 'sand-in', BLUE);
    C(MH[i], 'sand-out', DS[i], 'sand-in', BLUE);
    C(DS[i], 'mould-out', ML[i], 'in');
    C(ML[i], 'out', SO[i], 'mould-in');
    C(SO[i], 'casting-out', CC[i], 'sand-in');
    C(SO[i], 'sand-out', RB[i], 'feed', AMBER);
    C(RB[i], 'out', JR[i], 'l', AMBER);
  });
  C(JR[2], 't', JR[1], 'b', AMBER);
  C(JR[1], 't', JR[0], 'b', AMBER);
  C(JR[0], 't', RC, 'sand-in', AMBER);
  C(RC, 'sand-out', PS, 'sand-in', AMBER);
  C(PS, 'fines-out', SH, 'sand-in', AMBER);
  C(SH, 'sand-out', CD, 'sand-in', AMBER);
  C(CD, 'sand-out', BE, 'sand-in', TEAL);
  C(BE, 'sand-out', RH, 'sand-in', TEAL);
  C(RH, 'sand-out', PRET, 'feed', TEAL);
  C(PRET, 'out', RSB, 'in2', TEAL);
  // sample tags (same IDs as the default loop) — short labels in the card style of the sketch
  tag(BEN, 'BENTONITE_LEVEL_PCT', 'Bentonite bin level', '%', 64, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(BEN, 'BENTONITE_WEIGHT_KG', 'Bentonite weight in bin', 'kg', 5200, { d: 0 });
  tag(NSB, 'NEW_SAND_LEVEL_PCT', 'New sand bin level', '%', 71, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(NSB, 'NEW_SAND_FLOW_KG_MIN', 'New sand feed rate', 'kg/min', 180, { d: 0 });
  tag(RSB, 'RETURN_SAND_LEVEL_PCT', 'Return sand bin level', '%', 58, { role: 'level', lo: 15, hi: 92, d: 0 });
  tag(RSB, 'RETURN_SAND_TEMP_C', 'Return sand temperature', '°C', 41, { hi: 48, hh: 55 });
  tag(WH, 'HOPPER_WEIGHT_KG', 'Weighing hopper batch weight', 'kg', 2500, { d: 0, show: true, short: 'Weight' });
  status(MX, 'MIXER_STATUS');
  tag(MX, 'MIXER_RPM', 'Mixer rotor speed', 'rpm', 62, { d: 0, show: true, short: 'Speed' });
  tag(MX, 'MIXING_TIME_SEC', 'Mixing time', 's', 90, { d: 0 });
  tag(MX, 'MIXER_MOTOR_CURRENT_A', 'Mixer motor current', 'A', 185, { d: 0, hi: 230, show: true, short: 'Current' });
  tag(DC, 'MIXED_SAND_FLOW_KG_MIN', 'Mixed sand flow', 'kg/min', 2500, { d: 0, short: 'Flow' });
  [1, 2, 3].forEach((n, i) => {
    status(DS[i], `DISA${n}_STATUS`);
    tag(DS[i], `DISA${n}_PRODUCTION_RATE`, `DISA ${n} production rate`, 'moulds/h', [360, 340, 355][i], { d: 0, show: true, short: 'Rate' });
    tag(DS[i], `DISA${n}_MOULD_PRESSURE_BAR`, `DISA ${n} squeeze pressure`, 'bar', [11.2, 10.8, 11.0][i], { lo: 9, hi: 13, show: true, short: 'Squeeze' });
    status(SO[i], `SHAKEOUT${n}_STATUS`);
    tag(SO[i], `SHAKEOUT${n}_VIBRATION_MM_S`, `Shakeout ${n} vibration`, 'mm/s', [8.4, 8.1, 8.6][i], { hi: 12, show: true, short: 'Vibration' });
    tag(SO[i], `SHAKEOUT${n}_MOTOR_CURRENT_A`, `Shakeout ${n} motor current`, 'A', [42, 40, 43][i], { d: 0 });
    tag(RB[i], `RETURN_BELT${n}_LOAD_PCT`, `Return belt ${n} load`, '%', [62, 58, 64][i], { d: 0 });
  });
  status(RC, 'RECOVERY_CONVEYOR_STATUS');
  tag(RC, 'RECOVERY_CONVEYOR_SPEED_M_S', 'Recovery conveyor speed', 'm/s', 1.6, { d: 2, show: true, short: 'Speed' });
  status(PS, 'POLYGON_SLEEVE_STATUS');
  tag(PS, 'POLYGON_SLEEVE_RPM', 'Polygonal sleeve speed', 'rpm', 18, { d: 0, show: true, short: 'Speed' });
  status(SH, 'SIEVE_STATUS');
  tag(SH, 'SIEVE_VIBRATION_MM_S', 'Sieve vibration', 'mm/s', 6.2, { show: true, short: 'Vibration' });
  status(CD, 'SAND_COOLER_STATUS');
  tag(CD, 'SAND_OUTLET_TEMP_C', 'Sand outlet temperature', '°C', 42, { hi: 48, hh: 55, show: true, short: 'Outlet' });
  tag(CD, 'SAND_COOLER_RPM', 'Cooling drum speed', 'rpm', 4.5, { show: true, short: 'Speed' });
  status(BE, 'BUCKET_ELEVATOR_STATUS');
  tag(BE, 'BUCKET_ELEVATOR_SPEED_M_S', 'Bucket elevator speed', 'm/s', 1.4, { d: 2, short: 'Speed' });
  tag(PRET, 'RETURN_BELT_SPEED_M_S', 'Return sand belt speed', 'm/s', 1.25, { d: 2, show: true, short: 'Speed' });
  tag(RH, 'RETURN_HOPPER_LEVEL_PCT', 'Return sand hopper level', '%', 66, { role: 'level', d: 0, show: true, short: 'Level' });
  tag(RH, 'RETURN_HOPPER_TEMP_C', 'Return sand hopper temperature', '°C', 43, { hi: 48, hh: 55 });
  // value cards where the sketch has them
  const off = (b, x, y) => (b.tagOff = { x, y });
  DS.forEach(b => off(b, -273, -66));
  SO.forEach(b => off(b, 310, -50));
  off(MX, 92, -76);
  off(WH, 68, -66);
  off(PS, -150, -34);
  off(SH, 100, -50);
  // each machine in its own colour (the sketch); the red muller keeps its paint
  DOC.blocks.forEach(b => {
    if (EQ[b.type].smlib && !/_red$|_blue$|_green$/.test(b.type)) b.props.smpal = 'own';
  });
}

/* v9.5 — Equipment → PLC → SCADA data mapping demo (sample tags from the brief; simulation adapter) */
function loadPlcDemo() {
  DOC = blankDoc();
  DOC.name = 'Equipment → PLC → SCADA — tag monitor demo';
  REG = {};
  DOC.page = { preset: 'fhd', w: 1920, h: 1026, x: 0, y: 0, n: 'Full HD 1920 × 1080' };
  const A = (type, name, x, y, o = {}) => {
    const E = EQ[type],
      w = o.w || E.w,
      h = o.w ? Math.round((w * E.h) / E.w) : E.h;
    const b = addBlock(type, x, y, { name, bind: [], props: o.props || {} });
    if (o.w) Object.assign(b, { w, h });
    return b;
  };
  const t = addBlock('title', 560, 8, {});
  t.props.title = 'EQUIPMENT → PLC → SCADA';
  t.props.sub = 'PLC TAG MONITOR · SAMPLE DATA (SIMULATION)';
  const zone = (txt, x, y, w, h) => {
    const z = addBlock('areaBox', x, y, { name: txt.split(' ')[0] });
    Object.assign(z, { w, h });
    Object.assign(z.props, { text: txt, zstyle: 'panel' });
  };
  zone('Plant equipment (material flow)', 30, 96, 1860, 330);
  zone('PLCs', 30, 446, 1860, 220);
  zone('SCADA', 30, 686, 1860, 300);
  // equipment (stable ids + display names; renaming the blocks never breaks the mapping)
  const FEED = A('sm6_sm_screw_feeder', 'ADD-01', 90, 170, { w: 240, props: { dmId: 'EQ-ADD01', dmName: 'Bentonite Feeder' } });
  const MIX = A('sm6_sm_intensive_mixer', 'MX-01', 440, 150, { w: 170, props: { dmId: 'EQ-MX01', dmName: 'Sand Mixer' } });
  const DISA = A('sm6_sm_moulding_machine', 'DISA-1', 760, 170, { w: 180, props: { dmId: 'EQ-DISA01', dmName: 'DISA 1' } });
  const POUR = A('sm6_sm_pouring_station', 'POUR-1', 1080, 200, { w: 200, props: { dmId: 'EQ-POUR01', dmName: 'Pouring Station' } });
  const CMP = A('sm6_eng_compressor', 'CMP-1', 1560, 210, { w: 170, props: { dmId: 'EQ-CMP01', dmName: 'Air Compressor' } });
  // material flow (unchanged by any data mapping)
  [[FEED, 'sand-out', MIX, 'in'], [MIX, 'out', DISA, 'sand-in'], [DISA, 'mould-out', POUR, 'mould-in']].forEach(([a, ap, b, bp]) => {
    const s = connect(a.id, ap, b.id, bp);
    if (s) s.route = 'auto';
  });
  // PLCs and SCADA
  const P = (name, id, x) => A('sm6_ct_plc', name, x, 510, { props: { dmId: id, dmName: name } });
  const MPLC = P('Mixer PLC', 'PLC-MIXER', 430),
    APLC = P('Additive PLC', 'PLC-ADD', 140),
    DPLC = P('Moulding PLC', 'PLC-MOULD', 780),
    PPLC = P('Pouring PLC', 'PLC-POUR', 1110),
    UPLC = P('Utility PLC', 'PLC-UTIL', 1580);
  const S1 = A('sm6_ct_scada', 'SCADA-1', 700, 780, { w: 190, props: { dmId: 'SCADA-01', dmName: 'SCADA-1 · Sand plant' } });
  const S2 = A('sm6_ct_scada', 'SCADA-2', 1560, 780, { w: 190, props: { dmId: 'SCADA-02', dmName: 'SCADA-2 · Utilities' } });
  // data lines (visual network — kept separate from material lines)
  const D = (a, b) => {
    // equipment → PLC on the equipment's ◆ data point; PLC → SCADA on their network ports
    const pp = !/ct_/.test(a.type) ? { a: '@data', b: 'eth-in' } : lfiBestPorts(a, b); // (runs at start-up: no isIT here)
    const s = pp ? connect(a.id, pp.a, b.id, pp.b, 'data') : null;
    if (s) s.route = 'auto';
  };
  [[FEED, APLC], [MIX, MPLC], [DISA, DPLC], [POUR, PPLC], [CMP, UPLC], [APLC, S1], [MPLC, S1], [DPLC, S1], [PPLC, S1], [UPLC, S2]].forEach(([a, b]) => D(a, b));
  // mapping (stored separately from the lines)
  const T = (tag_id, address, param, equipment_id, plc_id, unit, sim, type = 'REAL', prec = null) => ({ tag_id, address, param, equipment_id, plc_id, type, unit, prec, sim });
  DOC.dmap = {
    v: 1,
    scada: { 'SCADA-01': { plcs: ['PLC-MIXER', 'PLC-ADD', 'PLC-MOULD', 'PLC-POUR'] }, 'SCADA-02': { plcs: ['PLC-UTIL'] } },
    tags: [
      T('TAG-MX01SPD', 'MX01_SPEED', 'Mixer speed', 'EQ-MX01', 'PLC-MIXER', 'rpm', 62, 'REAL', 0),
      T('TAG-MX01CUR', 'MX01_CURRENT', 'Motor current', 'EQ-MX01', 'PLC-MIXER', 'A', 187, 'REAL', 0),
      T('TAG-MXRUNH', 'RUN_HOURS', 'Run hours', 'EQ-MX01', 'PLC-MIXER', 'h', 12840, 'DINT'),
      T('TAG-ADD01W', 'ADD01_WEIGHT', 'Dosed weight', 'EQ-ADD01', 'PLC-ADD', 'kg', 25, 'REAL', 0),
      T('TAG-DISA01R', 'DISA01_RATE', 'Production rate', 'EQ-DISA01', 'PLC-MOULD', 'moulds/h', 363, 'REAL', 0),
      T('TAG-DISARUNH', 'RUN_HOURS', 'Run hours', 'EQ-DISA01', 'PLC-MOULD', 'h', 9120, 'DINT'),
      T('TAG-POUR01T', 'POUR01_TEMP', 'Metal temperature', 'EQ-POUR01', 'PLC-POUR', '°C', 1420, 'REAL', 0),
      T('TAG-CMP01P', 'COMP01_PRESSURE', 'Line pressure', 'EQ-CMP01', 'PLC-UTIL', 'bar', 6.8, 'REAL', 1),
    ],
  };
  const n = addBlock('notice', 60, 930, { name: 'NT-1' });
  n.props.text = 'Sample data — simulation adapter. Click a SCADA, PLC or equipment in Publish view to open the PLC Tag Monitor.';
  n.w = 820;
}

/* v9.8 — DemoLoop: the Digital Twin sand loop with PLCs, SCADA and demo data on every equipment */
function loadDemoLoop() {
  loadSandTwin({ demo: true });
}
