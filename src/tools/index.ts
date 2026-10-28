// Tool registry. Each group file exports a ToolDef[]; order here is toolbar order within a group.
import type { GroupId, ToolDef } from './types.ts';
import { BASIC_TOOLS } from './basic.ts';
import { LINE_TOOLS } from './lines.ts';
import { FIB_GANN_TOOLS } from './fibgann.ts';
import { PATTERN_TOOLS } from './patterns.ts';
import { FORECAST_TOOLS } from './forecast.ts';
import { SHAPE_TOOLS } from './shapes.ts';
import { ANNOTATION_TOOLS } from './annotations.ts';

export const ALL_TOOLS: ToolDef[] = [
  ...BASIC_TOOLS, ...LINE_TOOLS, ...FIB_GANN_TOOLS, ...PATTERN_TOOLS, ...FORECAST_TOOLS, ...SHAPE_TOOLS, ...ANNOTATION_TOOLS,
];

export const TOOL_MAP = new Map(ALL_TOOLS.map(t => [t.id, t]));

/** Left toolbar groups, as in TradingView. Cursors are engine modes, not drawings. */
export const GROUPS: { id: GroupId; name: string; icon: string }[] = [
  { id: 'cursors', name: 'Cursors', icon: '✛' },
  { id: 'lines', name: 'Trend line tools', icon: '╱' },
  { id: 'fib', name: 'Gann and Fibonacci tools', icon: '≡' },
  { id: 'patterns', name: 'Patterns', icon: '⋀' },
  { id: 'forecast', name: 'Forecasting and measurement tools', icon: '⬍' },
  { id: 'shapes', name: 'Geometric shapes', icon: '✎' },
  { id: 'annotations', name: 'Annotation tools', icon: 'T' },
];

/** Sections of each group's flyout, in TradingView's order. Tools not listed here are shown last under "More". */
export const SECTIONS: Partial<Record<GroupId, { name: string; ids: string[] }[]>> = {
  lines: [
    { name: 'Lines', ids: ['trend', 'ray', 'infoline', 'extended', 'trendangle', 'hline', 'hray', 'vline', 'crossline'] },
    { name: 'Channels', ids: ['parallel', 'regression', 'flattop', 'disjoint'] },
    { name: 'Pitchforks', ids: ['pitchfork', 'schiff', 'modschiff', 'insidepitchfork'] },
  ],
  fib: [
    { name: 'Fibonacci', ids: ['fib', 'fibext', 'fibchannel', 'fibtimezone', 'fibspeedfan', 'trendfibtime', 'fibcircles', 'fibspiral', 'fibarcs', 'fibwedge', 'pitchfan'] },
    { name: 'Gann', ids: ['gannbox', 'gannsquarefixed', 'gannsquare', 'gannfan'] },
  ],
  patterns: [
    { name: 'Chart patterns', ids: ['xabcd', 'cypher', 'headshoulders', 'abcd', 'trianglepattern', 'threedrives'] },
    { name: 'Elliott waves', ids: ['elliott12345', 'elliottabc', 'elliottabcde', 'elliottwxy', 'elliottwxyxz'] },
    { name: 'Cycles', ids: ['cycliclines', 'timecycles', 'sineline'] },
  ],
  forecast: [
    { name: 'Forecasting', ids: ['long', 'short', 'forecast', 'barspattern', 'ghostfeed', 'projection', 'sector'] },
    { name: 'Volume-based', ids: ['avwap', 'frvp', 'avp'] },
    { name: 'Measurers', ids: ['pricerange', 'daterange', 'datepricerange'] },
  ],
  shapes: [
    { name: 'Brushes', ids: ['brush', 'highlighter'] },
    { name: 'Arrows', ids: ['arrowmarker', 'arrowline', 'arrowmarkup', 'arrowmarkdown', 'arrowmarkleft', 'arrowmarkright'] },
    { name: 'Shapes', ids: ['rect', 'rotrect', 'path', 'circle', 'ellipse', 'polyline', 'triangle', 'arc', 'curve', 'doublecurve'] },
  ],
  annotations: [
    { name: 'Text & notes', ids: ['text', 'anchoredtext', 'note', 'anchorednote', 'callout', 'comment', 'pricelabel', 'pricenote', 'signpost', 'flagmark', 'pin', 'table'] },
    { name: 'Content', ids: ['image', 'emoji', 'icon'] },
  ],
};
/** A group's tools as flyout sections (every tool of the group exactly once). */
export function groupSections(g: GroupId): { name: string; tools: ToolDef[] }[] {
  const all = ALL_TOOLS.filter(t => t.group === g), seen = new Set<string>();
  const out = (SECTIONS[g] ?? []).map(s => ({ name: s.name, tools: s.ids.map(id => all.find(t => t.id === id)).filter((t): t is ToolDef => !!t && !seen.has(t.id) && !!seen.add(t.id)) })).filter(s => s.tools.length);
  const rest = all.filter(t => !seen.has(t.id));
  return rest.length ? [...out, { name: out.length ? 'More' : '', tools: rest }] : out;
}

export type CursorMode = 'cross' | 'magic' | 'dot' | 'arrow' | 'demo' | 'eraser';
export const CURSORS: { id: CursorMode; name: string; icon: string }[] = [
  { id: 'cross', name: 'Cross', icon: '✛' },
  { id: 'magic', name: 'Magic (snap to OHLC)', icon: '✧' },
  { id: 'dot', name: 'Dot', icon: '•' },
  { id: 'arrow', name: 'Arrow', icon: '↖' },
  { id: 'demo', name: 'Demonstration', icon: '◉' },
  { id: 'eraser', name: 'Eraser', icon: '⌫' },
];
