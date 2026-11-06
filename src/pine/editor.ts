import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { cpp } from '@codemirror/lang-cpp';
import { csharp } from '@codemirror/legacy-modes/mode/clike';
import { python } from '@codemirror/legacy-modes/mode/python';
import { Compartment } from '@codemirror/state';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput, indentUnit, foldService, foldGutter, foldKeymap } from '@codemirror/language';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, type CompletionContext } from '@codemirror/autocomplete';
import { setDiagnostics, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

export interface PineEditor {
  setLanguage(lang: 'pine' | 'mql' | 'csharp' | 'python'): void;
  getValue(): string;
  setValue(src: string): void;
  setErrors(errs: { line: number; col: number; msg: string; wide?: boolean }[]): void;
  focus(): void;
  destroy(): void;
}

const KEYWORDS = 'if else for to by in while switch var varip and or not break continue import export method type enum'.split(' ');
const ATOMS = new Set(['true', 'false', 'na']);
const KW = new Set(KEYWORDS);
const NAMESPACES = new Set('ta math str color array input strategy request syminfo timeframe barstate'.split(' '));
const BUILTIN_VARS = new Set('open high low close volume time bar_index hl2 hlc3 ohlc4'.split(' '));
const DECLS = new Set('indicator strategy library plot plotshape plotchar hline fill bgcolor barcolor alertcondition'.split(' '));

const pine = StreamLanguage.define<{ inString: string | null }>({
  name: 'pine',
  startState: () => ({ inString: null }),
  token(stream, state) {
    if (!state.inString && stream.eatSpace()) return null;
    if (!state.inString && (stream.peek() === '"' || stream.peek() === "'")) state.inString = stream.next()!;
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next();
        else if (ch === state.inString) { state.inString = null; break; }
      }
      return 'string';
    }
    if (stream.match(/^\/\/@\w+.*/)) return 'meta';
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^#[0-9a-fA-F]{8}\b/) || stream.match(/^#[0-9a-fA-F]{6}\b/)) return 'color';
    if (stream.match(/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/)) return 'number';
    const w = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null;
    if (w) {
      const s = w[0];
      if (ATOMS.has(s)) return 'atom';
      if (KW.has(s)) return 'keyword';
      // `strategy.entry` is a namespace; bare `strategy(` is a declaration.
      if (NAMESPACES.has(s) && stream.peek() === '.') return 'namespace';
      if (DECLS.has(s)) return 'variableName.definition';
      if (BUILTIN_VARS.has(s)) return 'variableName.standard';
      if (stream.peek() === '(') return 'variableName.function';
      return 'variableName';
    }
    if (stream.match(/^(:=|==|!=|<=|>=|=>|[-+*/%=<>?:])/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' } },
});

const highlight = HighlightStyle.define([
  { tag: t.comment, color: 'var(--pe-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--pe-meta)', fontWeight: '600' },
  { tag: t.string, color: 'var(--pe-string)' },
  { tag: [t.number, t.color, t.atom], color: 'var(--pe-number)' },
  { tag: t.keyword, color: 'var(--pe-keyword)', fontWeight: '600' },
  { tag: t.namespace, color: 'var(--pe-ns)' },
  { tag: t.standard(t.variableName), color: 'var(--pe-builtin)' },
  { tag: t.definition(t.variableName), color: 'var(--accent)', fontWeight: '600' },
  { tag: t.function(t.variableName), color: 'var(--pe-fn)' },
  { tag: t.operator, color: 'var(--muted)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%', background: 'var(--bg)', color: 'var(--text)', fontSize: '13px',
    '--pe-comment': '#6a737d', '--pe-meta': '#b35900', '--pe-string': '#22863a', '--pe-number': '#005cc5',
    '--pe-keyword': '#a626a4', '--pe-ns': '#0e7490', '--pe-builtin': '#c2410c', '--pe-fn': '#6f42c1',
  },
  ':root[data-theme=dark] &': {
    '--pe-comment': '#7f848e', '--pe-meta': '#e5a663', '--pe-string': '#98c379', '--pe-number': '#79b8ff',
    '--pe-keyword': '#d38aea', '--pe-ns': '#56b6c2', '--pe-builtin': '#f0a35e', '--pe-fn': '#b39dfa',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
  '.cm-content': { caretColor: 'var(--text)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-gutters': { background: 'var(--panel)', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { background: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
  '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '&.cm-focused .cm-matchingBracket': { background: 'color-mix(in srgb, var(--accent) 25%, transparent)', outline: 'none' },
  '.cm-tooltip, .cm-panels': { background: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { background: 'var(--accent)', color: '#fff' },
  '.cm-panels input, .cm-panels button': { fontSize: '12px' },
});

// Pine blocks are indentation-scoped: fold a line's body = following lines indented deeper (blank lines included).
const indentFold = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const ind = (s: string) => s.match(/^\s*/)![0].length;
  if (!line.text.trim()) return null;
  const base = ind(line.text);
  let end = line;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (!l.text.trim()) continue;
    if (ind(l.text) <= base) break;
    end = l;
  }
  return end.number > line.number ? { from: line.to, to: end.to } : null;
});

export function createPineEditor(
  parent: HTMLElement,
  opts: { doc: string; onChange?: (src: string) => void; onRun?: () => void; completions: string[]; keywords?: string[]; lang?: 'pine' | 'python' },
): PineEditor {
  const options = [
    ...opts.completions.map(label => ({ label, type: label.includes('.') ? 'function' : 'variable' })),
    ...(opts.keywords ?? [...KEYWORDS, ...ATOMS]).map(label => ({ label, type: 'keyword' })),
  ];
  const complete = (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[\w.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return { from: word.from, options, validFor: /^[\w.]*$/ };
  };

  const language = new Compartment();   // Pine or MQL (C++ grammar)
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc,
      extensions: [
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (opts.onRun?.(), true) }]),
        lineNumbers(), highlightActiveLineGutter(), foldGutter(), lintGutter(),
        history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightSelectionMatches(), search(),
        indentUnit.of('    '), EditorState.tabSize.of(4), indentFold,
        language.of(opts.lang === 'python' ? StreamLanguage.define(python) : pine), syntaxHighlighting(highlight), theme,
        autocompletion({ override: [complete] }),
        keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap, indentWithTab]),
        EditorView.updateListener.of(u => { if (u.docChanged) opts.onChange?.(u.state.doc.toString()); }),
      ],
    }),
  });

  return {
    setLanguage: lang => view.dispatch({ effects: language.reconfigure(lang === 'mql' ? cpp() : lang === 'csharp' ? StreamLanguage.define(csharp) : lang === 'python' ? StreamLanguage.define(python) : pine) }),
    getValue: () => view.state.doc.toString(),
    setValue: src => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: src } }),
    setErrors(errs) {
      const doc = view.state.doc;
      const diags: Diagnostic[] = errs.map(e => {
        const line = doc.line(Math.min(Math.max(1, e.line), doc.lines));
        const from = Math.min(line.from + Math.max(0, e.col - 1), line.to);
        const m = /^\w+/.exec(doc.sliceString(from, line.to));
        const to = e.wide ? Math.max(line.to, from + 1) : m ? from + m[0].length : Math.min(from + 1, line.to);
        return { from, to, severity: 'error', message: e.msg };
      });
      view.dispatch(setDiagnostics(view.state, diags));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
