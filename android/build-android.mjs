// npm run build:android [debug|release]  ->  builds dist/, bundles it into the app (assets/www, for the local mode) and assembles the single APK.
// Needs JDK 17 (JAVA_HOME) and the SDK (android/local.properties). Output: android/app/build/outputs/apk/<type>/Chart-Terminal-<version>-android[-debug].apk
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url)), win = process.platform === 'win32';
const type = process.argv[2] === 'debug' ? 'Debug' : 'Release';
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win }); if (r.status !== 0) process.exit(r.status ?? 1) };
run('npm', ['run', 'build'], root);
// Browser CCXT is Android-only: staged as dist/ccxt/{lite,full}.js just for the Gradle sync, removed on exit (also on Ctrl+C) so web/desktop dist/ never keeps it.
run('node', ['scripts/build-ccxt-lite.mjs'], root);
const staged = join(root, 'dist', 'ccxt');
process.on('exit', () => rmSync(staged, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(130));
cpSync(join(root, 'dist-ccxt'), staged, { recursive: true });
// absolute, quoted path: a bare 'gradlew.bat' is not found by cmd.exe when spawned through node from Git Bash / PowerShell
const gradlew = join(root, 'android', win ? 'gradlew.bat' : 'gradlew');
run(win ? `"${gradlew}"` : gradlew, [`assemble${type}`], join(root, 'android'));
