import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { sample, missingTags, layoutTags } from '@sandman/layout-core'
import { config, assertDatabase } from '../backend/src/config/index.js'
import { init, close, uid, now, transaction } from '../backend/src/config/db.js'

const SAND_LOOP_NAME = 'Digital Sand Loop'

/**
 * Seed the database so the API is usable immediately.
 *
 * Two things only: the 43 bundled equipment SVGs, and one published sand loop
 * to open on.
 *
 * There are no foundries, lines or accounts to seed. SandMan owns all three and
 * sends them with each launch, so the only thing this file has to agree with
 * SandMan about is the identifiers the demo loop is filed under — which is what
 * `DEMO_PLANT` below is for. Point it at whatever SandMan actually sends and the
 * seeded loop will be the one that opens.
 *
 * Safe to re-run: every insert is keyed on a natural id and skipped if present.
 * Run with `npm run api:seed`.
 *
 * Every function here takes the transaction's `tx` rather than reaching for the
 * module-level `db`: on MySQL a transaction holds one connection out of the
 * pool, and a query made on the pool while it is open is a different connection
 * and therefore outside the transaction — it would commit on its own and
 * survive a rollback.
 *
 * `npm run api:reset` adds --reset, which DELETES every design, version, tag
 * and audit row first. The studio test suites need it, because they create
 * designs and leave them behind; without it a second run sees the first run's
 * loops. It is destructive and never the default.
 */

const RESET = process.argv.includes('--reset')

/**
 * Clear everything the suites create, and nothing else.
 *
 * `asset` stays: re-importing 43 SVGs on every reset would be slow for no gain,
 * and the catalogue is not what a suite dirties.
 */
async function resetData(tx) {
  // Children first: design_tag references design_version, which references
  // design. InnoDB enforces that; SQLite was not asked to.
  for (const table of ['audit_log', 'design_tag', 'design_version', 'design']) {
    await tx.prepare(`DELETE FROM ${table}`).run()
  }
  console.log('Reset: designs, versions, tags and audit history cleared.')
}

const PUBLIC_EQUIPMENT = config.paths.seedEquipment
const UPLOAD_DIR = config.paths.uploads

/**
 * Where the demo loop is filed.
 *
 * These are SandMan's identifiers, not this database's — there is nothing here
 * for them to point at. They must match what SandMan sends in its launch, or
 * the seeded loop belongs to a line nobody arrives on.
 */
const DEMO_PLANT = {
  foundryId: process.env.SEED_FOUNDRY_ID || 'FND-MUNJAL-KIRU',
  foundryName: process.env.SEED_FOUNDRY_NAME || 'Munjal Kiru',
  lineId: process.env.SEED_LINE_ID || 'LINE-1',
  lineName: process.env.SEED_LINE_NAME || 'Line 1',
}

/** The account the seeded rows are attributed to — a SandMan username. */
const SEED_AUTHOR = process.env.SEED_AUTHOR || 'admin@mpminfosoft'

/**
 * Import the bundled equipment SVGs as catalogue assets.
 *
 * These are marked `builtin` so an operator can tell shipped artwork from
 * artwork their own team uploaded. They are otherwise ordinary rows: an admin
 * can rename or replace them through the assets API.
 */
