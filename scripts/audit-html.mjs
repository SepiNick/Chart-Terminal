// Finds string values interpolated into HTML template strings without escaping (an XSS review aid, run by `npm run audit:html`).
// Uses the TypeScript type checker: numbers, booleans and unions of string literals cannot carry markup and pass; so does
// esc(…), and a call to a function that itself builds HTML from a template (that template is checked on its own).
// Everything else is a plain `string`/`any` going into HTML and is printed for a human to read. Exit code 1 if any.
//   node scripts/audit-html.mjs            fail on any finding that is not in scripts/audit-html.baseline.json
//   node scripts/audit-html.mjs --all      list every finding, reviewed or not
//   node scripts/audit-html.mjs --update   record the current findings as reviewed (after reading each one)
//   node scripts/audit-html.mjs --safe     also list calls to HTML-building helpers
import ts from 'typescript';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const cfgPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')) } });
const program = ts.createProgram(cfg.fileNames, cfg.options), checker = program.getTypeChecker();
const showSafe = process.argv.includes('--safe');
const findings = [], safeNotes = [];
const TAG = /<[a-zA-Z/!][^`]*/;
const helperCache = new Map();
const isDate = t => t.symbol?.name === 'Date';
const symOf = n => { const sym = checker.getSymbolAtLocation(n); return sym && (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym };

const harmless = t => {
  if (t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void | ts.TypeFlags.Never | ts.TypeFlags.BigIntLike)) return true;
  if (t.flags & ts.TypeFlags.StringLiteral || t.flags & ts.TypeFlags.TemplateLiteral && false) return true;
  if (t.isUnion()) return t.types.every(harmless);
  return false;
};
/** Does this function build HTML from a template (so calling it is not a raw string path)? */
function buildsHtml(sym) {
  if (!sym) return false;
  if (helperCache.has(sym)) return helperCache.get(sym);
  helperCache.set(sym, false);
  let yes = false;
  for (const d of sym.declarations ?? []) {
    let body = d;
    if (ts.isVariableDeclaration(d) && d.initializer) body = d.initializer;
    (function v(n) { if (yes) return; if ((ts.isTemplateExpression(n) || ts.isNoSubstitutionTemplateLiteral(n)) && TAG.test(n.getText())) { yes = true; return } ts.forEachChild(n, v) })(body);
  }
  helperCache.set(sym, yes);
  return yes;
}
/** Is this value built only from literals in the source (constant tables, their keys, entries and elements)? */
function literalish(e, depth = 0) {
  if (!e || depth > 8) return false;
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression?.(e)) e = e.expression;
  const L = x => literalish(x, depth + 1);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e) || e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isTemplateExpression(e)) return e.templateSpans.every(p => L(p.expression));
  if (ts.isArrayLiteralExpression(e)) return e.elements.every(x => ts.isSpreadElement(x) ? L(x.expression) : L(x));
  if (ts.isObjectLiteralExpression(e)) return e.properties.every(p => (ts.isPropertyAssignment(p) && L(p.initializer)) || ts.isShorthandPropertyAssignment(p) && L(p.name));
  if (ts.isConditionalExpression(e)) return L(e.whenTrue) && L(e.whenFalse);
  if (ts.isBinaryExpression(e)) return L(e.left) && L(e.right);
  if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) return L(e.expression);
  if (ts.isSpreadElement(e)) return L(e.expression);
  if (ts.isCallExpression(e)) {
    const c = e.expression.getText();
    if (/^Object\.(entries|keys|values)$/.test(c)) return L(e.arguments[0]);
    if (ts.isPropertyAccessExpression(e.expression) && /^(slice|filter|concat|map|flatMap|sort|reverse|at|join|toUpperCase|toLowerCase|replace|replaceAll|trim|padStart|padEnd|toString)$/.test(e.expression.name.text)) {
      if (!L(e.expression.expression)) return false;
      if (/^(map|flatMap)$/.test(e.expression.name.text)) { const cb = e.arguments[0]; return !!cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && (ts.isBlock(cb.body) ? returnsAll(cb.body, L) : L(cb.body)) }
      return e.arguments.every(L);
    }
    return false;
  }
  if (ts.isIdentifier(e)) {
    const sym = checker.getSymbolAtLocation(e), d = sym?.valueDeclaration;
    if (!d) return false;
    if (ts.isVariableDeclaration(d) && d.initializer && ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const) return L(d.initializer);
    // a parameter (or destructured part of one) of a callback over a literal list: xs.map(x => …), Object.entries(T).map(([k, v]) => …)
    let n = d; while (n && !ts.isParameter(n)) n = n.parent;
    if (n && ts.isParameter(n) && (ts.isArrowFunction(n.parent) || ts.isFunctionExpression(n.parent))) {
      const fn = n.parent, call = fn.parent;
      if (ts.isCallExpression(call) && call.arguments[0] === fn && ts.isPropertyAccessExpression(call.expression) && /^(map|forEach|filter|flatMap|some|every|find|reduce)$/.test(call.expression.name.text)) return L(call.expression.expression);
    }
    return false;
  }
  return false;
}
function returnsAll(block, f) { const rets = []; (function v(n) { if (ts.isReturnStatement(n) && n.expression) rets.push(n.expression); if (n === block || !ts.isFunctionLike(n)) ts.forEachChild(n, v) })(block); return rets.length > 0 && rets.every(f) }
function status(e) {
  if (literalish(e)) return 'safe';
  while (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) e = e.expression;
  if (ts.isCallExpression(e)) {
    const callee = e.expression.getText();
    if (callee === 'esc') return 'safe';
    if (/\.join$/.test(callee) && ts.isCallExpression(e.expression.expression)) {   // xs.map(cb).join('')
      const m = e.expression.expression, cb = m.arguments[0];
      if (/\.map$/.test(m.expression.getText()) && cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
        if (!ts.isBlock(cb.body)) return status(cb.body);
        const rets = []; (function v(n) { if (ts.isReturnStatement(n) && n.expression) rets.push(n.expression); if (n === cb.body || !ts.isFunctionLike(n)) ts.forEachChild(n, v) })(cb.body);
        const s = rets.map(status); return s.includes('unsafe') ? 'unsafe' : s.includes('helper') ? 'helper' : 'safe';
      }
    }
    // A call whose receiver and arguments are all numbers, booleans, Dates or string literals can only return digits and
    // fixed text (x.toFixed(2), fmtVol(n), new Date(t).toLocaleString()): nothing to escape.
    const recv = ts.isPropertyAccessExpression(e.expression) ? e.expression.expression : null;
    if ((!recv || status(recv) === 'safe' || isDate(checker.getTypeAtLocation(recv))) && e.arguments.every(a => status(a) === 'safe' || isDate(checker.getTypeAtLocation(a))) && !buildsHtml(symOf(e.expression))) return 'safe';
    const sym = symOf(e.expression);
    if (buildsHtml(sym)) return 'helper';
  }
  if (ts.isTemplateExpression(e)) { const s = e.templateSpans.map(p => status(p.expression)); return s.includes('unsafe') ? 'unsafe' : s.includes('helper') ? 'helper' : 'safe' }
  if (ts.isConditionalExpression(e)) { const a = status(e.whenTrue), b = status(e.whenFalse); return a === 'unsafe' || b === 'unsafe' ? 'unsafe' : a === 'helper' || b === 'helper' ? 'helper' : 'safe' }
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(e.operatorToken.kind)) {
    const a = status(e.left), b = status(e.right); return a === 'unsafe' || b === 'unsafe' ? 'unsafe' : a === 'helper' || b === 'helper' ? 'helper' : 'safe';
  }
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return 'safe';
  return harmless(checker.getTypeAtLocation(e)) ? 'safe' : 'unsafe';
}
for (const sf of program.getSourceFiles()) {
  if (sf.isDeclarationFile || !sf.fileName.includes('/src/') || /\.test\.ts$/.test(sf.fileName)) continue;
  const rel = sf.fileName.slice(sf.fileName.indexOf('/src/') + 1);
  const line = n => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  (function visit(n) {
    if (ts.isTemplateExpression(n) && TAG.test(n.getText())) for (const s of n.templateSpans) {
      const st = status(s.expression), src = s.expression.getText().replace(/\s+/g, ' ').slice(0, 120);
      if (st === 'unsafe') findings.push(`${rel}:${line(s.expression)}  \${${src}}   : ${checker.typeToString(checker.getTypeAtLocation(s.expression))}`);
      else if (showSafe && st === 'helper') safeNotes.push(`${rel}:${line(s.expression)}  [html helper] \${${src}}`);
    }
    ts.forEachChild(n, visit);
  })(sf);
}
if (showSafe) console.log(safeNotes.join('\n') + '\n');
// A finding is identified by file and expression (not line), so edits elsewhere in the file do not reopen it.
const sig = f => f.replace(/:\d+\s\s/, ' ').replace(/\s+:\s[^:]*$/, '');
const BASE = 'scripts/audit-html.baseline.json';
const counts = {}; for (const f of findings) counts[sig(f)] = (counts[sig(f)] ?? 0) + 1;
if (process.argv.includes('--update')) { writeFileSync(BASE, JSON.stringify(Object.fromEntries(Object.entries(counts).sort()), null, 1) + '\n'); console.log(`Recorded ${findings.length} reviewed finding(s) in ${BASE}.`); process.exit(0) }
if (process.argv.includes('--all')) { console.log(findings.join('\n')); process.exit(0) }
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : {};
const fresh = Object.entries(counts).filter(([k, n]) => n > (base[k] ?? 0));
console.log(fresh.length ? fresh.map(([k]) => 'NEW  ' + k).join('\n') + `\n\n${fresh.length} string interpolation(s) into HTML that were not reviewed. Escape them with esc(), or read them and run with --update.` : `No new unescaped interpolations (${findings.length} reviewed ones are in ${BASE}).`);
process.exit(fresh.length ? 1 : 0);
