/*! SandMan Digital Loop Studio — 00b-customer.js
 *  v4.9 — Customer context (multi-customer Sandman platform).
 *
 *  Three separate layers:
 *    Customer context  → who is logged in and the customer's DEFAULT database. Comes from the Sandman login,
 *                        read-only in the Studio, never stored inside a flowsheet.
 *    Data sources      → ADDITIONAL connections (DOC.sources), managed in Data › Data sources.
 *    Equipment config  → readings link to a source + table + column. Links to the default database store the
 *                        source id "customer" (not a server or database name), so the same loop opened by another
 *                        customer automatically uses THAT customer's default database.
 *
 *  How the Sandman host provides the context (first match wins):
 *    1. window.SANDMAN_CONTEXT = { customer: { id, name }, defaultDb: { type, host, db, name, schema? }, user? }
 *       set by the Sandman page before this app loads (recommended);
 *    2. a message from the parent window (the Studio embedded in Sandman):
 *       parent.postMessage({ type: 'sandman:context', customer: {...}, defaultDb: {...} }, studioOrigin)
 *       or the JavaScript API: SandmanStudio.setCustomerContext({...});
 *    3. URL parameters ?customer=<id>&customerName=…&db=…&dbType=…&dbHost=… (testing / links);
 *    4. otherwise the preview's demo customer.
 *  Each customer's flowsheets and saved loops are kept apart in browser storage (namespaced by customer id). */

const CUSTOMER_DEMO = {
  id: 'demo',
  name: 'Demo Foundry',
  via: 'preview (no Sandman login)',
  defaultDb: { name: 'Customer default database', type: 'mssql', host: 'sql-customer.sandman.cloud', db: 'DemoFoundry_Sandman' },
};
function normaliseCustomer(c, via) {
  if (!c || typeof c !== 'object') return null;
  const cu = c.customer || c;
  const id = String(cu.id || cu.code || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return null; // malformed ids are rejected, never "cleaned" into another customer
  const d = c.defaultDb || c.database || {};
  const db = String(d.db || d.database || `${id}_Sandman`).replace(/[^A-Za-z0-9_.-]/g, '');
  return {
    id,
    name: String(cu.name || id).slice(0, 60),
    user: c.user ? String(c.user.name || c.user).slice(0, 60) : '',
    via,
    defaultDb: {
      name: String(d.name || 'Customer default database').slice(0, 60),
      type: ['mssql', 'postgres', 'mysql', 'oracle', 'influx', 'historian'].includes(d.type) ? d.type : 'mssql',
      host: String(d.host || `sql-${id.toLowerCase()}.sandman.cloud`).slice(0, 120),
      db,
      schema: Array.isArray(d.schema) ? d.schema : null, // optional table list supplied by Sandman
    },
  };
}
function readCustomerContext() {
  try {
    const w = normaliseCustomer(window.SANDMAN_CONTEXT, 'Sandman login');
    if (w) return w;
  } catch (e) {}
  try {
    const s = sessionStorage.getItem('sandman-ctx');
    const c = s && normaliseCustomer(JSON.parse(s), 'Sandman login');
    if (c) return c;
  } catch (e) {}
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('customer'))
      return normaliseCustomer(
        { customer: { id: q.get('customer'), name: q.get('customerName') || q.get('customer') }, defaultDb: { db: q.get('db') || undefined, type: q.get('dbType') || undefined, host: q.get('dbHost') || undefined } },
        'link parameters',
      );
  } catch (e) {}
  return JSON.parse(JSON.stringify(CUSTOMER_DEMO));
}
let CUSTOMER = readCustomerContext();
// storage namespace: the demo customer keeps the original keys, every real customer gets its own
const CUSTOMER_NS = CUSTOMER.id === 'demo' ? '' : ':' + CUSTOMER.id;

/* the default database as a read-only, virtual data source (id "customer") */
function customerSource() {
  const d = CUSTOMER.defaultDb;
  return { id: 'customer', name: `${d.name} (${CUSTOMER.name})`, type: d.type, host: d.host, port: 0, db: d.db, user: '', poll: 5, timeout: 5, virtual: true, customer: true };
}

