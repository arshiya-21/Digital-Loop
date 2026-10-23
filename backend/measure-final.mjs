import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env', 'utf8')
  .split(/\r?\n/).filter(l => /^\w+=/.test(l))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v

const mysql = (await import('mysql2/promise')).default
const { seal } = await import('./src/services/secrets.js')
const { recentValues } = await import('./src/services/db-connect.js')

const cfg = {
  host: env.DL_DB_HOST || '127.0.0.1', port: Number(env.DL_DB_PORT || 3306),
  user: env.DL_DB_USER, password: env.DL_DB_PASSWORD, database: env.DL_DB_NAME || 'digital_loop',
}
const c = await mysql.createConnection(cfg)
const T = 'aaa_final'

await c.query(`DROP TABLE IF EXISTS ${T}`)
await c.query(`CREATE TABLE ${T} (
  pkey INT AUTO_INCREMENT PRIMARY KEY, reading DOUBLE,
  \`date\` DATE, \`time\` TIME, INDEX idx_date (\`date\`))`)
await c.query('SET @i := 0')
await c.query(`INSERT INTO ${T} (reading, \`date\`, \`time\`)
  SELECT 3 + RAND(), DATE(DATE_SUB(NOW(), INTERVAL (@i := @i + 1) MINUTE)),
         TIME(DATE_SUB(NOW(), INTERVAL @i MINUTE))
  FROM information_schema.columns a, information_schema.columns b LIMIT 200000`)

const row = {
  id: 'final', engine: 'mysql', host: cfg.host, port: cfg.port,
  username: cfg.user, password: seal(cfg.password),
  database_name: cfg.database, tunnel_host: null, label: 'final',
}
const tag = { id: 'R', table: T, column: 'reading' }

const at0 = Date.now()
const first = await recentValues(row, tag, 200, 7200)
console.log(`cold : ${Date.now() - at0} ms, ${first.length} points`)

const taken = []
for (let i = 0; i < 7; i++) {
  const at = Date.now()
  await recentValues(row, tag, 200, 7200)
  taken.push(Date.now() - at)
}
taken.sort((a, b) => a - b)
console.log(`warm : median ${taken[3]} ms  (${taken.join(', ')})`)
console.log('\n' + first.statement)

await c.query(`DROP TABLE IF EXISTS ${T}`)
await c.end()
process.exit(0)
