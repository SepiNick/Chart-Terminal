// WPF brushes/colors (System.Windows.Media) and NinjaTrader enums/visual types used by scripts.
import { en } from './helpers.ts';

export class NtColor {
  A: number; R: number; G: number; B: number;
  constructor(a = 255, r = 0, g = 0, b = 0) { this.A = a; this.R = r; this.G = g; this.B = b }
  static FromRgb(r: number, g: number, b: number) { return new NtColor(255, r, g, b) }
  static FromArgb(a: number, r: number, g: number, b: number) { return new NtColor(a, r, g, b) }
  static FromScRgb(a: number, r: number, g: number, b: number) { return new NtColor(a * 255, r * 255, g * 255, b * 255) }
  ToString() { return '#' + [this.A, this.R, this.G, this.B].map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase() }
  Equals(c: NtColor) { return c instanceof NtColor && c.ToString() === this.ToString() }
}
export class SolidColorBrush {
  Color: NtColor; Opacity = 1; IsFrozen = false;
  constructor(c: NtColor = new NtColor()) { this.Color = c }
  Clone() { const b = new SolidColorBrush(new NtColor(this.Color.A, this.Color.R, this.Color.G, this.Color.B)); b.Opacity = this.Opacity; return b }
  CloneCurrentValue() { return this.Clone() }
  Freeze() { if (!Object.isFrozen(this)) { this.IsFrozen = true; Object.freeze(this) } }
  ToString() { return this.Color.ToString() }
}

const NAMED = 'AliceBlue F0F8FF,AntiqueWhite FAEBD7,Aqua 00FFFF,Aquamarine 7FFFD4,Azure F0FFFF,Beige F5F5DC,Bisque FFE4C4,Black 000000,BlanchedAlmond FFEBCD,Blue 0000FF,BlueViolet 8A2BE2,Brown A52A2A,BurlyWood DEB887,CadetBlue 5F9EA0,Chartreuse 7FFF00,Chocolate D2691E,Coral FF7F50,CornflowerBlue 6495ED,Cornsilk FFF8DC,Crimson DC143C,Cyan 00FFFF,DarkBlue 00008B,DarkCyan 008B8B,DarkGoldenrod B8860B,DarkGray A9A9A9,DarkGreen 006400,DarkKhaki BDB76B,DarkMagenta 8B008B,DarkOliveGreen 556B2F,DarkOrange FF8C00,DarkOrchid 9932CC,DarkRed 8B0000,DarkSalmon E9967A,DarkSeaGreen 8FBC8F,DarkSlateBlue 483D8B,DarkSlateGray 2F4F4F,DarkTurquoise 00CED1,DarkViolet 9400D3,DeepPink FF1493,DeepSkyBlue 00BFFF,DimGray 696969,DodgerBlue 1E90FF,Firebrick B22222,FloralWhite FFFAF0,ForestGreen 228B22,Fuchsia FF00FF,Gainsboro DCDCDC,GhostWhite F8F8FF,Gold FFD700,Goldenrod DAA520,Gray 808080,Green 008000,GreenYellow ADFF2F,Honeydew F0FFF0,HotPink FF69B4,IndianRed CD5C5C,Indigo 4B0082,Ivory FFFFF0,Khaki F0E68C,Lavender E6E6FA,LavenderBlush FFF0F5,LawnGreen 7CFC00,LemonChiffon FFFACD,LightBlue ADD8E6,LightCoral F08080,LightCyan E0FFFF,LightGoldenrodYellow FAFAD2,LightGray D3D3D3,LightGreen 90EE90,LightPink FFB6C1,LightSalmon FFA07A,LightSeaGreen 20B2AA,LightSkyBlue 87CEFA,LightSlateGray 778899,LightSteelBlue B0C4DE,LightYellow FFFFE0,Lime 00FF00,LimeGreen 32CD32,Linen FAF0E6,Magenta FF00FF,Maroon 800000,MediumAquamarine 66CDAA,MediumBlue 0000CD,MediumOrchid BA55D3,MediumPurple 9370DB,MediumSeaGreen 3CB371,MediumSlateBlue 7B68EE,MediumSpringGreen 00FA9A,MediumTurquoise 48D1CC,MediumVioletRed C71585,MidnightBlue 191970,MintCream F5FFFA,MistyRose FFE4E1,Moccasin FFE4B5,NavajoWhite FFDEAD,Navy 000080,OldLace FDF5E6,Olive 808000,OliveDrab 6B8E23,Orange FFA500,OrangeRed FF4500,Orchid DA70D6,PaleGoldenrod EEE8AA,PaleGreen 98FB98,PaleTurquoise AFEEEE,PaleVioletRed DB7093,PapayaWhip FFEFD5,PeachPuff FFDAB9,Peru CD853F,Pink FFC0CB,Plum DDA0DD,PowderBlue B0E0E6,Purple 800080,Red FF0000,RosyBrown BC8F8F,RoyalBlue 4169E1,SaddleBrown 8B4513,Salmon FA8072,SandyBrown F4A460,SeaGreen 2E8B57,SeaShell FFF5EE,Sienna A0522D,Silver C0C0C0,SkyBlue 87CEEB,SlateBlue 6A5ACD,SlateGray 708090,Snow FFFAFA,SpringGreen 00FF7F,SteelBlue 4682B4,Tan D2B48C,Teal 008080,Thistle D8BFD8,Tomato FF6347,Transparent 00FFFFFF,Turquoise 40E0D0,Violet EE82EE,Wheat F5DEB3,White FFFFFF,WhiteSmoke F5F5F5,Yellow FFFF00,YellowGreen 9ACD32';
export const Colors: Record<string, NtColor> = {};
export const Brushes: Record<string, SolidColorBrush> = {};
for (const e of NAMED.split(',')) {
  const [name, hex] = e.split(' '), h = hex.length === 8 ? hex : 'FF' + hex, n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  const c = Object.freeze(new NtColor(n(0), n(2), n(4), n(6)));
  Colors[name] = c;
  const b = new SolidColorBrush(c); b.Freeze(); Brushes[name] = b;
}
Object.freeze(Colors); Object.freeze(Brushes);

