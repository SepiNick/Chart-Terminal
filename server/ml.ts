// Machine-learning helpers without a language model: runs ml/engine.py (numpy, pandas, scikit-learn) with one JSON request
// on stdin. Set CT_PYTHON to choose the interpreter; otherwise python3, python and (Windows) the py launcher are tried.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, bad, route } from './core/http.ts';

export const ENGINE = join(dirname(fileURLToPath(import.meta.url)), '..', 'ml', 'engine.py');
export const TASKS = ['regime', 'patterns', 'journal'];
const candidates = () => process.env.CT_PYTHON ? [[process.env.CT_PYTHON]] : process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];

function runOne(cmd: string[], input: string) {
  return new Promise<string>((res, rej) => {
    const p = execFile(cmd[0], [...cmd.slice(1), ENGINE], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024, windowsHide: true }, (err, out, errOut) => err ? rej(Object.assign(err, { stderr: errOut })) : res(out));
    p.stdin?.end(input);
  });
}
export async function run(task: string, body: Record<string, unknown>) {
  if (!TASKS.includes(task)) throw bad('Unknown ML task');
  const input = JSON.stringify({ ...body, task });
  let last: (Error & { code?: string; stderr?: string }) | null = null;
  for (const cmd of candidates()) {
    try {
      const out = JSON.parse(await runOne(cmd, input)) as { error?: string };
      if (out.error) throw bad(out.error);
      return out;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      last = e as typeof last;
      if ((e as { code?: string }).code !== 'ENOENT' && !/No module named/.test(last?.stderr ?? '')) break;   // a missing interpreter: try the next one
    }
  }
  if (/No module named/.test(last?.stderr ?? '')) throw new HttpError(501, 'Python is missing a library: run  pip install -r ml/requirements.txt');
  if (last?.code === 'ENOENT') throw new HttpError(501, 'Python 3 was not found: install it from python.org, then  pip install -r ml/requirements.txt  (or set CT_PYTHON)');
  throw new HttpError(500, `ML engine failed: ${(last?.stderr || last?.message || '').trim().split('\n').pop()}`);
}
route('POST', '/api/ml/:task', c => run(c.params.task, (c.body ?? {}) as Record<string, unknown>), { limit: 20 * 1024 * 1024 });