/* a new context from the Sandman host: same customer → update details; another customer → reopen in its space */
function setCustomerContext(ctx) {
  const c = normaliseCustomer(ctx, 'Sandman login');
  if (!c) return false;
  try {
    sessionStorage.setItem('sandman-ctx', JSON.stringify({ customer: { id: c.id, name: c.name }, user: c.user, defaultDb: c.defaultDb }));
  } catch (e) {}
  if (c.id !== CUSTOMER.id) {
    try {
      if (typeof save === 'function') save(); // keep the current customer's work
    } catch (e) {}
    location.reload();
    return true;
  }
  CUSTOMER = c;
  try {
    renderCustomerChip();
    if (typeof renderProps === 'function') renderProps();
  } catch (e) {}
  return true;
}
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || d.type !== 'sandman:context') return;
  // only the embedding Sandman window (or this window, for the API) may set the customer
  if (e.source !== window.parent && e.source !== window) return;
  setCustomerContext(d);
});
window.SandmanStudio = Object.assign(window.SandmanStudio || {}, {
  setCustomerContext,
  getCustomerContext: () => JSON.parse(JSON.stringify(CUSTOMER)),
  // v9.44 live values + alarm timing (see 02-model.js)
  setTagValue: (id, v, q, ts) => setTagValue(id, v, q, ts),
  setTagValues: list => setTagValues(list),
  releaseLive: id => releaseLive(id),
  alarmConfig: o => Object.assign(ALCFG, o || {}),
  getAlarms: () => Object.values(ALERTS).map(a => ({ key: a.key, sev: a.sev, where: a.where, msg: a.msg, active: a.active, acked: a.acked })),
});

/* header chip + context dialog */
function renderCustomerChip() {
  const el = document.getElementById('custChip');
  if (!el) return;
  el.querySelector('span').textContent = CUSTOMER.name;
  el.title = `Customer: ${CUSTOMER.name} · default database ${CUSTOMER.defaultDb.db} (${CUSTOMER.via})`;
  el.classList.toggle('demo', CUSTOMER.id === 'demo');
}
function customerInfo() {
  const d = CUSTOMER.defaultDb,
    T = { mssql: 'SQL Server', postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', oracle: 'Oracle', influx: 'InfluxDB', historian: 'SandMan Historian' };
  const n = typeof REG !== 'undefined' ? Object.values(REG).filter(t => t.link && t.link.src === 'customer').length : 0;
  openModal(
    `<h3>Customer context</h3>
 <div class="cx-g">
  <div><span>Customer</span><b>${esc(CUSTOMER.name)}</b><small class="mono">${esc(CUSTOMER.id)}</small></div>
  <div><span>Default database</span><b class="mono">${esc(d.db)}</b><small>${esc(T[d.type] || d.type)} · ${esc(d.host)}</small></div>
  <div><span>Provided by</span><b>${esc(CUSTOMER.via)}</b>${CUSTOMER.user ? `<small>${esc(CUSTOMER.user)}</small>` : ''}</div>
  <div><span>Linked readings</span><b>${n}</b><small>use the customer default database</small></div>
 </div>
 <div class="note" style="margin-top:10px">The default database is chosen automatically from your Sandman login and is pre-selected for every equipment. It cannot be changed here. To use another database or an external source, add it in <b>Data › Data sources</b>; it then appears in the Database list of the Equipment panel.</div>
 <div class="note" id="tst_customer_cx" style="margin-top:6px"></div>
 <div class="mact"><button class="ib" id="cxTest">Test connection</button><button class="ib" id="cxSrc">Data sources…</button><button class="ib pri" id="cxOk">Close</button></div>`,
  );
  document.getElementById('cxOk').onclick = closeModal;
  document.getElementById('cxSrc').onclick = () => sourcesForm();
  document.getElementById('cxTest').onclick = () => testSource(customerSource(), document.getElementById('tst_customer_cx'));
}
