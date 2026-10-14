/*! SandMan Process Flowsheet — 12c-sop.js
 *  Structured SOP per process: document view, live-linked steps, reaction plan, guided runs with sign-off,
 *  structured editor with revision history. SOPs live in DOC.cps[i].sop (v2 format);
 *  guided runs in localStorage 'sandman-sop-runs' (replace with a SandMan table in production). */
'use strict';
const SOP_LIB = {
  ret: {
    purpose:
      'Deliver return sand to the mixer cool, clean and at a stable moisture so prepared sand stays within specification.',
    scope: 'Return belts from shakeout, magnetic separator, screens, cooler / aerator and blower hopper.',
    roles: [
      ['Sand plant operator', 'Runs the equipment, performs and records the checks'],
      ['Sand plant in-charge', 'Reviews deviations and approves corrective action'],
      ['Maintenance', 'Screen, magnet and cooler repairs'],
    ],
    ppe: ['Safety shoes', 'Helmet', 'Dust mask (P2)', 'Ear protection', 'Gloves'],
    prestart: [
      'Dust extraction running',
      'Cooler water supply available',
      'Screen mesh intact',
      'Magnetic separator clean',
      'Belt guards and pull-cords in place',
    ],
    steps: [
      [
        'Start dust extraction, cooler and aerator before releasing return sand.',
        'Start sequence interlocked on SCADA',
        0,
        null,
      ],
      [
        'Release return sand at normal flow and watch the cooler outlet temperature.',
        '≤ 50 °C at cooler outlet',
        1,
        'role:cooltemp',
      ],
      ['Check cooler outlet moisture.', 'Within cooler set point', 0, 'role:cmoist'],
      [
        'Keep the blower hopper between 30 % and 85 % level; never run it empty.',
        '30 – 85 %',
        0,
        'role:level',
      ],
      ['Spot-check return sand temperature every 2 hours and record.', '≤ 50 °C', 1, 'man:3'],
      [
        'Remove lumps and core pieces from the screen reject every 4 hours and record.',
        'Reject bin emptied',
        0,
        'man:2',
      ],
    ],
    reaction: [
      [
        'Return sand above 50 °C for more than 15 min',
        'Increase cooler water and air flow; reduce return flow',
        'Sand engineer',
      ],
      ['Screen mesh torn or blinded', 'Stop the screen, do not bypass; replace or clean mesh', 'Maintenance'],
      [
        'Blower hopper below 20 %',
        'Inform molding; reduce sand demand until level recovers',
        'Sand plant in-charge',
      ],
    ],
    refs: ['Sand system flow diagram', 'Cooler O&M manual'],
  },
  add: {
    purpose: 'Store and dose bentonite, coal dust and premix exactly to the component-group prescription.',
    scope: 'Additive storage bins, dosing silos, screw feeders, dosing feeders and continuous premix mixer.',
    roles: [
      ['Sand plant operator', 'Fills silos, performs zero checks, records consumption'],
      ['Sand engineer', 'Maintains the prescription per component group'],
      ['Stores / QA', 'Receives material and verifies certificates'],
    ],
    ppe: ['Dust mask (P2)', 'Goggles', 'Gloves', 'Safety shoes'],
    prestart: [
      'Supplier certificate verified for the lot in use',
      'Dosing scales zero-checked this shift',
      'Silo levels above 20 %',
      'Silo filters clean',
    ],
    steps: [
      [
        'Verify the supplier certificate (MB value, moisture, grain size) before unloading.',
        'Certificate within purchase spec',
        1,
        'man:0',
      ],
      [
        'Fill silos only through the filter; confirm the level rises on the gauge.',
        'Level rising',
        0,
        'role:level',
      ],
      ['Carry out a zero check on every dosing scale at the start of the shift.', '0 ± 0.2 kg', 1, 'man:1'],
      [
        'Confirm the active component group and that its prescription is loaded in SandMan.',
        'Prescription matches group',
        1,
        null,
      ],
      ['Watch the dosing rate during production.', 'Within ± 8 % of prescription', 0, 'role:dose'],
      ['Record additive consumption at the end of the shift.', 'kg per tonne of sand', 0, null],
    ],
    reaction: [
      [
        'Dosing deviates more than ± 8 % from prescription',
        'Switch feeder to manual; check bridging or blockage',
        'Sand engineer',
      ],
      ['Silo below 15 %', 'Transfer or order material', 'Stores'],
      ['Certificate out of specification', 'Quarantine the lot; do not use', 'QA'],
    ],
    refs: ['Sandmix prescription per component group (SandMan)', 'Supplier specification'],
  },
  mix: {
    purpose:
      'Prepare green sand of consistent moisture, compactability, temperature and bond for every batch.',
    scope: 'Batch sand mixer, water dosing and discharge to the molding sand belt.',
    roles: [
      ['Mixer operator', 'Runs batches, verifies set points, sends samples'],
      ['Sand engineer', 'Sets targets, adjusts prescription, approves deviations'],
      ['Sand lab', 'Tests samples and reports results'],
    ],
    ppe: ['Safety shoes', 'Helmet', 'Ear protection', 'Lock-out before entering mixer'],
    prestart: [
      'Component group and prescription loaded',
      'Water meter verified this shift',
      'Mixer ploughs and scrapers in good condition',
      'Moisture controller in AUTO',
    ],
    steps: [
      [
        'Confirm the component group and its sandmix prescription in SandMan.',
        'Prescription loaded',
        1,
        null,
      ],
      ['Charge return sand, then additives as per prescription.', 'Bentonite as prescribed', 1, 'role:bent'],
      ['Add water through the moisture controller.', 'Moisture 3.0 – 3.8 %', 1, 'role:moist'],
      ['Mix for at least the set batch time before discharge.', 'Batch time ≤ 110 s', 0, 'role:btime'],
      ['Check compactability at discharge.', '36 – 44 %', 1, 'role:compact'],
      ['Check mixed sand temperature at discharge.', '≤ 45 °C', 1, 'role:mtemp'],
      ['Verify the water meter with a bucket test once per shift.', 'Within ± 2 %', 1, 'man:0'],
      [
        'Send a prepared sand sample to the lab every 2 hours.',
        'Sample labelled with time and batch',
        1,
        'man:1',
      ],
    ],
    reaction: [
      [
        'Compactability outside 36 – 44 % (one batch)',
        'Adjust water set point; recheck next batch',
        'Mixer operator',
      ],
      ['Three batches in a row out of limit', 'Stop discharge to molding', 'Sand engineer'],
      ['Mixed sand above 45 °C', 'Check cooler and return sand temperature', 'Sand plant in-charge'],
      ['Mixer motor current high', 'Stop the mixer; check overload', 'Maintenance'],
    ],
    refs: ['Sandmix prescription (SandMan)', 'Mixer O&M manual'],
  },
  lab: {
    purpose:
      'Test prepared sand at a fixed frequency and report results so the sand plant can correct deviations quickly.',
    scope: 'Sampling at mixer discharge and all green sand tests in the sand laboratory.',
    roles: [
      ['Lab technician', 'Samples, tests and records results'],
      ['Lab in-charge', 'Calibration and method control'],
      ['Sand engineer', 'Acts on out-of-limit results'],
    ],
    ppe: ['Lab coat', 'Gloves', 'Goggles', 'Heat-resistant gloves (LOI furnace)'],
    prestart: [
      'Sand tester calibrated today',
      'Specimen tube and rammer clean',
      'Moisture teller and permeameter ready',
    ],
    steps: [
      ['Take the sample at the mixer discharge belt in a closed container.', 'Every 2 hours', 1, null],
      [
        'Prepare the standard AFS specimen (3 rams) within 10 minutes of sampling.',
        '≤ 10 min after sampling',
        1,
        null,
      ],
      ['Test green compression strength.', '14 – 22 N/cm²', 1, 'man:0'],
      ['Test permeability.', '100 – 180', 1, 'man:1'],
      ['Run the methylene blue test for active clay once per shift.', '7 – 10 %', 0, 'man:2'],
      ['Run loss on ignition once a day.', '3 – 5 %', 0, 'man:3'],
      [
        'Calibrate the sand tester with the standard specimen daily before testing.',
        'Within tester tolerance',
        1,
        'man:4',
      ],
      [
        'Record all results in SandMan and inform the sand plant of any deviation.',
        'Within 15 minutes',
        0,
        null,
      ],
    ],
    reaction: [
      ['GCS below 14 N/cm²', 'Inform sand plant; adjust bentonite per engineer', 'Sand engineer'],
      ['Permeability below 100', 'Check fines and dust extraction', 'Sand engineer'],
      ['Calibration fails', 'Stop testing; use the backup tester', 'Lab in-charge'],
    ],
    refs: ['AFS mold & core test handbook', 'Lab calibration register'],
  },
  mold: {
    purpose: 'Produce sound molds of uniform hardness, correctly cored, ready for pouring.',
    scope: 'Molding machines, holding hoppers, core setting and the mold line up to pouring.',
    roles: [
      ['Molding operator', 'Runs the machine and performs mold checks'],
      ['Molding supervisor', 'Pattern changes and first-mold approval'],
      ['Maintenance', 'Hydraulic and machine faults'],
    ],
    ppe: ['Safety shoes', 'Helmet', 'Ear protection', 'Gloves', 'Machine guard interlocks active'],
    prestart: [
      'Correct pattern mounted and verified',
      'Parting agent available',
      'Squeeze pressure set per pattern card',
      'Sand compactability within spec',
    ],
    steps: [
      [
        'At pattern change, clean the pattern plates and apply parting agent.',
        'Clean, evenly coated',
        1,
        'man:0',
      ],
      ['Set squeeze pressure as per the pattern card.', 'Per pattern card', 1, 'role:squeeze'],
      ['Check the first mold: hardness, edges and sprue.', 'Hardness ≥ 85 B-scale', 1, 'role:hard'],
      ['Check mold hardness with the hand tester every hour and record.', '85 – 95 B-scale', 1, 'man:1'],
      ['Verify cores are seated correctly before closing.', 'No loose cores', 0, 'man:2'],
      ['Keep sprue and vents clear.', 'Checked hourly', 0, 'man:3'],
      ['Monitor the molding rate.', 'As planned for the pattern', 0, 'role:mph'],
    ],
    reaction: [
      [
        'Mold hardness below limit',
        'Check compactability and squeeze; mark affected molds',
        'Molding supervisor',
      ],
      ['Broken mold edges', 'Stop; check pattern and sand properties', 'Molding supervisor'],
      ['Squeeze pressure deviation', 'Stop the machine; check hydraulics', 'Maintenance'],
    ],
    refs: ['Pattern cards', 'Molding machine O&M manual'],
  },
  pour: {
    purpose: 'Pour metal at the right temperature, treatment and speed into every mold, safely.',
    scope: 'Holding furnace, ladles / pouring units and pouring on the mold line.',
    roles: [
      ['Pourer', 'Ladle preparation, treatment, temperature check and pouring'],
      ['Melting in-charge', 'Metal chemistry and temperature window'],
      ['Shift in-charge', 'Emergency response'],
    ],
    ppe: ['Aluminised jacket', 'Face shield', 'Molten-metal gloves', 'Leggings', 'Safety shoes'],
    prestart: [
      'Pouring area clear of people and water',
      'Ladle dry and preheated',
      'Inoculant weighed for the ladle',
      'Thermocouple tips available',
    ],
    steps: [
      ['Preheat the ladle before tapping.', 'Ladle glowing / ≥ 600 °C', 1, 'man:0'],
      ['Tap, add inoculant as per specification and record the weight.', 'Weight as per spec', 1, 'man:1'],
      ['Measure the temperature with an immersion thermocouple.', '1390 – 1445 °C', 1, 'man:2'],
      ['De-slag before pouring.', 'Clean surface', 0, 'man:3'],
      ['Pour within the set pour time.', 'Pour time ≤ 9.5 s', 1, 'role:ptime'],
      ['Watch the pouring temperature during the ladle.', 'Within pouring window', 1, 'role:pourT'],
      ['Record the heat number against the molds poured.', 'Heat no. logged', 0, null],
    ],
    reaction: [
      [
        'Temperature below the pouring window',
        'Do not pour; return metal to the furnace',
        'Melting in-charge',
      ],
      ['Pour time exceeded', 'Check stopper / nozzle; slow the line', 'Melting in-charge'],
      ['Metal spill or run-out', 'Evacuate; follow the emergency plan', 'Shift in-charge'],
    ],
    refs: ['Pouring temperature chart per grade', 'Emergency response plan'],
  },
  shk: {
    purpose: 'Shake out castings only after enough cooling and return all sand to the system.',
    scope: 'Cooling line, shakeout and sand discharge to the return belt.',
    roles: [
      ['Shakeout operator', 'Runs the shakeout and performs checks'],
      ['Fettling supervisor', 'Casting handling and quality'],
      ['Maintenance', 'Grid and drive repairs'],
    ],
    ppe: ['Heat-resistant gloves', 'Safety shoes', 'Helmet', 'Ear protection'],
    prestart: ['Shakeout grid intact', 'Return belt running', 'Dust extraction running'],
    steps: [
      ['Confirm the minimum cooling time is reached.', 'Cooling time as per pattern', 1, 'role:ctime'],
      ['Spot-check casting temperature at shakeout every 2 hours.', '≤ 650 °C', 1, 'man:0'],
      ['Run the shakeout and route sand to the return system.', 'Grid vibration normal', 0, 'role:svib'],
      ['Check sand temperature at shakeout.', 'Within limit', 0, 'role:shsand'],
      ['Inspect the shakeout grid each shift.', 'No cracks or missing bars', 0, 'man:1'],
      ['Clean spilled sand and return it to the system.', 'Area clean at shift end', 0, 'man:2'],
    ],
    reaction: [
      ['Castings hotter than the limit', 'Increase cooling time or reduce line speed', 'Molding supervisor'],
      ['Grid damage', 'Stop; repair before restart', 'Maintenance'],
      ['Sand temperature at shakeout high', 'Inform the sand plant', 'Sand plant in-charge'],
    ],
    refs: ['Cooling time per pattern', 'Shakeout O&M manual'],
  },
};
let SOPRUNS = {};
try {
  SOPRUNS = JSON.parse(localStorage.getItem('sandman-sop-runs') || '{}');
} catch (e) {
  SOPRUNS = {};
}
const sopSaveRuns = () => {
  try {
    localStorage.setItem('sandman-sop-runs', JSON.stringify(SOPRUNS));
  } catch (e) {}
};
let RUN = null,
  SOPDRAFT = null;
