// Builds what the desktop app ships into app/: the client (Vite → app/dist) and the server bundled with esbuild
// (app/server/index.js + engineworker.js). npm packages stay external: electron-builder installs them from this
// folder's package.json, so the client's build-only dependencies never end up in the installer.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, '..'), app = join(here, 'app');
rmSync(app, { recursive: true, force: true });

execSync('npm run build', { cwd: root, stdio: 'inherit' });   // tsc --noEmit + vite build → ../dist
cpSync(join(root, 'dist'), join(app, 'dist'), { recursive: true });

const r = await build({
  entryPoints: { index: join(here, 'server-entry.ts'), engineworker: join(root, 'server', 'engineworker.ts') },
  outdir: join(app, 'server'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
  packages: 'external', metafile: true, logLevel: 'warning',
  // Bundled CJS-style code may still call require(); ESM output has none, so give it one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
const ext = new Set(Object.values(r.metafile.outputs).flatMap(o => o.imports.filter(i => i.external && !i.path.startsWith('node:')).map(i => i.path)));
console.log('server bundle: external packages', [...ext].join(', '));

// Window placement maths shared with the web client (src/winplace.ts), for the pop-out windows in main.cjs.
await build({ entryPoints: [join(root, 'src', 'winplace.ts')], outfile: join(app, 'placement.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', logLevel: 'warning' });

mkdirSync(join(here, 'build'), { recursive: true });
cpSync(join(root, 'public', 'icon-512.png'), join(here, 'build', 'icon.png'));
