export interface ColumnWidth {
  id: string
  width: number
  minWidth: number
  /** A flex column keeps its width: AG Grid sizes it from what is left, not from content. */
  fixed?: boolean
}

/**
 * The widths that bring a content-sized grid down to `limit` px in total, or {} when it already
 * fits. Only the widest columns shrink, all to one shared ceiling, so narrow columns (Lat,
 * Elapsed) keep their full content and the long text columns (Address, To) ellipsise. No column
 * goes below its own minWidth, so the total can still end up over the limit when the minimums
 * alone exceed it.
 *
 * John 2026-10-27: the Radio Log ran far past the screen and "scrolling too widely loses
 * association between fields" - start at no more than 1.5 screen widths.
 */
export function capColumnWidths(cols: ColumnWidth[], limit: number): Record<string, number> {
  const total = cols.reduce((s, c) => s + c.width, 0)
  if (total <= limit) return {}
  const sized = (ceiling: number) =>
    cols.reduce((s, c) => s + (c.fixed ? c.width : Math.min(c.width, Math.max(ceiling, c.minWidth))), 0)
  let lo = 0
  let hi = Math.max(...cols.map(c => c.width))
  for (let i = 0; i < 30 && hi - lo > 0.5; i++) {
    const mid = (lo + hi) / 2
    if (sized(mid) > limit) hi = mid
    else lo = mid
  }
  const ceiling = Math.floor(lo)
  const out: Record<string, number> = {}
  for (const c of cols) {
    if (c.fixed) continue
    const w = Math.min(c.width, Math.max(ceiling, c.minWidth))
    if (w < c.width) out[c.id] = w
  }
  return out
}