const today = () => new Date().toISOString().slice(0, 10);
function sopUpgrade(p) {
  const s = p.sop || {};
  if (s.v2) return s;
  const L = SOP_LIB[p.key];
  const legacySteps = Array.isArray(s.steps) ? s.steps : [];
  const n = {
    v2: 1,
    no: s.no || 'SOP-' + p.id.slice(-4).toUpperCase(),
    title:
      (s.title || p.name + ' — standard operating procedure').replace(
        / — standard operating procedure$/,
        '',
      ) + ' — standard operating procedure',
    version: s.version || '1.0',
    effective: s.reviewed || today(),
    owner: s.owner || '',
    approver: 'Plant head',
    status: 'Approved',
    reviewMonths: 12,
    purpose: L ? L.purpose : '',
    scope: L ? L.scope : '',
    roles: L ? L.roles.map(([role, resp]) => ({ role, resp })) : [],
    ppe: L
      ? L.ppe.slice()
      : String(s.ppe || '')
          .split(/[,;]/)
          .map(x => x.trim())
          .filter(Boolean),
    prestart: L ? L.prestart.slice() : [],
    steps: L
      ? L.steps.map(([t, key, crit, param]) => ({ t, key, crit, param }))
      : legacySteps.map(t => ({ t, key: '', crit: 0, param: null })),
    reaction: L
      ? L.reaction.map(([cond, action, esc]) => ({ cond, action, esc }))
      : s.reaction
        ? [{ cond: 'Any checkpoint out of limit', action: s.reaction, esc: s.owner || '' }]
        : [],
    refs: L ? L.refs.slice() : [],
    revisions: [
      { v: s.version || '1.0', date: s.reviewed || today(), by: 'SandMan template', note: 'Initial issue' },
    ],
  };
  p.sop = n;
  return n;
}
function sopAll() {
  (DOC.cps || []).forEach(sopUpgrade);
}
function sopParam(p, ref) {
  if (!ref) return null;
  if (ref.startsWith('role:')) {
    const r = ref.slice(5);
    return p.items.find(i => i.kind === 'auto' && REG[i.tag] && REG[i.tag].role === r) || null;
  }
  if (ref.startsWith('man:')) return p.items.find(i => i.id === `cpm_${p.key}_${ref.slice(4)}`) || null;
  return p.items.find(i => i.id === ref) || null;
}
function sopNextReview(s) {
  const d = new Date(s.effective || today());
  d.setMonth(d.getMonth() + (s.reviewMonths || 12));
  return d;
}
function sopState(s) {
  return new Date() > sopNextReview(s) ? 'Review due' : s.status || 'Approved';
}
function sopLive(p, ref) {
  const it = sopParam(p, ref);
  if (!it) return '';
  const S = cpStatus(it),
    L = cpLimits(it),
    v = S.v != null ? fmtN(S.v, L.d) : S.r ? (S.r.ok === false ? 'Not OK' : 'OK') : '—';
  const chart = it.kind === 'auto' ? it.tag : L.num ? 'cp:' + it.id : '';
  return `<span class="sop-live ${S.st}" ${chart ? `data-sopch="${esc(chart)}" title="Open control chart"` : ''}><i></i>${v}${L.num ? ' ' + esc(L.unit || '') : ''}</span>`;
}
/* ---------- compact SOP panel beside the checks ---------- */
cpSopHtml = function (p) {
  const s = sopUpgrade(p),
    st = sopState(s),
    runs = (SOPRUNS[p.id] || []).slice(-1)[0];
  const outs = p.items.filter(it => cpStatus(it).st === 'out');
  return `<div class="sop-pan"><div class="sop-pan-h"><div><div class="sop-no">${esc(s.no)} · Rev ${esc(s.version)}</div><b>${esc(p.name)}</b></div><span class="chip ${st === 'Approved' ? 'sv0' : 'sv1'}">${esc(st)}</span></div>
   <div class="sop-pan-a"><button class="ib pri" id="sopRun">▶ Start guided run</button><button class="ib" id="sopDoc">Full SOP</button></div>
   ${runs ? `<div class="note">Last run ${new Date(runs.end).toLocaleString('en-GB', { hour12: false, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} by ${esc(runs.by)} — ${runs.done}/${runs.total} steps</div>` : '<div class="note">No guided runs yet.</div>'}
   ${
     outs.length
       ? `<div class="cp-react"><b>Reaction needed now</b>${outs
           .map(o => {
             const r =
               s.reaction.find(x => x.cond.toLowerCase().includes(o.name.split(' ')[0].toLowerCase())) ||
               s.reaction[0];
             return `<div>${esc(o.name)} → ${esc(r ? r.action : 'Follow the reaction plan')}${r && r.esc ? ` <span class="note">(${esc(r.esc)})</span>` : ''}</div>`;
           })
           .join('')}</div>`
       : ''
   }
   <div class="sop-sec">Procedure</div><ol class="sop-steps">${s.steps.map(x => `<li class="${x.crit ? 'crit' : ''}"><div>${esc(x.t)}</div>${x.key || x.param ? `<div class="sop-key">${x.key ? `<span>${esc(x.key)}</span>` : ''}${sopLive(p, x.param)}</div>` : ''}</li>`).join('')}</ol>
   <div class="sop-sec">Safety / PPE</div><div class="sop-ppe">${s.ppe.map(x => `<span>${esc(x)}</span>`).join('')}</div></div>`;
};
/* ---------- full document ---------- */
function sopDocHtml(p) {
  const s = sopUpgrade(p),
    st = sopState(s),
    nr = sopNextReview(s),
    runs = (SOPRUNS[p.id] || []).slice(-6).reverse();
  const params = s.steps.map(x => sopParam(p, x.param)).filter((v, i, a) => v && a.indexOf(v) === i);
  return `<div class="sop-doc"><div class="sop-bar"><button class="ib" id="sopBack">← ${esc(p.name)}</button><span style="flex:1"></span><button class="ib" id="sopCopy">Copy as text</button><button class="ib" id="sopEdit">✎ Edit SOP</button><button class="ib pri" id="sopRun">▶ Start guided run</button></div>
   <div class="sop-paper"><div class="sop-title"><div><div class="sop-no">${esc(s.no)}</div><h2>${esc(s.title)}</h2></div><span class="chip ${st === 'Approved' ? 'sv0' : 'sv1'}">${esc(st)}</span></div>
   <table class="sop-meta"><tr><th>Revision</th><td>${esc(s.version)}</td><th>Effective</th><td>${esc(s.effective)}</td><th>Next review</th><td>${nr.toISOString().slice(0, 10)}</td></tr><tr><th>Owner</th><td>${esc(s.owner || '—')}</td><th>Approved by</th><td>${esc(s.approver || '—')}</td><th>Process</th><td>${esc(p.name)}</td></tr></table>
   <h3>1. Purpose</h3><p>${esc(s.purpose || '—')}</p><h3>2. Scope</h3><p>${esc(s.scope || '—')}</p>
   <h3>3. Responsibilities</h3><table class="sop-t"><thead><tr><th>Role</th><th>Responsibility</th></tr></thead><tbody>${s.roles.map(r => `<tr><td><b>${esc(r.role)}</b></td><td>${esc(r.resp)}</td></tr>`).join('') || '<tr><td colspan="2" class="note">—</td></tr>'}</tbody></table>
   <h3>4. Safety &amp; PPE</h3><div class="sop-ppe">${s.ppe.map(x => `<span>${esc(x)}</span>`).join('') || '—'}</div>
   <h3>5. Pre-start checks</h3><ul class="sop-pre">${s.prestart.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="note">—</li>'}</ul>
   <h3>6. Procedure</h3><table class="sop-t sop-proc"><thead><tr><th>#</th><th>Step</th><th>Key point / specification</th><th>Live</th></tr></thead><tbody>${s.steps.map((x, i) => `<tr class="${x.crit ? 'crit' : ''}"><td class="mono">${i + 1}</td><td>${esc(x.t)}${x.crit ? ' <span class="cp-crit">critical</span>' : ''}</td><td>${esc(x.key || '')}</td><td>${sopLive(p, x.param)}</td></tr>`).join('')}</tbody></table>
   ${
     params.length
       ? `<h3>7. Critical parameters</h3><table class="sop-t"><thead><tr><th>Parameter</th><th>Specification</th><th>Optimal</th><th>Current</th><th>Status</th></tr></thead><tbody>${params
           .map(it => {
             const L = cpLimits(it),
               S = cpStatus(it);
             return `<tr><td>${esc(it.name)}</td><td class="mono">${cpSpecTxt(L)} ${L.num ? esc(L.unit) : ''}</td><td class="mono">${L.num && L.opt != null ? fmtN(L.opt, L.d) : '—'}</td><td class="mono">${S.v != null ? fmtN(S.v, L.d) : S.r ? (S.r.ok === false ? 'Not OK' : 'OK') : '—'}</td><td>${cpChip(S.st)}</td></tr>`;
           })
           .join('')}</tbody></table>`
       : ''
   }
   <h3>${params.length ? 8 : 7}. Reaction plan</h3><table class="sop-t sop-react"><thead><tr><th>Condition</th><th>Immediate action</th><th>Escalate to</th></tr></thead><tbody>${s.reaction.map(r => `<tr><td><b>${esc(r.cond)}</b></td><td>${esc(r.action)}</td><td>${esc(r.esc || '—')}</td></tr>`).join('') || '<tr><td colspan="3" class="note">—</td></tr>'}</tbody></table>
   <h3>${params.length ? 9 : 8}. References</h3><ul>${s.refs.map(x => `<li>${esc(x)}</li>`).join('') || '<li class="note">—</li>'}</ul>
   <h3>${params.length ? 10 : 9}. Revision history</h3><table class="sop-t"><thead><tr><th>Rev</th><th>Date</th><th>By</th><th>Change</th></tr></thead><tbody>${s.revisions
     .slice()
     .reverse()
     .map(
       r =>
         `<tr><td class="mono">${esc(r.v)}</td><td class="mono">${esc(r.date)}</td><td>${esc(r.by)}</td><td>${esc(r.note)}</td></tr>`,
     )
     .join('')}</tbody></table>
   <h3>Guided runs</h3>${runs.length ? `<table class="sop-t"><thead><tr><th>Completed</th><th>By</th><th>Steps</th><th>Notes</th></tr></thead><tbody>${runs.map(r => `<tr><td class="mono">${new Date(r.end).toLocaleString('en-GB', { hour12: false })}</td><td>${esc(r.by)}</td><td>${r.done}/${r.total}${r.skipped ? ` · <span class="tx2">${r.skipped} skipped</span>` : ''}</td><td>${esc(r.note || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No guided runs yet.</p>'}</div></div>`;
}
/* ---------- guided run ---------- */
function sopRunStart(p) {
  const s = sopUpgrade(p);
  RUN = {
    pid: p.id,
    by: localStorage.getItem('sandman-cp-by') || 'Operator',
    start: Date.now(),
    pre: s.prestart.map(() => false),
    steps: s.steps.map(() => false),
    note: '',
  };
  CPVIEW = 'run';
  cpRender();
}
function sopRunHtml(p) {
  const s = sopUpgrade(p),
    done = RUN.steps.filter(Boolean).length + RUN.pre.filter(Boolean).length,
    total = RUN.steps.length + RUN.pre.length;
  const critOpen = s.steps.some((x, i) => x.crit && !RUN.steps[i]) || RUN.pre.some(v => !v);
  return `<div class="sop-run"><div class="sop-bar"><button class="ib" id="runX">✕ Cancel run</button><div class="sop-run-t"><b>Guided run — ${esc(s.no)} ${esc(p.name)}</b><span class="note">Started ${cpTime(RUN.start)} · ${done}/${total} done</span></div><div class="cp-bar" style="width:180px"><i style="width:${(done / total) * 100}%;background:var(--accent)"></i></div></div>
   <div class="row2"><div class="fld"><label>Operator</label><input id="runBy" value="${esc(RUN.by)}"></div><div class="fld"><label>Note (optional)</label><input id="runNote" value="${esc(RUN.note)}" placeholder="e.g. pattern change to Hub"></div></div>
   <div class="sop-sec">Safety / PPE</div><div class="sop-ppe">${s.ppe.map(x => `<span>${esc(x)}</span>`).join('')}</div>
   ${s.prestart.length ? `<div class="sop-sec">Pre-start checks — all required</div>${s.prestart.map((x, i) => `<label class="run-i ${RUN.pre[i] ? 'on' : ''}"><input type="checkbox" data-rp="${i}" ${RUN.pre[i] ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}` : ''}
   <div class="sop-sec">Procedure</div>${s.steps.map((x, i) => `<label class="run-i step ${RUN.steps[i] ? 'on' : ''} ${x.crit ? 'crit' : ''}"><input type="checkbox" data-rs="${i}" ${RUN.steps[i] ? 'checked' : ''}><span class="run-n">${i + 1}</span><span class="run-b"><span>${esc(x.t)}${x.crit ? ' <span class="cp-crit">critical</span>' : ''}</span>${x.key || x.param ? `<span class="sop-key">${x.key ? `<span>${esc(x.key)}</span>` : ''}${sopLive(p, x.param)}</span>` : ''}</span></label>`).join('')}
   <div class="cp-def-f"><span class="note">${critOpen ? 'All pre-start checks and critical steps must be ticked to complete.' : 'Ready to complete.'}</span><span style="flex:1"></span><button class="ib pri" id="runDone" ${critOpen ? 'disabled' : ''}>✓ Complete &amp; sign off</button></div></div>`;
}
/* ---------- editor ---------- */
function sopEditStart(p) {
  SOPDRAFT = JSON.parse(JSON.stringify(sopUpgrade(p)));
  SOPDRAFT._note = '';
  CPVIEW = 'sopedit';
  cpRender();
}
function sopEditHtml(p) {
  const s = SOPDRAFT,
    opts = sel =>
      `<option value="">— none —</option>${p.items.map(it => `<option value="${it.id}" ${sel && (sel === it.id || sopParam(p, sel) === it) ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}`;
  const f = (k, l, v, w) =>
    `<div class="fld"${w ? ` style="${w}"` : ''}><label>${l}</label><input data-se="${k}" value="${esc(v ?? '')}"></div>`;
  return `<div class="sop-ed"><div class="sop-bar"><button class="ib" id="sedX">Cancel</button><b style="flex:1">Edit SOP — ${esc(p.name)}</b><button class="ib pri" id="sedSave">Save as Rev ${esc(sopBump(s.version))}</button></div>
   <div class="sop-ed-g">${f('no', 'Document no.', s.no)}${f('title', 'Title', s.title, 'grid-column:span 2')}${f('owner', 'Owner', s.owner)}${f('approver', 'Approved by', s.approver)}<div class="fld"><label>Status</label><select data-se="status">${['Draft', 'Approved', 'Obsolete'].map(x => `<option ${s.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="fld"><label>Effective date</label><input type="date" data-se="effective" value="${esc(s.effective)}"></div><div class="fld"><label>Review every (months)</label><input type="number" min="1" data-se="reviewMonths" value="${s.reviewMonths || 12}"></div></div>
   <div class="row2"><div class="fld"><label>Purpose</label><textarea data-se="purpose" style="min-height:60px">${esc(s.purpose)}</textarea></div><div class="fld"><label>Scope</label><textarea data-se="scope" style="min-height:60px">${esc(s.scope)}</textarea></div></div>
   <div class="sop-sec">Procedure steps <button class="sb" data-add="steps">＋ Step</button></div>
   <table class="sop-t sop-et"><thead><tr><th>#</th><th>Step</th><th>Key point / specification</th><th>Linked parameter</th><th>Critical</th><th></th></tr></thead><tbody>${s.steps.map((x, i) => `<tr><td class="mono">${i + 1}</td><td><textarea data-row="steps:${i}:t">${esc(x.t)}</textarea></td><td><input data-row="steps:${i}:key" value="${esc(x.key || '')}"></td><td><select data-row="steps:${i}:param">${opts(x.param)}</select></td><td style="text-align:center"><input type="checkbox" data-row="steps:${i}:crit" ${x.crit ? 'checked' : ''}></td><td class="sop-mv"><button class="cp-ic" data-mv="steps:${i}:-1" title="Move up">↑</button><button class="cp-ic" data-mv="steps:${i}:1" title="Move down">↓</button><button class="cp-ic" data-del="steps:${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>
   <div class="sop-sec">Reaction plan <button class="sb" data-add="reaction">＋ Row</button></div>
   <table class="sop-t sop-et"><thead><tr><th>Condition</th><th>Immediate action</th><th>Escalate to</th><th></th></tr></thead><tbody>${s.reaction.map((r, i) => `<tr><td><input data-row="reaction:${i}:cond" value="${esc(r.cond)}"></td><td><input data-row="reaction:${i}:action" value="${esc(r.action)}"></td><td><input data-row="reaction:${i}:esc" value="${esc(r.esc || '')}"></td><td class="sop-mv"><button class="cp-ic" data-del="reaction:${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>
   <div class="sop-sec">Responsibilities <button class="sb" data-add="roles">＋ Role</button></div>
   <table class="sop-t sop-et"><tbody>${s.roles.map((r, i) => `<tr><td style="width:30%"><input data-row="roles:${i}:role" value="${esc(r.role)}"></td><td><input data-row="roles:${i}:resp" value="${esc(r.resp)}"></td><td class="sop-mv"><button class="cp-ic" data-del="roles:${i}" title="Remove">✕</button></td></tr>`).join('')}</tbody></table>
   <div class="row3"><div class="fld"><label>Safety / PPE (one per line)</label><textarea data-sl="ppe" style="min-height:90px">${esc(s.ppe.join('\n'))}</textarea></div><div class="fld"><label>Pre-start checks (one per line)</label><textarea data-sl="prestart" style="min-height:90px">${esc(s.prestart.join('\n'))}</textarea></div><div class="fld"><label>References (one per line)</label><textarea data-sl="refs" style="min-height:90px">${esc(s.refs.join('\n'))}</textarea></div></div>
   <div class="fld"><label>Reason for change (revision history) *</label><input id="sedNote" value="${esc(s._note)}" placeholder="e.g. Added bucket test step; tightened compactability range"></div></div>`;
}
function sopBump(v) {
  const m = String(v || '1.0').match(/^(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${+m[2] + 1}` : (v || '1') + '.1';
}
function sopEditCollect() {
  const s = SOPDRAFT;
  $$('#mbox [data-se]').forEach(i => {
    s[i.dataset.se] = i.dataset.se === 'reviewMonths' ? Math.max(1, parseInt(i.value) || 12) : i.value;
  });
  $$('#mbox [data-sl]').forEach(i => {
    s[i.dataset.sl] = i.value
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean);
  });
  $$('#mbox [data-row]').forEach(i => {
    const [k, n, f] = i.dataset.row.split(':');
    const o = s[k][+n];
    if (!o) return;
    o[f] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.value || (f === 'param' ? null : '');
  });
  const n = $('#sedNote');
  if (n) s._note = n.value;
}
/* ---------- text export ---------- */
function sopText(p) {
  const s = sopUpgrade(p);
  return [
    `${s.no} — ${s.title}`,
    `Rev ${s.version} · Effective ${s.effective} · Owner ${s.owner} · Approved by ${s.approver} · Status ${sopState(s)}`,
    '',
    `PURPOSE\n${s.purpose}`,
    `SCOPE\n${s.scope}`,
    `RESPONSIBILITIES\n${s.roles.map(r => `- ${r.role}: ${r.resp}`).join('\n')}`,
    `SAFETY / PPE\n${s.ppe.join(', ')}`,
    `PRE-START CHECKS\n${s.prestart.map(x => `[ ] ${x}`).join('\n')}`,
    `PROCEDURE\n${s.steps.map((x, i) => `${i + 1}. ${x.t}${x.key ? ` [${x.key}]` : ''}${x.crit ? ' (CRITICAL)' : ''}`).join('\n')}`,
    `REACTION PLAN\n${s.reaction.map(r => `- ${r.cond} → ${r.action} (escalate: ${r.esc})`).join('\n')}`,
    `REFERENCES\n${s.refs.join('\n')}`,
  ].join('\n\n');
}
/* ---------- binding (called from cpBind) ---------- */
function sopBind(p) {
  if (!p) return;
  const on = (id, fn) => {
    const el = $(id);
    if (el) el.onclick = fn;
  };
  $$('#mbox [data-sopch]').forEach(
    x =>
      (x.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        openTrend(x.dataset.sopch);
      }),
  );
  on('#sopRun', () => sopRunStart(p));
  on('#sopDoc', () => {
    CPVIEW = 'sop';
    cpRender();
  });
  on('#sopBack', () => {
    CPVIEW = 'checks';
    cpRender();
  });
  on('#sopEdit', () => sopEditStart(p));
  on('#sopCopy', () => copyText(sopText(p), 'SOP copied as text'));
  if (CPVIEW === 'run' && RUN) {
    const keep = () => {
      RUN.by = $('#runBy').value;
      RUN.note = $('#runNote').value;
    };
    $$('#mbox [data-rp]').forEach(
      c =>
        (c.onchange = () => {
          keep();
          RUN.pre[+c.dataset.rp] = c.checked;
          cpRender();
        }),
    );
    $$('#mbox [data-rs]').forEach(
      c =>
        (c.onchange = () => {
          keep();
          RUN.steps[+c.dataset.rs] = c.checked;
          cpRender();
        }),
    );
    on('#runX', () => {
      RUN = null;
      CPVIEW = 'checks';
      cpRender();
    });
    on('#runDone', () => {
      keep();
      const s = p.sop,
        total = RUN.steps.length + RUN.pre.length,
        done = RUN.steps.filter(Boolean).length + RUN.pre.filter(Boolean).length;
      (SOPRUNS[p.id] = SOPRUNS[p.id] || []).push({
        sop: s.no,
        rev: s.version,
        by: RUN.by.trim() || 'Operator',
        start: RUN.start,
        end: Date.now(),
        done,
        total,
        skipped: total - done,
        note: RUN.note.trim(),
      });
      SOPRUNS[p.id] = SOPRUNS[p.id].slice(-200);
      sopSaveRuns();
      try {
        localStorage.setItem('sandman-cp-by', RUN.by.trim());
      } catch (e) {}
      logEv(`SOP ${s.no} completed by ${RUN.by} — ${p.name}`);
      RUN = null;
      CPVIEW = 'checks';
      cpRender();
      toast('SOP run signed off');
    });
  }
  if (CPVIEW === 'sopedit' && SOPDRAFT) {
    $$('#mbox [data-add]').forEach(
      b =>
        (b.onclick = () => {
          sopEditCollect();
          const k = b.dataset.add;
          SOPDRAFT[k].push(
            k === 'steps'
              ? { t: '', key: '', crit: 0, param: null }
              : k === 'reaction'
                ? { cond: '', action: '', esc: '' }
                : { role: '', resp: '' },
          );
          cpRender();
        }),
    );
    $$('#mbox [data-del]').forEach(
      b =>
        (b.onclick = () => {
          sopEditCollect();
          const [k, n] = b.dataset.del.split(':');
          SOPDRAFT[k].splice(+n, 1);
          cpRender();
        }),
    );
    $$('#mbox [data-mv]').forEach(
      b =>
        (b.onclick = () => {
          sopEditCollect();
          const [k, n, d] = b.dataset.mv.split(':'),
            i = +n,
            j = i + +d,
            A = SOPDRAFT[k];
          if (j < 0 || j >= A.length) return;
          [A[i], A[j]] = [A[j], A[i]];
          cpRender();
        }),
    );
    on('#sedX', () => {
      SOPDRAFT = null;
      CPVIEW = 'sop';
      cpRender();
    });
    on('#sedSave', () => {
      sopEditCollect();
      if (!SOPDRAFT._note.trim()) {
        toast('Enter the reason for change');
        $('#sedNote').focus();
        return;
      }
      pushUndo();
      const nv = sopBump(p.sop.version),
        s = SOPDRAFT;
      s.steps = s.steps.filter(x => x.t.trim());
      s.reaction = s.reaction.filter(x => x.cond.trim() || x.action.trim());
      s.roles = s.roles.filter(x => x.role.trim());
      s.version = nv;
      s.revisions = (s.revisions || []).concat([
        {
          v: nv,
          date: today(),
          by: localStorage.getItem('sandman-cp-by') || 'Operator',
          note: s._note.trim(),
        },
      ]);
      delete s._note;
      p.sop = s;
      SOPDRAFT = null;
      save();
      logEv(`SOP ${s.no} revised to Rev ${nv} — ${p.name}`);
      CPVIEW = 'sop';
      cpRender();
      toast(`SOP saved as Rev ${nv}`);
    });
  }
}
setTimeout(() => {
  try {
    cpSeed();
    sopAll();
  } catch (e) {}
}, 400);

/* ---------- back navigation inside Process & SOP ---------- */
let MODAL_BACK = null;
function cpBack() {
  if (CPVIEW === 'sopedit') {
    SOPDRAFT = null;
    CPVIEW = 'sop';
  } else if (CPVIEW === 'run') {
    RUN = null;
    CPVIEW = 'checks';
    toast('Guided run cancelled');
  } else {
    DEF = null;
    CPVIEW = 'checks';
  }
  cpRender();
}
const _openModalCP = openModal;
openModal = function (html, wide) {
  const isCP = String(html).includes('id="cpBody"');
  const fromCP = !isCP && $('#cpBody') && $('#modal').classList.contains('on');
  const view = CPVIEW,
    sel = CPSEL;
  _openModalCP(html, wide);
  if (isCP) MODAL_BACK = null;
  else if (fromCP)
    MODAL_BACK = () => {
      CPVIEW = view;
      CPSEL = sel;
      cpRender(true);
    };
};
const _closeModalCP = closeModal;
closeModal = function (force) {
  if (force !== true && $('#modal').classList.contains('on')) {
    if ($('#cpBody') && CPVIEW !== 'checks') {
      cpBack();
      return;
    }
    if (MODAL_BACK && !$('#cpBody')) {
      const f = MODAL_BACK;
      MODAL_BACK = null;
      f();
      return;
    }
  }
  MODAL_BACK = null;
  _closeModalCP();
};
