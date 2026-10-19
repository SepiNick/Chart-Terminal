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

export type CursorMode = 'cross' | 'dot' | 'arrow' | 'demo' | 'eraser';
export const CURSORS: { id: CursorMode; name: string; icon: string }[] = [
  { id: 'cross', name: 'Cross', icon: '✛' },
  { id: 'dot', name: 'Dot', icon: '•' },
  { id: 'arrow', name: 'Arrow', icon: '↖' },
  { id: 'demo', name: 'Demonstration', icon: '◉' },
  { id: 'eraser', name: 'Eraser', icon: '⌫' },
];
