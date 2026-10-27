import type { Column, GridApi } from 'ag-grid-community'

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
 * association between fields" - start at no more than 1.5 screen widths. Fit to screen is 1.
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

/** A content-sized grid starts at most this many visible widths wide (John 2026-10-27). */
export const GRID_MAX_SCREENS = 1.5

/**
 * Trims a grid's widest columns so it is at most `screens` visible widths in total. Call it after
 * an auto-size (a ColumnResizedEvent with source 'autosizeColumns') and when the grid resizes.
 */
export function capGridToScreens(api: GridApi | undefined, screens: number): void {
  if (!api) return
  const range = api.getHorizontalPixelRange()
  const visible = range.right - range.left
  // A grid still laying out reports a sliver of its width; a cap taken then would crush every column.
  if (visible < 320) return
  // A column still flexing counts at its minimum: it grows back into whatever room is left after.
  // Ask the column, not its definition: autoSizeAllColumns() sizes Notes from content too, and
  // AG Grid then drops its flex although the definition still says `flex: 1`.
  const cols = (api.getAllDisplayedColumns() as Column[]).map(c => {
    const minWidth = c.getColDef().minWidth ?? 60
    const flex = !!c.getFlex()
    return { id: c.getColId(), width: flex ? minWidth : c.getActualWidth(), minWidth, fixed: flex }
  })
  const widths = Object.entries(capColumnWidths(cols, visible * screens))
  if (widths.length) {
    api.setColumnWidths(widths.map(([key, newWidth]) => ({ key, newWidth })))
    return
  }
  // Short of the screen: the column defined as flex takes the slack, since autoSizeAllColumns()
  // cleared its flex (John's screenshot: a blank band right of Evidence on a wide window).
  const all = api.getAllDisplayedColumns() as Column[]
  const short = visible - all.reduce((s, c) => s + c.getActualWidth(), 0)
  const stretch = all.find(c => c.getColDef().flex && !c.getFlex())
  if (short > 1 && stretch) api.setColumnWidths([{ key: stretch.getColId(), newWidth: stretch.getActualWidth() + short }])
}
