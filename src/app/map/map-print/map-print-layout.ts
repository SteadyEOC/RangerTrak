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
 * 2026-10-01, John: E-152b (third pass) - fanning, the way Leaflet.markercluster spiderfies a
 * cluster, but compact: markers are grouped transitively (single linkage) when their true points
 * are within 1.5 icon widths, and each group is laid out round its centroid on the smallest
 * circle the icons fit on (up to 8), or on an Archimedean spiral (more than 8). Members take the
 * slots in the order of the angle from the centroid to their own true point, turned to whichever
 * start gives the shortest leaders, so the leaders do not cross. Nothing grows to dodge
 * something: if a fanned icon lands on a marker outside its group, that group is merged into
 * this one and the lot laid out again (three passes at most). The minutes badges are not
 * markers; each group's start angle is turned to keep icons off them where it can.
 */

/** A marker's printed icon is this wide unless the caller measures it (28 px at 75%). */
export const PRINT_ICON_PX = 21
/** Gap kept between neighbouring icons on a fan. */
const FAN_GAP_PX = 3
/** Most icons on a single circle; beyond this the group goes on a spiral. */
const FAN_MAX_ON_CIRCLE = 8

export interface FanOptions {
  /** Printed icon width, container px. */
  icon?: number
  /** Boxes that stay put and should not be fanned onto (the minutes badges). */
  fixed?: readonly PrintRect[]
}

export interface FanPlan {
  /** Final container position of every input point, same order (lone markers stay put). */
  positions: PrintPoint[]
  /** Groups of two or more, as indexes into the input, with the centre their fan is drawn round. */
  groups: { members: number[], centre: PrintPoint }[]
}

/** Single-linkage grouping: points within `threshold` of ANY member share a group. Groups in input order. */
export function groupClosePoints(points: readonly PrintPoint[], threshold: number): number[][] {
  const parent = points.map((_, i) => i)
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]))
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      if (Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y) <= threshold) {
        parent[find(b)] = find(a)
      }
    }
  }
  const byRoot = new Map<number, number[]>()
  points.forEach((_, i) => {
    const root = find(i)
    byRoot.set(root, [...(byRoot.get(root) ?? []), i])
  })
  return [...byRoot.values()]
}

/** Clockwise angle from 12 o'clock, 0 to 2 pi. */
const clockAngle = (from: PrintPoint, to: PrintPoint): number => {
  const a = Math.atan2(to.x - from.x, -(to.y - from.y))
  return a < 0 ? a + 2 * Math.PI : a
}

/**
 * The slots for `count` icons round `centre`: one circle just big enough for the icons not to
 * touch (circumference rule, never under 1.2 icon widths), else markercluster's spiral. Sorted
 * clockwise from 12 o'clock.
 */
export function fanSlots(centre: PrintPoint, count: number, icon = PRINT_ICON_PX, turn = 0): PrintPoint[] {
  const slots: PrintPoint[] = []
  if (count <= FAN_MAX_ON_CIRCLE) {
    const radius = Math.max(count * (icon + FAN_GAP_PX) / (2 * Math.PI), 1.2 * icon)
    for (let i = 0; i < count; i++) {
      const angle = turn + 2 * Math.PI * i / count
      slots.push({ x: centre.x + radius * Math.sin(angle), y: centre.y - radius * Math.cos(angle) })
    }
  } else {
    // An Archimedean spiral like markercluster's _generatePointsSpiral, started at the circle's
    // minimum radius and widening by one icon (and gap) per turn; each step is one icon along
    // the curve.
    const footprint = 1.3 * icon // roomier than the circle: square icons touch on a diagonal
    const start = 1.2 * icon
    let angle = 0
    for (let i = 0; i < count; i++) {
      const leg = start + footprint * angle / (2 * Math.PI)
      slots.push({ x: centre.x + leg * Math.sin(angle + turn), y: centre.y - leg * Math.cos(angle + turn) })
      angle += footprint / leg
    }
  }
  return slots.sort((a, b) => clockAngle(centre, a) - clockAngle(centre, b))
}