export const isBrush = (x: unknown): x is SolidColorBrush => x instanceof SolidColorBrush;
/** Brush → CSS color (#rrggbb, or rgba() when translucent); null for null/undefined. */
export function css(b: unknown): string | null {
  if (b == null) return null;
  if (typeof b === 'string') return b;
  const c = b instanceof SolidColorBrush ? b.Color : b instanceof NtColor ? b : null;
  if (!c) return null;
  const a = c.A * (b instanceof SolidColorBrush ? b.Opacity : 1);
  if (a >= 255) return '#' + [c.R, c.G, c.B].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
  return `rgba(${c.R},${c.G},${c.B},${+(a / 255).toFixed(3)})`;
}

export const DashStyleHelper = en('DashStyleHelper', 'Dash', 'DashDot', 'DashDotDot', 'Dot', 'Solid');
export class Stroke {
  Brush: SolidColorBrush; DashStyleHelper = 'Solid'; Width = 1; Opacity = 100;
  // Stroke(brush) | (brush, width) | (brush, dashStyle, width) | (brush, dashStyle, width, opacity)
  constructor(brush: SolidColorBrush = Brushes.Black, a?: number | string, w?: number, op?: number) {
    this.Brush = brush;
    if (typeof a === 'number') this.Width = a;
    else if (typeof a === 'string') { this.DashStyleHelper = a; if (w != null) this.Width = w; if (op != null) this.Opacity = op }
  }
  Clone() { const s = new Stroke(this.Brush, this.DashStyleHelper, this.Width, this.Opacity); return s }
}
export class SimpleFont {
  Family: string; Size: number; Bold = false; Italic = false;
  constructor(family = 'Arial', size = 12) { this.Family = family; this.Size = size }
}
