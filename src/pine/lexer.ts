// Pine Script tokenizer: indentation blocks (indent/dedent/nl tokens), line wrapping, comments, //@version.
import { PineSyntaxError } from './ast.ts';

type TokType = 'num' | 'str' | 'color' | 'ident' | 'kw' | 'op' | 'nl' | 'indent' | 'dedent' | 'eof';
export interface Tok { type: TokType; value: string; line: number; col: number }   // str value is unescaped

// import/export/method/type/enum are contextual: lexed as identifiers, recognised by the parser at statement start
// (so `syminfo.type` or a variable named `method` still work).
const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'var', 'varip',
  'true', 'false', 'na', 'and', 'or', 'not', 'break', 'continue']);
const OPS = [':=', '==', '!=', '<=', '>=', '=>', '+=', '-=', '*=', '/=', '%=',
  '+', '-', '*', '/', '%', '<', '>', '=', '?', ':', ',', '.', '(', ')', '[', ']'];
const NUM = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y, ID = /[A-Za-z_]\w*/y;
const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-zA-Z_])/y;
const ESC: Record<string, string> = { n: '\n', t: '\t' };
const OPENER: Record<string, string> = { ')': '(', ']': '[' };

export function lex(src: string): { tokens: Tok[]; version: number | null } {
  const toks: Tok[] = [], open: Tok[] = [], levels = [0];
  const lines = src.split(/\r\n?|\n/);
  let version: number | null = null;
  const err = (m: string, line: number, col: number): never => { throw new PineSyntaxError(m, line, col) };
  const push = (type: TokType, value: string, line: number, col: number) => { toks.push({ type, value, line, col }) };
  const comment = (s: string) => { const m = /^\/\/\s*@version\s*=\s*(\d+)/.exec(s); if (m) version = +m[1] };
  const endNl = () => {   // nl token sits at the end of the previous token's line (better "found end of line" positions)
    const last = toks[toks.length - 1];
    push('nl', '', last.line, lines[last.line - 1].trimEnd().length + 1);
  };

  lines.forEach((text, li) => {
    const line = li + 1;
    let p = 0;
    if (!open.length) {   // inside ( or [ indentation is irrelevant
      let ind = 0;
      while (text[p] === ' ' || text[p] === '\t') ind += text[p++] === '\t' ? 4 : 1;
      if (p === text.length || text.startsWith('//', p)) return comment(text.slice(p));   // blank/comment-only
      if (ind % 4) { if (!toks.length) err('Bad indentation: the first line cannot be a continuation', line, p + 1) }
      else {   // ind % 4 != 0 continues the previous line; otherwise a new logical line
        const lv = ind / 4, top = () => levels[levels.length - 1];
        if (toks.length) endNl();
        if (lv > top() + 1) err(`Bad indentation: expected at most ${(top() + 1) * 4} spaces, found ${ind}`, line, p + 1);
        if (lv > top()) { levels.push(lv); push('indent', '', line, p + 1) }
        while (lv < top()) { levels.pop(); push('dedent', '', line, p + 1) }
      }
    }
    const match = (re: RegExp) => { re.lastIndex = p; return re.exec(text) };
    while (p < text.length) {
      const c = text[p], col = p + 1;
      let m: RegExpExecArray | null;
      if (c === ' ' || c === '\t') { p++; continue }
      if (text.startsWith('//', p)) { comment(text.slice(p)); break }
      if (c === '"' || c === "'") {
        let s = '';
        for (p++; text[p] !== c; ) {
          if (p >= text.length) err('Unterminated string literal', line, col);
          if (text[p] === '\\' && p + 1 < text.length) { s += ESC[text[p + 1]] ?? text[p + 1]; p += 2 }
          else s += text[p++];
        }
        p++; push('str', s, line, col); continue;
      }
      if ((m = match(NUM))) { push('num', m[0], line, col); p += m[0].length; continue }
      if ((m = match(ID))) { push(KEYWORDS.has(m[0]) ? 'kw' : 'ident', m[0], line, col); p += m[0].length; continue }
      if (c === '#') {
        if (!(m = match(COLOR))) err('Invalid color literal: expected #RRGGBB or #RRGGBBAA', line, col);
        push('color', m![0], line, col); p += m![0].length; continue;
      }
      const op = OPS.find(o => text.startsWith(o, p));
      if (!op) return err(`Unexpected character '${c}'`, line, col);
      push('op', op, line, col); p += op.length;
      if (op === '(' || op === '[') open.push(toks[toks.length - 1]);
      else if (op === ')' || op === ']') {
        const o = open.pop();
        if (!o) err(`Unexpected '${op}' with no matching '${OPENER[op]}'`, line, col);
        else if (o.value !== OPENER[op]) err(`Mismatched '${op}': '${o.value}' opened at ${o.line}:${o.col}`, line, col);
      }
    }
  });
  if (open.length) { const o = open[open.length - 1]; err(`'${o.value}' was never closed`, o.line, o.col) }
  if (toks.length) endNl();
  while (levels.length > 1) { levels.pop(); push('dedent', '', lines.length + 1, 1) }
  push('eof', '', lines.length + 1, 1);
  return { tokens: toks, version };
}
