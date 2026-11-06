// Builds the portable "lite" folder dist-lite/chart-terminal/ (server bundle, UI, launcher, node.exe on Windows)
// plus dist-lite/chart-terminal-win-x64.zip and dist-lite/chart-terminal-linux.tar.gz.
// Usage: node lite/build.mjs [--reuse-dist]   (--reuse-dist skips `npm run build` and uses the existing dist/)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), out = join(root, 'dist-lite');
const pkg = join(out, 'chart-terminal'), nm = join(root, 'desktop', 'node_modules');
const { build } = createRequire(join(root, 'desktop', 'package.json'))('esbuild');   // desktop already carries esbuild + the server's runtime packages
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Build with Node 24+ (its node.exe is shipped on Windows).');
rmSync(out, { recursive: true, force: true }); mkdirSync(pkg, { recursive: true });

if (!process.argv.includes('--reuse-dist')) execSync('npm run build', { cwd: root, stdio: 'inherit' });
cpSync(join(root, 'dist'), join(pkg, 'dist'), { recursive: true });
cpSync(join(root, 'ml'), join(pkg, 'ml'), { recursive: true, filter: f => !/__pycache__|test_/.test(f) });   // the Python tools (engine.py, pyrun.py): the server bundle finds them at ../ml

const r = await build({
  entryPoints: { index: join(here, 'server-entry.ts'), engineworker: join(root, 'server', 'engineworker.ts') },
  outdir: join(pkg, 'server'), bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true,
  packages: 'external', metafile: true, logLevel: 'warning',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
// External npm packages and their dependency closure, copied from desktop/node_modules (same pins as the Electron build).
const ext = new Set(Object.values(r.metafile.outputs).flatMap(o => o.imports.filter(i => i.external && !i.path.startsWith('node:'))
  .map(i => i.path.startsWith('@') ? i.path.split('/').slice(0, 2).join('/') : i.path.split('/')[0])));
ext.add('ccxt');   // loaded at run time with createRequire(...)('ccxt') (server/ccxtlib.ts), so esbuild cannot see it
const seen = new Set(), todo = [...ext];
while (todo.length) {
  const n = todo.pop(); if (seen.has(n)) continue; seen.add(n);
  const p = join(nm, n, 'package.json'); if (!existsSync(p)) throw new Error(`Missing ${n} in desktop/node_modules (run npm ci there).`);
  todo.push(...Object.keys(JSON.parse(readFileSync(p, 'utf8')).dependencies ?? {}));
}
for (const n of seen) cpSync(join(nm, n), join(pkg, 'node_modules', n), {
  recursive: true, filter: s => !/\.(d\.ts|d\.cts|map)$|ccxt\.browser\.min\.js|[\\/]ccxt[\\/]js$/.test(s) });   // ccxt: only its CJS build (dist/) is used
console.log(`server bundle; packages: ${[...seen].join(', ')}`);

const ver = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'chart-terminal-lite', version: ver, private: true, type: 'module' }, null, 2));
cpSync(join(here, 'launcher.mjs'), join(pkg, 'launcher.mjs'));
cpSync(join(root, 'public', 'icon-512.png'), join(pkg, 'icon.png'));

// Windows wrappers: the .vbs starts the launcher with no console window (Start Menu shortcut), the .cmd is for a terminal.
const vbs = `Set sh = CreateObject("WScript.Shell")\r\nd = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)\r\n` +
  `a = "": For Each x In WScript.Arguments: a = a & " " & x: Next\r\nsh.Run """" & d & "\\node.exe"" """ & d & "\\launcher.mjs""" & a, 0, False\r\n`;
const cmd = `@echo off\r\n"%~dp0node.exe" "%~dp0launcher.mjs" %*\r\n`;
const sh = '#!/bin/sh\nset -eu\nd=$(dirname "$(readlink -f "$0")")\nexec node "$d/launcher.mjs" "$@"\n';

const win = join(out, 'win', 'chart-terminal'), lin = join(out, 'linux', 'chart-terminal');
cpSync(pkg, win, { recursive: true }); cpSync(pkg, lin, { recursive: true });
cpSync(process.execPath, join(win, 'node.exe'));   // pinned: the Node 24 that ran this build
writeFileSync(join(win, 'chart-terminal.vbs'), vbs); writeFileSync(join(win, 'chart-terminal.cmd'), cmd);
for (const f of ['install.ps1', 'uninstall.ps1']) cpSync(join(here, f), join(win, f));
writeFileSync(join(lin, 'chart-terminal'), sh);
for (const f of ['install.sh', 'uninstall.sh']) writeFileSync(join(lin, f), readFileSync(join(here, f), 'utf8').replace(/\r\n/g, '\n'));
// The portable folder is the Windows one (it is what this PC can run); the Linux staging only feeds the tarball.
rmSync(pkg, { recursive: true, force: true }); cpSync(win, pkg, { recursive: true });

const tar = process.platform === 'win32' ? `"${process.env.SystemRoot}/System32/tar.exe"` : 'tar';   // not Git's GNU tar: it has no -a/zip
execSync(`${tar} -a -cf "${join(out, `chart-terminal-win-x64-${ver}.zip`)}" chart-terminal`, { cwd: join(out, 'win'), stdio: 'inherit' });
execSync(`${tar} -czf "${join(out, `chart-terminal-linux-${ver}.tar.gz`)}" chart-terminal`, { cwd: join(out, 'linux'), stdio: 'inherit' });
rmSync(join(out, 'win'), { recursive: true, force: true }); rmSync(join(out, 'linux'), { recursive: true, force: true });
const mb = p => (statSync(p).size / 1048576).toFixed(1) + ' MB';
for (const f of readdirSync(out)) if (/\.(zip|gz)$/.test(f)) console.log(f, mb(join(out, f)));