const iconBox = (p: PrintPoint, icon: number): PrintRect =>
  ({ left: p.x - icon / 2, top: p.y - icon / 2, right: p.x + icon / 2, bottom: p.y + icon / 2 })

/** Lays one group out: where each member goes (parallel to `members`). */
function layoutGroup(points: readonly PrintPoint[], members: number[], centre: PrintPoint, icon: number,
  fixed: readonly PrintRect[]): PrintPoint[] {
  const n = members.length
  const step = 2 * Math.PI / n
  // Members in clockwise order of the angle from the centroid to their own true point.
  const order = members.map((m, k) => ({ k, angle: clockAngle(centre, points[m]) })).sort((a, b) => a.angle - b.angle)
  let best: { cost: number, spots: PrintPoint[] } | null = null
  const turns = n <= FAN_MAX_ON_CIRCLE ? [0, 0.25, 0.5, 0.75].map(f => f * step) : [0]
  for (const turn of turns) {
    const slots = fanSlots(centre, n, icon, turn)
    for (let shift = 0; shift < n; shift++) {
      const spots = new Array<PrintPoint>(n)
      let length = 0
      order.forEach((o, rank) => {
        const slot = slots[(rank + shift) % n]
        spots[o.k] = slot
        length += Math.hypot(slot.x - points[members[o.k]].x, slot.y - points[members[o.k]].y)
      })
      const blocked = spots.filter(s => fixed.some(f => rectsOverlap(iconBox(s, icon), f))).length
      const cost = length + blocked * 1000
      if (!best || cost < best.cost) {
        best = { cost, spots }
      }
    }
  }
  return best!.spots
}

export function planFans(points: readonly PrintPoint[], options: FanOptions = {}): FanPlan {
  const icon = options.icon ?? PRINT_ICON_PX
  const fixed = options.fixed ?? []
  const threshold = 1.5 * icon
  let groups = groupClosePoints(points, threshold)
  let positions = points.map(p => ({ ...p }))
  let plans: { members: number[], centre: PrintPoint }[] = []

  for (let pass = 0; pass < 4; pass++) {
    positions = points.map(p => ({ ...p }))
    plans = groups.filter(g => g.length > 1).map(members => ({
      members,
      centre: {
        x: members.reduce((sum, i) => sum + points[i].x, 0) / members.length,
        y: members.reduce((sum, i) => sum + points[i].y, 0) / members.length,
      },
    }))
    for (const g of plans) {
      layoutGroup(points, g.members, g.centre, icon, fixed).forEach((p, k) => positions[g.members[k]] = p)
    }
    // A fanned icon on a marker outside its group: merge the two groups and lay out again.
    const groupOf = new Map<number, number>()
    groups.forEach((g, gi) => g.forEach(i => groupOf.set(i, gi)))
    const merge = new Set<string>()
    for (const g of plans) {
      for (const i of g.members) {
        const box = iconBox(positions[i], icon)
        positions.forEach((p, j) => {
          if (groupOf.get(j) !== groupOf.get(i) && rectsOverlap(box, iconBox(p, icon))) {
            const [x, y] = [groupOf.get(i)!, groupOf.get(j)!].sort((a, b) => a - b)
            merge.add(`${x},${y}`)
          }
        })
      }
    }
    if (!merge.size || pass === 3) {
      break
    }
    const parent = groups.map((_, gi) => gi)
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]))
    merge.forEach(key => {
      const [x, y] = key.split(',').map(Number)
      parent[find(y)] = find(x)
    })
    const merged = new Map<number, number[]>()
    groups.forEach((g, gi) => merged.set(find(gi), [...(merged.get(find(gi)) ?? []), ...g]))
    groups = [...merged.values()].map(g => g.sort((a, b) => a - b))
  }
  return { positions, groups: plans }
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

