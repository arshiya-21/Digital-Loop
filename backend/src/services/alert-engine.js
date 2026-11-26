import vm from 'node:vm'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from '../config/index.js'

/**
 * The studio's own formula and alert code, run on the server.
 *
 * Calculated fields (ƒx) and engineered alerts — formulas, AVG / SD / RATE over
 * time, Nelson rules, drift, forecast, "must last", the Limits basis — are
 * worked out by code in the studio (27l, 27n, 27g, 27u, 27zb). The server-side
 * checker must reach the same answer as the screen, so it does not re-write
 * that code: it loads the same functions, unchanged, into an isolated
 * `vm` context per loop and gives them only the data they read
 * (REG, DOC, VAL, val, B …). Nothing in it can reach the network, the file
 * system or this process; it is arithmetic over the readings.
 *
 * Which parts are loaded is decided by markers in the source, so a studio
 * update that moves code around still loads whole functions — and a missing
 * marker stops the checker with a clear message instead of a wrong answer.
 */

const JS = resolve(config.paths.root, 'frontend', 'studio', 'src', 'js')

function slice(file, from, to) {
  const path = resolve(JS, file)
  if (!existsSync(path)) throw new Error(`alert engine: ${file} not found`)
  const src = readFileSync(path, 'utf8').replace(/\r/g, '')
  const a = src.indexOf(from)
  if (a < 0) throw new Error(`alert engine: "${from}" not found in ${file}`)
  const b = to ? src.indexOf(to, a) : src.length
  if (b < 0) throw new Error(`alert engine: "${to}" not found in ${file}`)
  return src.slice(a, b)
}

let CODE = null
let CODE_ERROR = null
function code() {
  if (CODE || CODE_ERROR) return CODE
  try {
    CODE = [
      // 27l — the A–D formula parser used by engineered-alert calculations
      slice('27l-anim-data.js', 'const AD_FN', '/* ---------- reading the value'),
      // 27n — calculated fields: lexer, parser, resolver, evaluation, auto LL / HH
      slice('27n-calc-tags.js', 'const CT_FUNCS', '/* ---------- registering calculated tags'),
      slice('27n-calc-tags.js', 'function ctDoc()', 'function ctRegister('),
      slice('27n-calc-tags.js', 'function ctAutoCrit('),
      // 27g — engineered alerts: variables, calculation, the condition test
      slice('27g-eng-alerts.js', 'const ENG_VARS', '\n'),
      slice('27g-eng-alerts.js', 'const ENG_ST = {}', 'function engFmt('),
      // 27u — statistics: Nelson, EWMA drift, forecast, joint rules
      slice('27u-eng-stat-rules.js', 'const ENG_STAT', '/* readable condition text'),
      // 27zb — "Alert on": Limits / Nelson / Drift / Forecast / Stuck / Conditions
      slice('27zb-eng-basis.js', 'const EB = [', '/* severity of a Limits alert'),
    ].join('\n;\n')
    new vm.Script(CODE) // syntax check once
  } catch (error) {
    CODE = null
    CODE_ERROR = error
    console.error(`   !  alert engine not available: ${error.message}`)
  }
  return CODE
}
export const engineError = () => (code(), CODE_ERROR)

const isText = t => !!t && ((t.txt != null && t.txt !== '') || !!t.states)
const STOPPED = /^(0|false|off|stop|stopped|idle|fault|trip|tripped|not running|down)$/i

/**
 * One loop's evaluation context. Built once per published version; values are
 * poured in every check, and the statistics buffers persist between checks the
 * way they do in an open screen.
 */
