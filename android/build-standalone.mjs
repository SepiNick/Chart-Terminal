// npm run build:android-standalone [debug|release]  ->  builds dist/, copies it into the standalone flavor and assembles the APK.
// Needs JDK 17 (JAVA_HOME) and the SDK (android/local.properties). Output: android/app/build/outputs/apk/standalone/<type>/app-standalone-<type>.apk
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)), win = process.platform === 'win32';
const type = process.argv[2] === 'debug' ? 'Debug' : 'Release';
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: win }); if (r.status !== 0) process.exit(r.status ?? 1) };
run('npm', ['run', 'build'], root);
run(win ? 'gradlew.bat' : './gradlew', [`assembleStandalone${type}`], root + 'android');
