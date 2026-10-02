import {
  choosePanelSpot, fanSlots, groupClosePoints, planBadges, badgeRect, planFans, rectsOverlap, segmentCrossesRect, PrintRect,
} from './map-print-layout'

describe('map print layout', () => {
  describe('rectsOverlap', () => {
    const r: PrintRect = { left: 0, top: 0, right: 10, bottom: 10 }
    it('detects overlap and separation', () => {
      expect(rectsOverlap(r, { left: 5, top: 5, right: 15, bottom: 15 })).toBeTrue()
      expect(rectsOverlap(r, { left: 10, top: 0, right: 20, bottom: 10 })).toBeFalse() // edges touching
      expect(rectsOverlap(r, { left: 20, top: 20, right: 30, bottom: 30 })).toBeFalse()
    })
  })

  describe('segmentCrossesRect', () => {
    const r: PrintRect = { left: 10, top: 10, right: 20, bottom: 20 }
    it('crosses, misses and sits inside', () => {
      expect(segmentCrossesRect({ x: 0, y: 15 }, { x: 30, y: 15 }, r)).toBeTrue()
      expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 30, y: 5 }, r)).toBeFalse()
      expect(segmentCrossesRect({ x: 12, y: 12 }, { x: 18, y: 18 }, r)).toBeTrue()
      expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 8, y: 30 }, r)).toBeFalse()
    })
  })

  describe('groupClosePoints', () => {
    it('groups transitively within the threshold and keeps input order', () => {
      const pts = [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 125, y: 100 }, { x: 150, y: 100 }, { x: 301, y: 310 }]
      expect(groupClosePoints(pts, 30)).toEqual([[0, 2, 3], [1, 4]]) // 0-2 and 2-3 are 25 apart; 0-3 is 50
    })
    it('leaves distant points alone', () => {
      expect(groupClosePoints([{ x: 0, y: 0 }, { x: 50, y: 0 }], 30)).toEqual([[0], [1]])
    })
  })

  describe('fanSlots', () => {
    const centre = { x: 100, y: 100 }
    it('puts up to 8 icons on one circle, just wide enough not to touch', () => {
      const slots = fanSlots(centre, 5)
      const radius = Math.hypot(slots[0].x - 100, slots[0].y - 100)
      expect(radius).toBeGreaterThanOrEqual(1.2 * 21 - 1e-9)
      slots.forEach(s => expect(Math.hypot(s.x - 100, s.y - 100)).toBeCloseTo(radius, 6))
      for (let i = 0; i < 5; i++) {
        const q = slots[(i + 1) % 5]
        expect(Math.hypot(slots[i].x - q.x, slots[i].y - q.y)).toBeGreaterThanOrEqual(21)
      }
    })
    it('starts at 12 o\'clock and goes clockwise', () => {
      const [a, b, c, d] = fanSlots(centre, 4)
      expect(a.x).toBeCloseTo(100); expect(a.y).toBeLessThan(100)
      expect(b.x).toBeGreaterThan(100)
      expect(c.y).toBeGreaterThan(100)
      expect(d.x).toBeLessThan(100)
    })
    it('uses a spiral beyond 8, with every icon clear of the others', () => {
      const slots = fanSlots(centre, 14)
      expect(slots.length).toBe(14)
      for (let a = 0; a < 14; a++) {
        for (let b = a + 1; b < 14; b++) {
          expect(Math.hypot(slots[a].x - slots[b].x, slots[a].y - slots[b].y)).withContext(`${a},${b}`).toBeGreaterThan(18)
        }
      }
    })
  })

  describe('planFans', () => {
    const box = (p: { x: number, y: number }): PrintRect => ({ left: p.x - 10.5, top: p.y - 10.5, right: p.x + 10.5, bottom: p.y + 10.5 })
    const pile = (x: number, y: number, n: number) => Array.from({ length: n }, (_, i) => ({ x: x + i * 0.5, y }))
    const noOverlaps = (positions: { x: number, y: number }[]) => {
      for (let a = 0; a < positions.length; a++) {
        for (let b = a + 1; b < positions.length; b++) {
          expect(rectsOverlap(box(positions[a]), box(positions[b]))).withContext(`icons ${a} and ${b}`).toBeFalse()
        }
      }
    }

    it('leaves lone markers where they are', () => {
      const plan = planFans([{ x: 10, y: 10 }, { x: 200, y: 200 }])
      expect(plan.groups).toEqual([])
      expect(plan.positions).toEqual([{ x: 10, y: 10 }, { x: 200, y: 200 }])
    })

    it('keeps a fan compact: icons close to their true points', () => {
      const pts = pile(100, 100, 5)
      const plan = planFans(pts)
      noOverlaps(plan.positions)
      plan.positions.forEach(p => expect(Math.hypot(p.x - 100, p.y - 100)).toBeLessThan(35))
    })

    it('merges adjacent groups whose fans would collide, instead of growing', () => {
      const pts = [...pile(100, 100, 5), ...pile(100, 140, 5)] // 40 px apart: separate groups, colliding fans
      const plan = planFans(pts)
      expect(plan.groups.length).toBe(1)
      expect(plan.groups[0].members.length).toBe(10)
      noOverlaps(plan.positions)
      plan.positions.forEach(p => expect(Math.hypot(p.x - 100, p.y - 120)).toBeLessThan(60))
    })

    it('orders icons by the angle to their own true points, so leaders do not cross', () => {
      // True points at N, E, S, W of the centroid, handed over in a scrambled order.
      const pts = [{ x: 120, y: 100 }, { x: 100, y: 80 }, { x: 80, y: 100 }, { x: 100, y: 120 }]
      const plan = planFans(pts)
      const c = { x: 100, y: 100 }
      const sector = (p: { x: number, y: number }) => Math.abs(p.x - c.x) > Math.abs(p.y - c.y) ? (p.x > c.x ? 'E' : 'W') : (p.y < c.y ? 'N' : 'S')
      expect(plan.positions.map(sector)).toEqual(['E', 'N', 'W', 'S'])
    })

    it('turns a fan away from a fixed obstacle such as a minutes badge, as far as it can', () => {
      const badge = { left: 88, top: 70, right: 112, bottom: 88 }
      const hits = (positions: { x: number, y: number }[]) => positions.filter(p => rectsOverlap(box(p), badge)).length
      const pts = pile(100, 100, 5)
      expect(hits(planFans(pts, { fixed: [badge] }).positions)).toBeLessThan(hits(planFans(pts).positions))
    })

    it('merges a lone marker the fan would land on', () => {
      const pts = [...pile(100, 100, 3), { x: 100, y: 62 }] // lone marker where a 12 o'clock icon goes
      const plan = planFans(pts)
      noOverlaps(plan.positions)
    })
  })

  describe('planBadges', () => {
    // Two report icons side by side, 21 px wide and 22 px apart centre to centre, each with a 16x12 badge.
    const icon = (cx: number, cy: number): PrintRect => ({ left: cx - 10.5, top: cy - 10.5, right: cx + 10.5, bottom: cy + 10.5 })
    const size = { width: 16, height: 12 }

    it('keeps every badge above its own icon when nothing is in the way', () => {
      const plan = planBadges([{ iconIndex: 0, size }, { iconIndex: 1, size }], [icon(100, 100), icon(200, 100)])
      expect(plan).toEqual({ sides: ['top', 'top'], scale: 1 })
    })

    it('moves a badge to another side when it would land on a neighbouring icon', () => {
      // A third icon sits right above the first one's top badge position.
      const icons = [icon(100, 100), icon(100, 78)]
      const plan = planBadges([{ iconIndex: 0, size }], icons)
      expect(plan.sides[0]).toBe('bottom')
      expect(plan.scale).toBe(1)
    })

    it('puts two badges on adjacent fanned icons on different sides, or shrinks, never overlapping', () => {
      const icons = [icon(100, 100), icon(112, 100)] // icons 12 px apart: top badges (16 wide) would collide
      const plan = planBadges([{ iconIndex: 0, size }, { iconIndex: 1, size }], icons)
      const s = { width: size.width * plan.scale, height: size.height * plan.scale }
      const rects = plan.sides.map((side, i) => badgeRect(icons[i], s, side))
      expect(plan.sides[0] === 'top' && plan.sides[1] === 'top' && plan.scale === 1).toBeFalse()
      expect(rectsOverlap(rects[0], rects[1])).toBeFalse()
    })

    it('avoids a fixed Location icon', () => {
      const fixed = [{ left: 88, top: 70, right: 112, bottom: 90 }]
      const plan = planBadges([{ iconIndex: 0, size }], [icon(100, 100)], fixed)
      expect(plan.sides[0]).not.toBe('top')
    })

    it('shrinks all badges, to the floor, when no side is clear', () => {
      const wall = [{ left: 0, top: 0, right: 300, bottom: 300 }]
      const plan = planBadges([{ iconIndex: 0, size }], [icon(100, 100)], wall)
      expect(plan.scale).toBe(0.83)
    })
  })

  describe('choosePanelSpot', () => {
    const base = {
      container: { width: 1000, height: 600 }, panel: { width: 200, height: 100 }, inset: 10,
      hard: [] as PrintRect[], soft: [] as PrintRect[],
      segments: [] as readonly (readonly [{ x: number, y: number }, { x: number, y: number }])[],
    }

    it('takes the top-left corner when nothing is in the way', () => {
      expect(choosePanelSpot(base)).toEqual({ left: 10, top: 10 })
    })

    it('never covers a hard obstacle', () => {
      const hard = [{ left: 0, top: 0, right: 300, bottom: 200 }]
      const got = choosePanelSpot({ ...base, hard })!
      expect(got).toEqual({ left: 10, top: 490 }) // bottom-left corner: next candidate that is clear
      expect(rectsOverlap({ left: got.left, top: got.top, right: got.left + 200, bottom: got.top + 100 }, hard[0])).toBeFalse()
    })

    it('prefers the spot with fewer ring labels and trail crossings', () => {
      const soft = [{ left: 20, top: 20, right: 60, bottom: 40 }] // under top-left
      const segments = [[{ x: 700, y: 0 }, { x: 990, y: 300 }] as const] // through top-right
      expect(choosePanelSpot({ ...base, soft, segments })).toEqual({ left: 10, top: 490 }) // bottom-left, free of both
    })

    it('can slide along an edge to a gap between obstacles', () => {
      const hard = [
        { left: 0, top: 0, right: 330, bottom: 600 }, { left: 670, top: 0, right: 1000, bottom: 600 },
      ]
      const got = choosePanelSpot({ ...base, hard })!
      expect(got.left).toBeGreaterThanOrEqual(330)
      expect(got.left + 200).toBeLessThanOrEqual(670)
    })

    it('finds clear room away from the edges when every edge spot is blocked', () => {
      // A frame of obstacles round the whole map; the middle is free.
      const hard = [
        { left: 0, top: 0, right: 1000, bottom: 120 }, { left: 0, top: 480, right: 1000, bottom: 600 },
        { left: 0, top: 0, right: 40, bottom: 600 }, { left: 960, top: 0, right: 1000, bottom: 600 },
      ]
      const got = choosePanelSpot({ ...base, hard })!
      expect(got).not.toBeNull()
      expect(rectsOverlap({ left: got.left, top: got.top, right: got.left + 200, bottom: got.top + 100 }, hard[0])).toBeFalse()
      expect(got.top).toBeGreaterThanOrEqual(120)
      expect(got.top + 100).toBeLessThanOrEqual(480)
    })

    it('sits above the bottom credits when told how tall they are', () => {
      const got = choosePanelSpot({ ...base, bottomExtra: 30, hard: [{ left: 0, top: 0, right: 1000, bottom: 300 }] })!
      expect(got.top + 100).toBeLessThanOrEqual(600 - 10 - 30)
    })

    it('returns null when every spot would cover a marker', () => {
      const hard = [{ left: 0, top: 0, right: 1000, bottom: 600 }]
      expect(choosePanelSpot({ ...base, hard })).toBeNull()
    })

    it('returns null for a panel bigger than the map', () => {
      expect(choosePanelSpot({ ...base, panel: { width: 990, height: 100 } })).toBeNull()
    })
  })
})
