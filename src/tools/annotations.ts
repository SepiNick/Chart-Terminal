// Notes, callouts, labels, images and icons beyond plain Text.
import type { Drawing, Renderer, Style, ToolDef, XY } from './types.ts';

/** Box size of text as RecordingRenderer.text would lay it out. */
function measure(r: Renderer, s: string, size: number, bold: boolean, pad: number): [number, number] {
  r.ctx.font = `${r.style.italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px system-ui, sans-serif`;
  const lines = s.split('\n');
  return [Math.max(...lines.map(l => r.ctx.measureText(l).width)) + pad * 2, lines.length * size * 1.25 + pad * 2];
}
/** Filled speech bubble centered at c with a tail to tip. */
function bubble(r: Renderer, d: Drawing, tip: XY, c: XY) {
  const s = d.style, bg = r.fill(s.fillColor, s.fillAlpha || 0.9);
  const dx = tip[0] - c[0], dy = tip[1] - c[1], len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * 8, ny = (dx / len) * 8;
  if (len > 1) r.poly([tip, [c[0] + nx, c[1] + ny], [c[0] - nx, c[1] - ny]], true, { fill: bg, stroke: false });
  r.text(s.text || ' ', c, { align: 'center', baseline: 'middle', bg, pad: 8 });
}
/** Text box shown above `at` (notes/pins when selected). */
const popup = (r: Renderer, d: Drawing, at: XY) =>
  r.text(d.style.text || ' ', at, { align: 'center', baseline: 'bottom', bg: r.fill(), border: d.style.color, pad: 6, maxWidth: 260 });
const NOTE_STYLE: Partial<Style> = { text: 'Note', fillColor: '#ffffff', fillAlpha: 1, textColor: '#131722' };

function textTool(id: string, name: string, icon: string, screenAnchored: boolean): ToolDef {
  return {
    id, name, icon, group: 'annotations', points: 1, needsText: true, screenAnchored,
    defaults: { text: 'Text', fontSize: 14 },
    props: [{ key: 'bgOn', label: 'Background', type: 'bool', default: false }, { key: 'border', label: 'Border', type: 'bool', default: false }],
    draw(r, d, P) {
      const s = d.style;
      r.text(s.text || ' ', P[0], { bg: s.bgOn ? r.fill(s.fillColor, Math.max(s.fillAlpha, 0.2)) : undefined, border: s.border ? s.color : undefined, pad: s.bgOn || s.border ? 5 : 0, baseline: 'top' });
    },
  };
}
// No hover API: the note body shows while selected, otherwise just the icon.
function note(id: string, name: string, screenAnchored: boolean): ToolDef {
  return {
    id, name, icon: '🗒', group: 'annotations', points: 1, needsText: true, screenAnchored, defaults: NOTE_STYLE,
    draw(r, d, P) {
      r.ellipse(P[0], 9, 9, 0, { fill: d.style.color, stroke: false });
      r.text('✎', P[0], { align: 'center', baseline: 'middle', color: '#fff', size: 11, bold: false, italic: false, noHit: true });
      if (r.selected) popup(r, d, [P[0][0], P[0][1] - 13]);
    },
  };
}
function glyphTool(id: string, name: string, icon: string, glyphs: string[]): ToolDef {
  return {
    id, name, icon, group: 'annotations', points: 2,
    props: [{ key: 'glyph', label: 'Glyph', type: 'select', options: glyphs, default: glyphs[0] }],
    draw(r, d, P) {
      const [a, b] = P, size = Math.max(12, Math.min(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])));
      r.text(String(d.style.glyph), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { size, align: 'center', baseline: 'middle', color: d.style.color, bold: false, italic: false });
      if (r.selected) r.rect(a, b, { fill: false, stroke: d.style.color, dash: 'dotted', width: 1, noHit: true });
    },
  };
}
const EMOJIS = ['🚀', '📈', '📉', '💰', '💵', '💎', '🙌', '⚠️', '✅', '❌', '🔥', '🐂', '🐻', '🐳', '🎯', '⭐', '🌙', '☀️', '⚡', '💥', '🔔', '📌', '📍', '🚩', '🏁', '👀', '👍', '👎', '🤔', '😱', '😎', '🤑', '💡', '🧠', '⏰', '🔒', '🔓', '❤️', '💀', '🎉'];
const ICONS = ['→', '←', '↑', '↓', '↗', '↘', '✓', '✗', '★', '☆', '⚑', '⚡', '☂', '✚', '●', '■', '▲', '▼', '◆', '♥', '⚠', 'ⓘ', '❓', '❗', '☀', '☾', '⌛', '⚙', '✉', '☎'];