/**
 * 2026-10-01, John: E-152b - the minutes badges ride with their ranger's newest report on the
 * printed sheet: each sits on its own icon the way it does on screen (above it, overlapping the
 * top edge by `BADGE_OVERLAP_PX`). If that spot collides with another badge, another report's
 * icon or a Location icon, it tries the other side of its icon (below, then left, then right);
 * if some badge still cannot find a clear side, every badge shrinks a step (the common `scale`,
 * down to a floor) and the sides are tried again. Deterministic: badges in input order, sides
 * in a fixed order, scales from large to small.
 */
export type BadgeSide = 'top' | 'bottom' | 'left' | 'right'

/** How far a badge's near edge sits from the icon's centre; the screen's own offset. */
export const BADGE_OVERLAP_PX = 8
/** The common scales tried, as fractions of the printed badge size (the last is about 6 pt of 7.2). */
export const BADGE_SCALES: readonly number[] = [1, 0.92, 0.83]

export interface BadgeInput {
  /** Index into `icons` of the report icon this badge belongs to. */
  iconIndex: number
  /** The badge's size at scale 1. */
  size: { width: number, height: number }
}

export interface BadgePlan { sides: BadgeSide[], scale: number }

const BADGE_SIDES: readonly BadgeSide[] = ['top', 'bottom', 'left', 'right']

/** The box a badge of `size` takes on `side` of `icon`. */
export function badgeRect(icon: PrintRect, size: { width: number, height: number }, side: BadgeSide): PrintRect {
  const cx = (icon.left + icon.right) / 2
  const cy = (icon.top + icon.bottom) / 2
  switch (side) {
    case 'top': return { left: cx - size.width / 2, right: cx + size.width / 2, bottom: cy - BADGE_OVERLAP_PX, top: cy - BADGE_OVERLAP_PX - size.height }
    case 'bottom': return { left: cx - size.width / 2, right: cx + size.width / 2, top: cy + BADGE_OVERLAP_PX, bottom: cy + BADGE_OVERLAP_PX + size.height }
    case 'left': return { right: cx - BADGE_OVERLAP_PX, left: cx - BADGE_OVERLAP_PX - size.width, top: cy - size.height / 2, bottom: cy + size.height / 2 }
    case 'right': return { left: cx + BADGE_OVERLAP_PX, right: cx + BADGE_OVERLAP_PX + size.width, top: cy - size.height / 2, bottom: cy + size.height / 2 }
  }
}

/**
 * Chooses a side for every badge and a common scale. `icons` are all report icon boxes on the
 * map; `fixed` are other things a badge must not cover (Location icons).
 */
export function planBadges(badges: readonly BadgeInput[], icons: readonly PrintRect[],
  fixed: readonly PrintRect[] = []): BadgePlan {
  let fallback: BadgePlan | null = null
  for (const scale of BADGE_SCALES) {
    const placed: PrintRect[] = []
    const sides: BadgeSide[] = []
    let allClear = true
    for (const badge of badges) {
      const size = { width: badge.size.width * scale, height: badge.size.height * scale }
      const clashes = (rect: PrintRect) =>
        icons.filter((icon, i) => i !== badge.iconIndex && rectsOverlap(rect, icon)).length
        + fixed.filter(f => rectsOverlap(rect, f)).length
        + placed.filter(p => rectsOverlap(rect, p)).length
      let chosen: { side: BadgeSide, rect: PrintRect, clashes: number } | null = null
      for (const side of BADGE_SIDES) {
        const rect = badgeRect(icons[badge.iconIndex], size, side)
        const count = clashes(rect)
        if (!chosen || count < chosen.clashes) {
          chosen = { side, rect, clashes: count }
        }
        if (count === 0) {
          break
        }
      }
      sides.push(chosen!.side)
      placed.push(chosen!.rect)
      if (chosen!.clashes > 0) {
        allClear = false
      }
    }
    fallback = { sides, scale }
    if (allClear) {
      return fallback
    }
  }
  return fallback ?? { sides: [], scale: 1 }
}
