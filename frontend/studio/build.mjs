// SandMan Process Flowsheet — build script (no dependencies)
// Concatenates src/js/*.js in file-name order into ONE classic script (they share one scope and rely on
// function hoisting across sections), then writes:
//   dist/sandman-flowsheet.html  – single self-contained file (deploy / share / embed)
//   dist/index.html + dist/app.js + dist/app.css – same app as separate assets (easier debugging)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
const SRC = 'src', OUT = 'dist';
function build() {
  const jsFiles = readdirSync(join(SRC, 'js')).filter(f => f.endsWith('.js')).sort();
  const cssFiles = readdirSync(join(SRC, 'css')).filter(f => f.endsWith('.css')).sort();
  const js = "'use strict';\n" + jsFiles.map(f => `/* ---- ${f} ---- */\n` +
    readFileSync(join(SRC, 'js', f), 'utf8').replace(/^\s*'use strict';\s*$/m, '')).join('\n');
  const css = cssFiles.map(f => readFileSync(join(SRC, 'css', f), 'utf8')).join('\n');
  const tpl = readFileSync(join(SRC, 'index.template.html'), 'utf8');
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'sandman-flowsheet.html'),
    tpl.replace('<!-- @@CSS@@ -->', () => `<style>\n${css}\n</style>`).replace('<!-- @@JS@@ -->', () => `<script>\n${js}\n</script>`));
  writeFileSync(join(OUT, 'app.js'), js);
  writeFileSync(join(OUT, 'app.css'), css);
  writeFileSync(join(OUT, 'index.html'),
    tpl.replace('<!-- @@CSS@@ -->', '<link rel="stylesheet" href="app.css">').replace('<!-- @@JS@@ -->', '<script src="app.js"></script>'));
  console.log(`built ${jsFiles.length} JS + ${cssFiles.length} CSS files -> ${OUT}/ (${new Date().toLocaleTimeString()})`);
}
build();
if (process.argv.includes('--watch')) { let t; watch(SRC, { recursive: true }, () => { clearTimeout(t); t = setTimeout(build, 150); }); console.log('watching src/ …'); }
