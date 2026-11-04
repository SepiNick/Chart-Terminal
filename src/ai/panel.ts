// The 🤖 AI side panel: a chat with the local model (via the server's /api/ai proxy) that always gets the active chart as
// context, plus three quick actions — explain the chart, write a Pine script (checked by the app's Pine engine before
// it is offered), review my journal. Chat history lives in memory only; model, URL and language are remembered.
import type { ChartPane } from '../chart.ts';
import { $, esc, store, toast } from '../store.ts';
import { chartContext, journalContext, SYSTEM, writePine, type JT, type Msg } from './assistant.ts';
import { tfSeconds } from '../data.ts';

export interface AiHost { active(): ChartPane; trades(): JT[]; openPine(src: string): void }
let host: AiHost, busy = false, found = '';   // found: the server the last status check reached (Ollama or LM Studio)
const log: (Msg & { code?: string; note?: string })[] = [];
const cfg = { model: store.get<string>('aiModel', ''), url: store.get<string>('aiUrl', ''), lang: store.get<string>('aiLang', 'auto') };

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error((j as { error?: string }).error ?? String(r.status));
  return j as T;
}
const ask = (messages: Msg[]) => post<{ text: string }>('/api/ai/chat', { url: cfg.url || found || undefined, model: cfg.model, messages }).then(r => r.text);
const system = () => SYSTEM + (cfg.lang === 'fa' ? ' Always answer in Persian (Farsi).' : cfg.lang === 'en' ? ' Always answer in English.' : '');
function context() {
  const p = host.active();
  return chartContext({ symbol: p.cfg.symbol, tf: p.cfg.tf, bars: p.vb(), prec: p.prec, indicators: [...p.cfg.ind, ...(p.cfg.scripts ?? []).map(s => `script ${s.id}`)] });
}
/** Minimal, escape-first markdown: code fences, inline code, bold, line breaks. */
export function md(s: string) {
  return esc(s).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => `<pre dir="ltr">${c}</pre>`).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}