export class LoopEngine {
  constructor(layout) {
    const src = code()
    if (!src) throw CODE_ERROR || new Error('alert engine not available')
    const DOC = structuredClone(layout.DOC || {})
    const REG = structuredClone(layout.REG || {})
    DOC.blocks = Array.isArray(DOC.blocks) ? DOC.blocks : []
    DOC.blocks.forEach(b => { b.props = b.props || {}; b.tags = b.tags || [] })
    DOC.eng = DOC.eng || {}
    DOC.eng.rules = Array.isArray(DOC.eng.rules) ? DOC.eng.rules : []
    const VAL = {}
    const byId = new Map(DOC.blocks.map(b => [b.id, b]))
    const val = id => {
      const V = VAL[id]
      return V && V.v != null && Number.isFinite(V.v) ? V.v : null
    }
    /* "Only while running": out of service, or a running / status reading that says stopped. */
    const running = b => {
      if (!b || b.props.oos) return false
      for (const bt of b.tags) {
        const t = REG[bt.id]
        if (!t) continue
        const isRunTag = t.role === 'running' || /RUN|STATUS|STATE/i.test(bt.id)
        if (!isRunTag) continue
        const V = VAL[bt.id]
        if (!V) continue
        if (V.t != null && STOPPED.test(String(V.t).trim())) return false
        if (t.role === 'running' && V.v === 0) return false
      }
      return true
    }
    this.sandbox = {
      DOC, REG, VAL, val,
      B: id => byId.get(id) || null,
      effRun: running,
      isRun: running,
      tagIsText: isText,
      fmtN: (n, d) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toFixed(d == null ? 1 : d)),
      mkTag: id => (REG[id] = REG[id] || { id }),
      ensureVal: id => (VAL[id] = VAL[id] || { v: null, h: [] }),
      engVarName: (r, k) => (r.vars && REG[r.vars[k]] && (REG[r.vars[k]].short || REG[r.vars[k]].desc)) || k,
      console: { log() {}, warn() {}, error() {} },
    }
    vm.createContext(this.sandbox, { codeGeneration: { strings: false, wasm: false } })
    vm.runInContext(src, this.sandbox, { timeout: 10_000 }) // a safety net against a runaway formula; loading takes milliseconds
    this.DOC = DOC
    this.REG = REG
    this.VAL = VAL
    this.running = running
  }

  /** New readings: `{ id: { value, recordedAt } }`. Text readings are kept as text (status tags). */
  update(values, at = Date.now()) {
    for (const [id, r] of Object.entries(values || {})) {
      if (!r || r.value === null || r.value === undefined) continue
      const V = (this.VAL[id] = this.VAL[id] || { v: null, h: [] })
      const n = typeof r.value === 'number' ? r.value : Number(r.value)
      const numeric = Number.isFinite(n) && String(r.value).trim() !== ''
      V.v = numeric ? n : null
      V.t = numeric ? null : String(r.value)
      V.ts = at
      if (numeric) {
        V.h.push({ t: at, v: n })
        while (V.h.length && at - V.h[0].t > 8 * 3600 * 1000) V.h.shift()
      }
    }
  }

  /** Work out every calculated field (ƒx), as the studio's ctTick does. */
  calcs(at = Date.now()) {
    const run = this.sandbox
    const C = Array.isArray(this.DOC.calc) ? this.DOC.calc : []
    for (const c of C) {
      for (const I of run.ctInstances(c)) {
        let v = null
        try {
          v = vm.runInContext('ctRun(__c, __b, __k).v', Object.assign(run, { __c: c, __b: I.b, __k: I.id }), { timeout: 2000 })
        } catch {
          v = null
        }
        const V = (this.VAL[I.id] = this.VAL[I.id] || { v: null, h: [] })
        V.v = v
        V.ts = at
        if (v != null && Number.isFinite(v)) {
          V.h.push({ t: at, v })
          while (V.h.length && at - V.h[0].t > 8 * 3600 * 1000) V.h.shift()
        }
        // its limits, as the studio registers them (auto LL / HH when left empty)
        const t = (this.REG[I.id] = this.REG[I.id] || { id: I.id })
        const auto = run.ctAutoCrit(c)
        const num = x => (x != null && x !== '' && Number.isFinite(+x) ? +x : null)
        Object.assign(t, {
          short: t.short || 'ƒx ' + c.name, desc: t.desc || c.name, unit: c.unit || t.unit || '', calc: c.id,
          lo: num(c.lo), hi: num(c.hi), ll: num(c.ll) ?? auto.ll, hh: num(c.hh) ?? auto.hh,
          host: I.b ? I.b.id : (c.equip && c.equip[0]) || null,
        })
      }
    }
  }

  /** An engineered alert now: `{ ok, sev, V, running }` — the studio's engEval, with the Limits severity. */
  engineered(rule) {
    try {
      const run = Object.assign(this.sandbox, { __r: rule })
      const ev = vm.runInContext('engEval(__r)', run, { timeout: 2000 })
      return { ok: !!ev.ok, V: ev.V || {}, running: ev.running, sev: (ev.ok && rule._sevNow) || rule.sev || 2 }
    } catch (error) {
      return { ok: false, V: {}, error: error.message }
    }
  }

  value(id) {
    return this.sandbox.val(id)
  }
}