async function seedAssets(tx, author) {
  const catalogue = JSON.parse(readFileSync(resolve(PUBLIC_EQUIPMENT, 'catalogue.json'), 'utf8'))
  mkdirSync(UPLOAD_DIR, { recursive: true })

  let imported = 0
  for (const entry of catalogue) {
    if (await tx.prepare('SELECT 1 FROM asset WHERE slug = ?').get(entry.id)) continue

    const source = resolve(PUBLIC_EQUIPMENT, `${entry.id}.svg`)
    if (!existsSync(source)) {
      console.warn(`  skipped ${entry.id}: no SVG file`)
      continue
    }

    const svg = readFileSync(source, 'utf8')
    const id = uid('ast')
    writeFileSync(resolve(UPLOAD_DIR, `${id}.svg`), svg, 'utf8')
    await tx.prepare(
      `INSERT INTO asset (id, slug, name, category, width, height, bytes, revision, builtin,
                          uploaded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    ).run(
      id, entry.id, entry.name, entry.category,
      entry.w, entry.h, Buffer.byteLength(svg, 'utf8'), author, now(), now()
    )
    imported++
  }
  return imported
}

/**
 * Retire catalogue entries whose artwork no longer ships.
 *
 * A new drop of the studio can drop equipment as well as add it, and an asset
 * row with no SVG behind it is worse than no row: the studio offers it, a
 * design uses it, and the canvas renders a hole.
 *
 * Only `builtin` rows are considered — artwork a team uploaded themselves is
 * theirs, not ours to tidy — and only ones no design references. Anything
 * still in use is reported and left alone, because breaking a saved plant
 * drawing is never the right way to clean up a catalogue.
 */
async function retireMissingAssets(tx, shipped) {
  const gone = (await tx.prepare('SELECT id, slug FROM asset WHERE builtin = 1').all())
    .filter(row => !shipped.has(row.slug))
  if (!gone.length) return { removed: 0, kept: [] }

  const used = new Set()
  for (const row of await tx.prepare('SELECT layout FROM design_version').all()) {
    for (const node of JSON.parse(row.layout).nodes || []) used.add(node.type)
  }

  const removable = gone.filter(row => !used.has(row.slug))
  for (const row of removable) await tx.prepare('DELETE FROM asset WHERE id = ?').run(row.id)

  return {
    removed: removable.length,
    kept: gone.filter(row => used.has(row.slug)).map(row => row.slug),
  }
}

/**
 * A real digital sand loop, saved and published on the demo line.
 *
 * Without this a fresh install opens on an empty canvas, which demonstrates
 * nothing. The layout is `sample()` from layout-core — the same one the studio
 * offers — so the seeded loop and the in-studio sample cannot drift apart.
 *
 * Publishing is all it takes for the plant to see it: there is no allocation
 * step.
 */
async function seedSandLoop(tx, author) {
  // A line has one design, so anything already here is the one.
  const existing = await tx
    .prepare('SELECT * FROM design WHERE foundry_id = ? AND line_id = ?')
    .get(DEMO_PLANT.foundryId, DEMO_PLANT.lineId)
  if (existing) return existing

  const layout = { ...sample(), name: SAND_LOOP_NAME }
  const untagged = missingTags(layout.nodes)
  if (untagged.length) {
    // Publishing would be refused, and a seed that half-works is worse than
    // one that says why it did not.
    console.warn(`  skipped the demo loop: ${untagged.length} item(s) have no data tag`)
    return null
  }

  const loopId = uid('dsg')
  const versionId = uid('ver')

  // Draft first, then the version, then point at it: `published_version_id`
  // references a row that does not exist until the second statement runs.
  await tx.prepare(
    `INSERT INTO design (id, foundry_id, foundry_name, line_id, line_name,
                         name, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    loopId, DEMO_PLANT.foundryId, DEMO_PLANT.foundryName,
    DEMO_PLANT.lineId, DEMO_PLANT.lineName, SAND_LOOP_NAME, author, now(), now()
  )

  await tx.prepare(
    `INSERT INTO design_version (id, design_id, version, layout, note, created_by, created_at)
     VALUES (?, ?, 1, ?, ?, ?, ?)`
  ).run(versionId, loopId, JSON.stringify(layout), 'Seeded sand loop', author, now())

  await tx.prepare("UPDATE design SET status = 'published', published_version_id = ? WHERE id = ?")
    .run(versionId, loopId)

  for (const [nodeId, dataTag] of layoutTags(layout)) {
    await tx.prepare('INSERT INTO design_tag (version_id, node_id, data_tag) VALUES (?, ?, ?)')
      .run(versionId, nodeId, dataTag)
  }

  return await tx.prepare('SELECT * FROM design WHERE id = ?').get(loopId)
}

/*
 * Connect before seeding.
 *
 * MySQL's driver is asynchronous, so there is no querying until `init()` has
 * resolved — it is also what creates the database and applies the schema, so a
 * seed against a server with nothing on it works the same as one against a
 * server that already has the tables.
 */
try {
  assertDatabase()
  await init()
} catch (error) {
  console.error(`\nSeed failed before it started.\n\n  ${error.message}\n`)
  process.exit(1)
}

await transaction(async tx => {
  if (RESET) await resetData(tx)

  const imported = await seedAssets(tx, SEED_AUTHOR)

  // The bundled catalogue is the list of what ships; anything else that claims
  // to be builtin is left over from an older drop.
  const shipped = new Set(
    JSON.parse(readFileSync(resolve(PUBLIC_EQUIPMENT, 'catalogue.json'), 'utf8')).map(e => e.id)
  )
  const retired = await retireMissingAssets(tx, shipped)

  // The point of a seed: opening the studio shows a real sand loop, not a
  // blank canvas with instructions on it.
  const demo = await seedSandLoop(tx, SEED_AUTHOR)

  const total = (await tx.prepare('SELECT COUNT(*) AS n FROM asset').get()).n

  console.log('Seed complete.')
  console.log(`  plant     ${DEMO_PLANT.foundryName} (${DEMO_PLANT.foundryId})`)
  console.log(`            ${DEMO_PLANT.lineName.padEnd(22)} ${DEMO_PLANT.lineId}`)
  console.log(`  assets    ${imported} imported, ${retired.removed} retired, ${total} total`)
  if (retired.kept.length) {
    console.log(`            kept ${retired.kept.length} without artwork, still used by a design:`)
    console.log(`            ${retired.kept.join(', ')}`)
  }
  if (demo) {
    const row = await tx
      .prepare('SELECT layout FROM design_version WHERE id = ?')
      .get(demo.published_version_id)
    console.log(`  loop      ${demo.name} — ${JSON.parse(row.layout).nodes.length} items, published`)
  }
  console.log('')
  console.log('There are no accounts to seed: SandMan sends who you are with the launch.')
})

// The pool keeps the process alive otherwise.
await close()
