// npm run build:android [debug|release]  ->  builds dist/, bundles it into the app (assets/www, for the local mode) and assembles the single APK.
// Needs JDK 17 (JAVA_HOME) and the SDK (android/local.properties). Output: android/app/build/outputs/apk/<type>/Chart-Terminal-<version>-android[-debug].apk
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)), win = process.platform === 'win32';
const type = process.argv[2] === 'debug' ? 'Debug' : 'Release';
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win }); if (r.status !== 0) process.exit(r.status ?? 1) };
run('npm', ['run', 'build'], root);
run(win ? 'gradlew.bat' : './gradlew', [`assemble${type}`], root + 'android');