function render() {
  const out = $('#aiLog');
  out.innerHTML = log.length ? log.map((m, i) => `<div class="ai-${m.role}" dir="auto">${m.role === 'user' ? esc(m.content) : md(m.content)}${m.note ? `<div class="muted">${esc(m.note)}</div>` : ''}${m.code ? `<button class="on" data-pine="${i}">Open in Pine Editor</button>` : ''}</div>`).join('') : '<div class="muted">Ask about the chart in any language, or use the buttons below. The model runs on this computer; numbers in its context come from the app.</div>';
  out.querySelectorAll<HTMLButtonElement>('[data-pine]').forEach(b => (b.onclick = () => host.openPine(log[+b.dataset.pine!].code!)));
  out.scrollTop = out.scrollHeight;
}
async function guard(f: () => Promise<void>, needModel = true) {
  if (busy) return; if (needModel && !cfg.model) return toast('Pick a model first (start Ollama or LM Studio, then ↻)');
  busy = true; $('#aiBusy').textContent = 'thinking…';
  try { await f() } catch (e) { log.push({ role: 'assistant', content: `⚠ ${(e as Error).message}` }) }
  finally { busy = false; $('#aiBusy').textContent = ''; render() }
}
function send(text: string, extra: string | null = null) {
  return guard(async () => {
    log.push({ role: 'user', content: text }); render();
    const hist = log.slice(-12, -1).filter(m => !m.content.startsWith('⚠')).map(({ role, content }) => ({ role, content }));
    const reply = await ask([{ role: 'system', content: system() }, { role: 'system', content: `Context — the user's active chart:\n${context()}${extra ? `\n\n${extra}` : ''}` }, ...hist, { role: 'user', content: text }]);
    log.push({ role: 'assistant', content: reply });
  });
}
function pine(request: string) {
  return guard(async () => {
    log.push({ role: 'user', content: `Pine: ${request}` }); render();
    const p = host.active(), r = await writePine(ask, `${request}\n\n(Chart for reference: ${p.cfg.symbol} ${p.cfg.tf}.)${cfg.lang === 'fa' ? ' Explain in Persian.' : ''}`, { bars: p.vb().slice(-500), symbol: p.cfg.symbol, tf: p.cfg.tf, tfSec: tfSeconds(p.cfg.tf) });
    log.push({ role: 'assistant', content: r.text, code: r.code ?? undefined, note: r.ok ? `Checked by the app's Pine engine${r.attempts > 1 ? ` after ${r.attempts} answers` : ''}: it compiles and runs on this chart.` : `Still failing after ${r.attempts} answers (${r.error}). You can open it and fix it by hand.` });
  });
}
const pct = (x: number | null | undefined) => x == null ? 'n/a' : `${(x * 100).toFixed(0)}%`;
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
type Row = { name: string; trades: number; winRate: number; net: number };
const rows = (title: string, r: Row[]) => r.length ? `**${title}**\n${r.slice(0, 6).map(x => `${x.name}: ${x.trades} trades, ${pct(x.winRate)} wins, net ${x.net}`).join('\n')}\n\n` : '';
/** Classic machine learning (Python: scikit-learn) — no language model needed. */
function ml(task: 'regime' | 'patterns' | 'journal') {
  return guard(async () => {
    const p = host.active();
    log.push({ role: 'user', content: { regime: 'Market regime', patterns: 'Candle patterns and similar history', journal: 'Journal statistics (ML)' }[task] }); render();
    if (task === 'journal') {
      const r = await post<{ summary: string; trades: number; winRate: number; net: number; bySetup: Row[]; byMistake: Row[]; byWeekday: Row[]; rules?: string }>('/api/ml/journal', { trades: host.trades() });
      log.push({ role: 'assistant', content: `**${r.trades} trades**, ${pct(r.winRate)} wins, net ${r.net}\n\n${r.summary}\n\n${rows('By setup', r.bySetup)}${rows('By mistake', r.byMistake)}${rows('By weekday', r.byWeekday)}${r.rules ? '```\n' + r.rules + '```' : ''}` });
    } else if (task === 'regime') {
      const r = await post<{ summary: string; stats: Record<string, { share: number; avgReturnPct: number; volPct: number } | null>; segments: { from: number; to: number; regime: string }[] }>('/api/ml/regime', { bars: p.vb().slice(-3000) });
      log.push({ role: 'assistant', content: `**${p.cfg.symbol} ${p.cfg.tf}**: ${r.summary}\n\n${Object.entries(r.stats).filter(([, v]) => v).map(([n, v]) => `${n}: ${pct(v!.share)} of bars, average bar ${v!.avgReturnPct}%, volatility ${v!.volPct}%`).join('\n')}\n\n**Latest phases**\n${r.segments.slice(-6).map(g => `${day(g.from)} → ${day(g.to)}: ${g.regime}`).join('\n')}`, note: 'KMeans on trend, volatility and range of the bars (scikit-learn); the labels are statistical, not a forecast.' });
    } else {
      const r = await post<{ summary: string; track: Record<string, { count: number; hitRate: number | null; avgFwdPct: number | null }>; horizon: number }>('/api/ml/patterns', { bars: p.vb().slice(-3000) });
      log.push({ role: 'assistant', content: `**${p.cfg.symbol} ${p.cfg.tf}**\n${r.summary}\n\n**Track record on this chart (${r.horizon} bars ahead)**\n${Object.entries(r.track).filter(([, v]) => v.count).map(([n, v]) => `${n}: ${v.count} cases${v.hitRate != null ? `, right ${pct(v.hitRate)}` : ''}, average ${v.avgFwdPct}%`).join('\n')}`, note: 'Candle rules plus nearest-neighbour search over past price windows (scikit-learn). Past frequency, not a promise.' });
    }
  }, false);
}
export async function refreshAi() {
  const sel = $<HTMLSelectElement>('#aiModel'), st = $('#aiStatus');
  st.textContent = 'checking…';
  try {
    const s = await fetch(`/api/ai/status${cfg.url ? `?url=${encodeURIComponent(cfg.url)}` : ''}`).then(r => r.json()) as { url: string; online: boolean; models: string[]; model: string | null; error?: string };
    if (s.error) throw Error(s.error);
    found = s.online ? s.url : '';
    if (!cfg.model || !s.models.includes(cfg.model)) cfg.model = s.models.includes(s.model ?? '') ? s.model! : s.models[0] ?? '';
    store.set('aiModel', cfg.model);
    sel.innerHTML = s.models.length ? s.models.map(m => `<option ${m === cfg.model ? 'selected' : ''}>${esc(m)}</option>`).join('') : '<option value="">no model</option>';
    st.innerHTML = s.online ? `<span class="up">●</span> ${esc(s.url)}` : '<span class="dn">●</span> no local model server — install <b>Ollama</b>, run <code>ollama pull qwen2.5:7b</code>, then ↻';
  } catch (e) { st.innerHTML = `<span class="dn">●</span> ${esc((e as Error).message)}` }
}
export function initAi(h: AiHost) {
  host = h;
  $('#s-ai').innerHTML = `<h3>AI <span class="muted">local model</span><span class="grow"></span><button id="aiRefresh" class="x" title="Look for the local model server again">↻</button><button id="aiClear" class="x" title="Clear the chat">🗑</button></h3>
    <div class="row"><select id="aiModel" class="grow" title="Model"></select><select id="aiLang" title="Answer language"><option value="auto">auto</option><option value="fa">فارسی</option><option value="en">English</option></select></div>
    <div class="row"><input id="aiUrl" class="grow" placeholder="server URL (default: Ollama, then LM Studio)" dir="ltr" value="${esc(cfg.url)}"></div>
    <div id="aiStatus" class="muted"></div><div id="aiLog" class="ai-log"></div>
    <div class="row wrap"><button id="aiExplain">Explain this chart</button><button id="aiPine">Write Pine</button><button id="aiReview">Review my trades</button><button id="mlRegime" title="No language model: scikit-learn">Regime</button><button id="mlPatterns" title="No language model: scikit-learn">Patterns</button><button id="mlJournal" title="No language model: scikit-learn">Journal stats</button><span id="aiBusy" class="muted"></span></div>
    <textarea id="aiIn" rows="3" dir="auto" placeholder="Ask… (Enter to send, Shift+Enter for a new line). For Pine, describe the script and press Write Pine."></textarea>`;
  $<HTMLSelectElement>('#aiModel').onchange = e => { cfg.model = (e.target as HTMLSelectElement).value; store.set('aiModel', cfg.model) };
  const lang = $<HTMLSelectElement>('#aiLang'); lang.value = cfg.lang; lang.onchange = () => { cfg.lang = lang.value; store.set('aiLang', cfg.lang) };
  $<HTMLInputElement>('#aiUrl').onchange = e => { cfg.url = (e.target as HTMLInputElement).value.trim(); store.set('aiUrl', cfg.url); void refreshAi() };
  $('#aiRefresh').onclick = () => void refreshAi();
  $('#aiClear').onclick = () => { log.length = 0; render() };
  const input = $<HTMLTextAreaElement>('#aiIn'), take = () => { const t = input.value.trim(); input.value = ''; return t };
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = take(); if (t) void send(t) } };
  $('#aiExplain').onclick = () => void send(take() || 'Explain this chart: the trend, the key levels, two scenarios and what would invalidate each.');
  $('#aiPine').onclick = () => { const t = take(); if (!t) return toast('Describe the script first, e.g. "RSI with overbought/oversold signals"'); void pine(t) };
  $('#aiReview').onclick = () => void send(take() || 'Review my trading from the journal: what works, what fails, and three concrete rules I should change.', `The user's trading journal:\n${journalContext(host.trades())}`);
  $('#mlRegime').onclick = () => void ml('regime'); $('#mlPatterns').onclick = () => void ml('patterns'); $('#mlJournal').onclick = () => void ml('journal');
  render();
}
