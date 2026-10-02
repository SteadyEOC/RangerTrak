/**
 * 2026-10-01, John: E-152b - the geometry behind the printed Leaflet sheet, kept free of
 * Leaflet and the DOM so it can be unit tested. The map component measures what is on the
 * sheet (marker boxes, panels, trails) in container pixels and hands the numbers to these
 * functions; they only decide, and the component applies the answer.
 *
 * Two jobs: fanning markers that sit on top of each other out around their true spot (like a
 * callout infographic), and choosing where the title and legend panels float on the map
 * without covering a marker.
 */

export interface PrintPoint { x: number, y: number }
/** A box in container pixels. */
export interface PrintRect { left: number, top: number, right: number, bottom: number }

/** Markers closer than this (container px) fan out together. */
export const FAN_GROUP_PX = 18
/** Smallest fan circle radius (px); grows with the count so the icons never touch. */
export const FAN_MIN_RADIUS_PX = 22
/** Room each fanned icon is given along the circle: a 28 px icon plus a gap. */
const FAN_ICON_SPACING_PX = 32

export function rectsOverlap(a: PrintRect, b: PrintRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

export function padRect(r: PrintRect, pad: number): PrintRect {
  return { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad }
}

/** Whether the segment a-b touches the rectangle (Liang-Barsky clipping). */
export function segmentCrossesRect(a: PrintPoint, b: PrintPoint, r: PrintRect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  return clip(-dx, a.x - r.left) && clip(dx, r.right - a.x)
    && clip(-dy, a.y - r.top) && clip(dy, r.bottom - a.y)
}

/**
 * Greedy grouping: each point joins the first existing group that has a member within
 * `threshold` px, otherwise starts its own. Returns groups of indexes into `points`, in
 * input order, so a group's members stay in radio-log order.
 */
export function groupClosePoints(points: readonly PrintPoint[], threshold = FAN_GROUP_PX): number[][] {
  const groups: number[][] = []
  points.forEach((p, i) => {
    const home = groups.find(g => g.some(j => Math.hypot(points[j].x - p.x, points[j].y - p.y) <= threshold))
    if (home) {
      home.push(i)
    } else {
      groups.push([i])
    }
  })
  return groups
}

/**
 * Where each of `count` markers goes on the fan around `centre`: evenly round a circle,
 * the first at 12 o'clock (turned by `turn` radians) and the rest clockwise. The radius
 * grows with the count, plus `radiusExtra` px.
 */
export function fanPositions(centre: PrintPoint, count: number, radiusExtra = 0, turn = 0): PrintPoint[] {
  if (count < 2) {
    return [{ ...centre }]
  }
  const radius = radiusExtra + Math.max(FAN_MIN_RADIUS_PX, FAN_ICON_SPACING_PX / 2 / Math.sin(Math.PI / count))
  return Array.from({ length: count }, (_, i) => {
    const angle = turn + 2 * Math.PI * i / count
    return { x: centre.x + radius * Math.sin(angle), y: centre.y - radius * Math.cos(angle) }
  })
}

/** Half the width of a marker icon (28 px) plus a little air, for fan collision checks. */
const FAN_ICON_HALF_PX = 15

export interface FanPlan {
  /** Final container position of every input point, same order (lone markers stay put). */
  positions: PrintPoint[]
  /** Groups of two or more, as indexes into the input, with the centre their fan is drawn round. */
  groups: { members: number[], centre: PrintPoint }[]
}

const iconBox = (p: PrintPoint): PrintRect =>
  ({ left: p.x - FAN_ICON_HALF_PX, top: p.y - FAN_ICON_HALF_PX, right: p.x + FAN_ICON_HALF_PX, bottom: p.y + FAN_ICON_HALF_PX })

/**
 * 2026-10-01, John: E-152b (review fix) - fans every group of close markers, and keeps the fans
 * off each other: a fan's icons may not land on another group's icons, on a lone marker, or on
 * anything in `fixed` (the minutes badges and Location icons, which stay at their true spots).
 *
 * Each group is first fanned at its default radius, starting at 12 o'clock. A group that
 * collides then tries bigger radii (8 px steps) and, at each radius, start angles turned by a
 * quarter, half and three quarters of a step, and takes the first that is clear of everything
 * else as it stands. Two sweeps over the groups, so a group moved in the first sweep can still
 * make room for one that follows. If nothing clears, the group keeps the candidate that
 * collides least; the map is never printed with a marker dropped. Each marker keeps a leader to
 * its OWN true point (the caller draws them), so groups are never merged.
 */
export function planFans(points: readonly PrintPoint[], fixed: readonly PrintRect[] = []): FanPlan {
  const positions = points.map(p => ({ ...p }))
  const groups = groupClosePoints(points).filter(g => g.length > 1).map(members => ({
    members,
    centre: {
      x: members.reduce((sum, i) => sum + points[i].x, 0) / members.length,
      y: members.reduce((sum, i) => sum + points[i].y, 0) / members.length,
    },
  }))
  const place = (g: typeof groups[number], radiusExtra: number, turn: number) =>
    fanPositions(g.centre, g.members.length, radiusExtra, turn)
  groups.forEach(g => place(g, 0, 0).forEach((p, k) => positions[g.members[k]] = p))

  // How many of group g's icons, at candidate spots, overlap something else.
  const collisions = (g: typeof groups[number], spots: PrintPoint[]): number => {
    const mine = new Set(g.members)
    const others: PrintRect[] = [...fixed]
    positions.forEach((p, i) => { if (!mine.has(i)) others.push(iconBox(p)) })
    let count = 0
    spots.forEach((s, a) => {
      const box = iconBox(s)
      count += others.filter(o => rectsOverlap(box, o)).length
      for (let b = a + 1; b < spots.length; b++) {
        if (rectsOverlap(box, iconBox(spots[b]))) count++
      }
    })
    return count
  }

  for (let sweep = 0; sweep < 2; sweep++) {
    for (const g of groups) {
      if (collisions(g, g.members.map(i => positions[i])) === 0) {
        continue
      }
      const step = 2 * Math.PI / g.members.length
      let best: { spots: PrintPoint[], count: number } | null = null
      search:
      for (let extra = 0; extra <= 64; extra += 8) {
        for (const turn of [0, 0.5, 0.25, 0.75]) {
          const spots = place(g, extra, turn * step)
          const count = collisions(g, spots)
          if (!best || count < best.count) {
            best = { spots, count }
          }
          if (count === 0) {
            break search
          }
        }
      }
      best!.spots.forEach((p, k) => positions[g.members[k]] = p)
    }
  }
  return { positions, groups }
}

export interface PanelPlacementInput {
  /** The map frame's size, container px. */
  container: { width: number, height: number }
  /** The panel's rendered size, container px. */
  panel: { width: number, height: number }
  /** Gap kept to the frame's edge. */
  inset: number
  /**
   * Extra room kept clear along the bottom edge, for the scale bar and map credits that sit
   * there: panels sit above them rather than being ruled out of the bottom corners.
   */
  bottomExtra?: number
  /** Covering any of these is not allowed: markers, their badges, north arrow, scale bar, credits, other panel. */
  hard: readonly PrintRect[]
  /** Covering these is allowed but costs: range ring labels. */
  soft: readonly PrintRect[]
  /** Trail segments (container px); each one the panel crosses costs. */
  segments: readonly (readonly [PrintPoint, PrintPoint])[]
}

export interface PanelPlacement { left: number, top: number }

/**
 * Where along an edge a panel may sit, as a fraction of the free run: the corners first, then
 * the middle, then the quarter points. (Corners and edge middles were the first idea; the
 * quarter points give a crowded map a few more chances before a panel has to give up.)
 */
const ALONG: readonly number[] = [0, 1, 0.5, 0.25, 0.75]
/** Spacing of the fallback grid of candidate spots. */
const GRID_STEP_PX = 24

/** Every candidate box, in preference order: for each fraction, the top edge then the bottom edge, then the sides. */
export function panelCandidates(input: Pick<PanelPlacementInput, 'container' | 'panel' | 'inset' | 'bottomExtra'>): PrintRect[] {
  const { container: c, panel: p, inset: i } = input
  const bottom = i + (input.bottomExtra ?? 0)
  const freeX = c.width - 2 * i - p.width
  const freeY = c.height - i - bottom - p.height
  const boxes: PrintRect[] = []
  const box = (left: number, top: number) => boxes.push({ left, top, right: left + p.width, bottom: top + p.height })
  for (const f of ALONG) {
    box(i + freeX * f, i)                  // along the top edge
    box(i + freeX * f, i + freeY)          // along the bottom edge (above the credits)
  }
  for (const f of ALONG.slice(2)) {        // the corners are already covered above
    box(i, i + freeY * f)                  // down the left edge
    box(i + freeX, i + freeY * f)          // down the right edge
  }
  // Last, anywhere else on a coarse grid: a crowded map may have clear room only away from the
  // edges. Ties go to the earlier (edge) candidates above, so edges are still preferred.
  for (let y = 0; y <= freeY; y += GRID_STEP_PX) {
    for (let x = 0; x <= freeX; x += GRID_STEP_PX) {
      box(i + x, i + y)
    }
  }
  return boxes
}

/**
 * The best allowed spot, or null when every candidate would cover something in `hard` (or the
 * panel is bigger than the map). Among allowed spots the cheapest wins: a ring label costs 2,
 * a crossed trail segment 1, and the earlier candidate wins a tie (corners before the rest).
 */
export function choosePanelSpot(input: PanelPlacementInput): PanelPlacement | null {
  const { container: c, panel: p, inset } = input
  if (p.width + 2 * inset > c.width || p.height + 2 * inset + (input.bottomExtra ?? 0) > c.height) {
    return null
  }
  let best: { placement: PanelPlacement, cost: number } | null = null
  for (const rect of panelCandidates(input)) {
    if (input.hard.some(h => rectsOverlap(rect, h))) {
      continue
    }
    const cost = 2 * input.soft.filter(s => rectsOverlap(rect, s)).length
      + input.segments.filter(([a, b]) => segmentCrossesRect(a, b, rect)).length
    if (!best || cost < best.cost) {
      best = { placement: { left: rect.left, top: rect.top }, cost }
    }
  }
  return best?.placement ?? null
}
