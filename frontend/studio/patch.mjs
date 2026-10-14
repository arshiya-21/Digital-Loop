/**
 * Re-apply the Digital Loop changes on top of a fresh upstream drop, then build.
 *
 * A new drop of the studio is copied into `src/` wholesale and this puts our
 * changes back. There is only one upstream file to patch now — the page shell
 * — because v6.8 has a real integration seam: `window.SANDMAN_CONTEXT` for the
 * customer and its database, and classic-script globals (`snap`, `restore`,
 * `setMode`, `save`) that our module can call without being spliced into the
 * app. Everything else of ours lives in `../app/sandman/`, which the build
 * never touches.
 *
 *     node patch.mjs          patch the template and build into ../app
 *     node patch.mjs --check  say what is and is not applied, change nothing
 *     node patch.mjs --watch  the same, again on every change under src/
 *
 * There is no dev server. The studio must be served by the backend: the page
 * carries `window.SANDMAN_CONTEXT` — the foundry and its database — written in
 * from the session cookie as the backend serves it, so anything else handing
 * out the same files produces a page with no session and no plant. The loop is
 * therefore: run the backend, leave this watching, and reload the browser.
 *
 * Idempotent: "already applied" is decided on the replacement being present,
 * not on the anchor being gone.
 */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync, watch } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATE = join(HERE, 'src', 'index.template.html')
const APP = join(HERE, '..', 'app')
const check = process.argv.includes('--check')
const keepWatching = process.argv.includes('--watch')

/* --------------------------------------------------------------- the patches ---*/

const PATCHES = [
  {
    name: 'base href, so assets resolve at any path depth',
    anchor: '<meta charset="utf-8">',
    replacement: `<meta charset="utf-8">
<!--
  Every asset below is relative and the studio can be served at a path of any
  depth — SandMan opens it at /sandman/user/digitalloop. Without this,
  "app.js" resolves against that path, the server answers with the shell
  instead, and the page loads as HTML pretending to be a script.
-->
<base href="/">`,
  },
  {
    name: 'our stylesheet, after the studio\'s own',
    anchor: '<!-- @@CSS@@ -->',
    replacement: `<!-- @@CSS@@ -->
<!-- The Digital Loop chrome: lock screen, foundry and line strip, role rules.
     After the studio's own CSS on purpose, so it adds rather than fights. -->
<link rel="stylesheet" href="sandman/sandman.css">`,
  },
  {
    name: 'the lock, painted before anything else',
    anchor: '<body>',
    replacement: `<body class="dl-locked">
<!--
  The lock is painted in the document's first bytes, not from script.

  The editor builds itself as app.js runs, so by the time any module could
  cover it the whole thing has been on screen — the ribbon, the library, and
  whatever the browser kept from last time. An operator must never see an
  editor, so this cover exists before any of that and is taken away only once
  a session has been confirmed. The style is inline because a stylesheet that
  is still downloading cannot hide anything.
-->
<style>
  body.dl-locked > *:not(#dlLocked) { visibility: hidden }
  #dlLocked {
    position: fixed; inset: 0; z-index: 9000; display: flex;
    align-items: center; justify-content: center; background: #0d1b26;
  }
</style>
<div id="dlLocked" class="dl-locked-screen">
  <div class="dl-locked-card">
    <span class="dl-locked-eyebrow">SANDMAN</span>
    <h1>Digital Loop</h1>
    <p id="dlLockedReason">Opening…</p>
    <a class="dl-locked-go" id="dlLockedGo" href="/" hidden>← Back to SandMan</a>
  </div>
</div>`,
  },
  {
    name: 'the integration module, after the editor',
    anchor: '<!-- @@JS@@ -->',
    replacement: `<!-- @@JS@@ -->
<!-- Loaded after the editor, which builds its DOM as it runs. A module, so it
     is deferred by definition and the classic script above has finished. -->
<script type="module" src="sandman/index.mjs"></script>`,
  },
]

/* ------------------------------------------------------------------- apply ---*/

/**
 * Line endings are normalised before anything is compared or written.
 *
 * Upstream ships this file with CRLF; the replacements below are written with
 * LF. Without this the "already applied?" test compares LF text against CRLF
 * text, decides a patch is missing, tries to apply it again, and dies on an
 * anchor that was consumed the first time — so the second run of a script
 * whose whole job is to be re-runnable would fail.
 *
 * Normalising to LF is the fix rather than matching upstream's CRLF, because
 * it gives one answer on every machine. Nobody diffs this file by hand: a new
 * drop replaces `src/` wholesale and this runs again.
 */
const normalise = text => text.replaceAll('\r\n', '\n')

