// lightweight-charts (5.0.x) answers 0 from timeScale().logicalToCoordinate() for a fractional bar index. A drawing whose time falls
// between two bars (every drawing seen on another interval, or on bars that were loaded later) used to collapse to the left edge.
// Here the two whole-number neighbours are asked instead and the answer is interpolated.
export interface LogicalScale { logicalToCoordinate(logical: number): number | null }

export function logicalX(ts: LogicalScale, l: number): number | null {
  if (!Number.isFinite(l)) return null;
  const i = Math.floor(l), a = ts.logicalToCoordinate(i);
  if (l === i) return a;
  const b = ts.logicalToCoordinate(i + 1);
  if (a != null && b != null) return a + (l - i) * (b - a);
  // Neighbour unknown (far outside the data): extend the spacing between bar 0 and bar 1.
  const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1);
  return x0 != null && x1 != null ? x0 + l * (x1 - x0) : null;
}