const images = new Map<string, HTMLImageElement>(); // shortcut: unbounded cache keyed by data URL, fine for a handful of images
function image(src: string) {
  let im = images.get(src);
  if (!im) { im = new Image(); im.onload = () => dispatchEvent(new Event('drawings-repaint')); im.src = src; images.set(src, im) }
  return im;
}

export const ANNOTATION_TOOLS: ToolDef[] = [
  textTool('anchoredtext', 'Anchored text', '𝐓', true),
  note('note', 'Note', false),
  note('anchorednote', 'Anchored note', true),
  {
    // Price pill at the anchor, connector line, text box at the 2nd point.
    id: 'pricenote', name: 'Price note', icon: '🏷', group: 'annotations', points: 2, needsText: true,
    defaults: { text: 'Price note', width: 1 },
    draw(r, d, P, g) {
      r.line(P[0], P[1]);
      r.ellipse(P[0], 3, 3, 0, { fill: d.style.color, stroke: false });
      r.label(g.fmt(d.pts[0].p), [P[0][0], P[0][1] + (P[1][1] < P[0][1] ? 14 : -14)], d.style.color);
      r.text(d.style.text || ' ', P[1], { align: 'center', baseline: P[1][1] < P[0][1] ? 'bottom' : 'top', bg: r.fill(d.style.fillColor, Math.max(d.style.fillAlpha, 0.15)), border: d.style.color, pad: 6 });
    },
  },
  {
    id: 'pin', name: 'Pin', icon: '📌', group: 'annotations', points: 1, needsText: true, defaults: { ...NOTE_STYLE, text: 'Pin' },
    draw(r, d, P) {
      const [x, y] = P[0];
      r.line([x, y], [x, y - 14], { width: 2, dash: 'solid' });
      r.ellipse([x, y - 19], 6, 6, 0, { fill: d.style.color, stroke: false });
      if (r.selected) popup(r, d, [x, y - 29]);
    },
  },
  {
    // `text` as a textarea: rows on new lines, cells separated by '|'. First row is a bold header.
    id: 'table', name: 'Table', icon: '▦', group: 'annotations', points: 1,
    defaults: { fillAlpha: 0.1, width: 1, fontSize: 12 },
    props: [
      { key: 'text', label: 'Cells (rows per line, cells split by |)', type: 'textarea', default: 'Level|Price\nEntry|100\nTarget|120' },
      { key: 'header', label: 'Header row', type: 'bool', default: true },
    ],
    draw(r, d, P) {
      const s = d.style, size = s.fontSize, pad = 6, hdr = !!s.header;
      const rows = String(s.text ?? '').split('\n').map(l => l.split('|').map(c => c.trim()));
      const nc = Math.max(...rows.map(c => c.length));
      const cw = Array.from({ length: nc }, (_, j) => Math.max(...rows.map((row, i) => measure(r, row[j] ?? '', size, s.bold || (hdr && !i), 0)[0])) + pad * 2);
      const rh = size * 1.25 + pad * 2, [x0, y0] = P[0], W = cw.reduce((a, v) => a + v, 0), H = rows.length * rh;
      r.rect([x0, y0], [x0 + W, y0 + H], { fill: r.fill(), stroke: s.color });
      if (hdr) r.rect([x0, y0], [x0 + W, y0 + rh], { fill: r.fill(s.color, 0.25), stroke: false, noHit: true });
      for (let i = 1; i < rows.length; i++) r.hline(y0 + i * rh, x0, x0 + W, { noHit: true });
      let cx = x0;
      cw.forEach((w, j) => {
        if (j) r.line([cx, y0], [cx, y0 + H], { noHit: true });
        rows.forEach((row, i) => r.text(row[j] ?? '', [cx + pad, y0 + i * rh + pad], { baseline: 'top', size, bold: s.bold || (hdr && !i), noHit: true }));
        cx += w;
      });
    },
  },
  {
    id: 'callout', name: 'Callout', icon: '🗨', group: 'annotations', points: 2, needsText: true,
    defaults: { text: 'Callout', fillAlpha: 0.9, textColor: '#ffffff' },
    draw(r, d, P) { bubble(r, d, P[0], P[1]) },
  },
  {
    id: 'comment', name: 'Comment', icon: '💬', group: 'annotations', points: 1, needsText: true,
    defaults: { text: 'Comment', fillAlpha: 0.9, textColor: '#ffffff' },
    draw(r, d, P) {
      const [w, h] = measure(r, d.style.text || ' ', d.style.fontSize, d.style.bold, 8);
      bubble(r, d, P[0], [P[0][0] + w / 2 - 6, P[0][1] - 14 - h / 2]);
    },
  },
  {
    id: 'pricelabel', name: 'Price label', icon: '⌂', group: 'annotations', points: 1,
    draw(r, d, P, g) {
      const [x, y] = P[0];
      r.poly([[x - 5, y - 7], [x + 5, y - 7], [x, y]], true, { fill: d.style.color, stroke: false });
      r.label(d.style.text || g.fmt(d.pts[0].p), [x, y - 17], d.style.color);
    },
  },
  {
    id: 'signpost', name: 'Signpost', icon: '🪧', group: 'annotations', points: 1, needsText: true,
    defaults: { text: 'Signpost', fillAlpha: 1, textColor: '#ffffff' },
    props: [{ key: 'height', label: 'Post height (px)', type: 'number', default: 60, min: 10, max: 400 }],
    draw(r, d, P) {
      const [x, y] = P[0], top = y - (Number(d.style.height) || 60);
      r.line([x, y], [x, top], { width: 2, dash: 'solid' });
      r.ellipse([x, y], 3, 3, 0, { fill: d.style.color, stroke: false });
      r.text(d.style.text || ' ', [x, top], { align: 'center', baseline: 'bottom', bg: r.fill(), pad: 6 });
    },
  },
  {
    id: 'flagmark', name: 'Flag mark', icon: '⚑', group: 'annotations', points: 1,
    draw(r, d, P) {
      const [x, y] = P[0];
      r.line([x, y], [x, y - 24], { width: 2, dash: 'solid' });
      r.poly([[x, y - 24], [x + 16, y - 19], [x, y - 13]], true, { fill: d.style.color, stroke: false });
    },
  },
  {
    // `image` holds a data URL. The engine has no repaint hook, so a freshly set image shows on the next repaint.
    id: 'image', name: 'Image', icon: '🖼', group: 'annotations', points: 2,
    props: [{ key: 'image', label: 'Image', type: 'image', default: '' }],
    draw(r, d, P) {
      const [a, b] = P, src = String(d.style.image || ''), im = src ? image(src) : null;
      if (im?.complete && im.naturalWidth) r.ctx.drawImage(im, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      else {
        r.rect(a, b, { fill: r.fill(d.style.color, 0.08), stroke: d.style.color, dash: 'dashed', width: 1 });
        r.text(src ? 'Loading…' : '🖼 Image', [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { align: 'center', baseline: 'middle', size: 12, noHit: true });
      }
      r.rect(a, b, { fill: 'rgba(0,0,0,0)', stroke: r.selected ? d.style.color : false, width: 1 });
    },
  },
  glyphTool('emoji', 'Emoji / Sticker', '😀', EMOJIS),
  glyphTool('icon', 'Icon', '★', ICONS),
];