function applyPatches({ quiet } = {}) {
  const original = readFileSync(TEMPLATE, 'utf8')
  let text = normalise(original)
  let changedCount = 0

  for (const patch of PATCHES) {
    if (text.includes(patch.replacement)) {
      if (check) console.log(`  = ${patch.name} (already applied)`)
      continue
    }
    if (!text.includes(patch.anchor)) {
      console.error(`  ! ${patch.name} — anchor not found: ${patch.anchor}`)
      process.exit(1)
    }
    if (check) {
      console.log(`  + ${patch.name} (would apply)`)
      continue
    }
    text = text.replace(patch.anchor, patch.replacement)
    changedCount += 1
    console.log(`  + ${patch.name}`)
  }

  /*
   * Written only when it would actually differ — which, after the first run,
   * it does not.
   *
   * This file lives under `src/`, which `--watch` watches. Writing it
   * unconditionally meant every rebuild triggered the next one: the studio was
   * rebuilt and `app.js` rewritten every three seconds for as long as the
   * watcher ran. The backend caches the gzip of `app.js` by size and
   * modification time, so each request re-compressed five megabytes — and a
   * request that arrived mid-write was answered with half a file, which the
   * browser reported as `SyntaxError: Invalid or unexpected token` and the
   * studio as "started but did not finish".
   *
   * The CRLF normalisation still happens on the first run, which is what it
   * was for; it simply no longer happens again every time afterwards.
   */
  if (!check && text !== original) writeFileSync(TEMPLATE, text, 'utf8')
}

/* ------------------------------------------------------------------- build ---*/

/**
 * Build, then copy into the directory the backend serves.
 *
 * Only the three built files are copied: `sandman/` lives in that same folder
 * and is ours, so replacing the folder would take the integration with it.
 */
function buildAndCopy({ quiet } = {}) {
  execFileSync(process.execPath, [join(HERE, 'build.mjs')], {
    cwd: HERE,
    stdio: quiet ? 'pipe' : 'inherit',
  })

  mkdirSync(APP, { recursive: true })
  for (const file of ['index.html', 'app.js', 'app.css']) {
    const from = join(HERE, 'dist', file)
    if (!existsSync(from)) {
      console.error(`  ! build produced no ${file}`)
      process.exit(1)
    }
    copyFileSync(from, join(APP, file))
  }
}

applyPatches()
if (check) process.exit(0)

/*
 * One line, not eight.
 *
 * This printed four "already applied" patches, the builder's own count and a
 * sentence about where the files went, before every build and every rebuild.
 * All true, none of it news — and it pushed the one line that *is* news off
 * the top of the screen.
 */
buildAndCopy({ quiet: true })
console.log('built → frontend/app')

/* ------------------------------------------------------------------- watch ---*/

if (keepWatching) {
  // Our own integration lives outside `src/` and is served straight from disk,
  // so most work needs nothing watched at all. Said once, and briefly.
  console.log('watching studio/src — reload the browser after a change\n')

  const SRC = join(HERE, 'src')
  let queued

  const rebuild = () => {
    // Editors write a file in several steps; one rebuild after the last of
    // them is what is wanted, not one per write.
    clearTimeout(queued)
    queued = setTimeout(() => {
      try {
        applyPatches({ quiet: true })
        buildAndCopy({ quiet: true })
        console.log(`  rebuilt → ../app  (${new Date().toLocaleTimeString()})`)
      } catch (error) {
        // A syntax error in the studio's source should not end the watch —
        // the next save is usually the fix.
        console.error(`  build failed: ${error.message.split('\n')[0]}`)
      }
    }, 150)
  }

  /*
   * Watch `src/`, and notice when the directory itself is replaced.
   *
   * `fs.watch` follows the directory it was given, not the path. Taking a new
   * drop means deleting `src/` and putting another one there — and from that
   * moment the watch is attached to something that no longer exists. It stops
   * firing, silently: `npm run dev` goes on running, says nothing, and every
   * later edit is simply never built. That is worse than crashing, because the
   * browser keeps showing the previous build and the obvious conclusion is
   * that the change did not work.
   *
   * So the watch is re-established whenever it errors, and a cheap check
   * confirms it is still looking at the directory that is there now.
   */
  let watcher = null
  let watchingSince = 0

  const attach = () => {
    try {
      watcher?.close()
    } catch { /* already gone */ }

    if (!existsSync(SRC)) return false
    watcher = watch(SRC, { recursive: true }, rebuild)
    watcher.on('error', () => { watcher = null })
    watchingSince = statSync(SRC).ctimeMs
    return true
  }

  if (!attach()) {
    console.error(`  ! ${SRC} does not exist — nothing to watch.`)
    process.exit(1)
  }

  /*
   * The directory's creation time is what says it was replaced rather than
   * written into. Checked on a slow timer: this costs one `stat` every few
   * seconds and is what makes taking a drop not require remembering to
   * restart the watcher.
   */
  setInterval(() => {
    let current
    try {
      current = statSync(SRC).ctimeMs
    } catch {
      return // Mid-swap: the directory is gone for a moment. Try again later.
    }
    if (watcher && current === watchingSince) return

    if (attach()) {
      console.log(`  src/ was replaced — watching the new one (${new Date().toLocaleTimeString()})`)
      rebuild()
    }
  }, 3000).unref?.()
}
