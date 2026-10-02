import {
  choosePanelSpot, fanPositions, groupClosePoints, rectsOverlap, segmentCrossesRect, PrintRect,
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
    it('groups points within 18 px and keeps input order', () => {
      const pts = [{ x: 100, y: 100 }, { x: 300, y: 300 }, { x: 108, y: 105 }, { x: 112, y: 112 }, { x: 301, y: 310 }]
      expect(groupClosePoints(pts)).toEqual([[0, 2, 3], [1, 4]])
    })
    it('chains through a member, not only the first point', () => {
      const pts = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 30, y: 0 }]
      expect(groupClosePoints(pts)).toEqual([[0, 1, 2]])
    })
    it('leaves distant points alone', () => {
      expect(groupClosePoints([{ x: 0, y: 0 }, { x: 50, y: 0 }])).toEqual([[0], [1]])
    })
  })

  describe('fanPositions', () => {
    it('starts at 12 o\'clock and goes clockwise', () => {
      const [a, b, c, d] = fanPositions({ x: 100, y: 100 }, 4)
      expect(a.x).toBeCloseTo(100)
      expect(a.y).toBeLessThan(100)    // 12 o'clock (y grows downward)
      expect(b.x).toBeGreaterThan(100) // 3 o'clock
      expect(c.y).toBeGreaterThan(100) // 6 o'clock
      expect(d.x).toBeLessThan(100)    // 9 o'clock
    })
    it('keeps every icon on one circle and apart from its neighbours', () => {
      for (const n of [2, 3, 5, 9, 14]) {
        const pts = fanPositions({ x: 0, y: 0 }, n)
        const radius = Math.hypot(pts[0].x, pts[0].y)
        expect(radius).toBeGreaterThanOrEqual(22 - 1e-9)
        pts.forEach(p => expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 6))
        if (n > 2) {
          for (let i = 0; i < n; i++) {
            const q = pts[(i + 1) % n]
            expect(Math.hypot(pts[i].x - q.x, pts[i].y - q.y)).toBeGreaterThanOrEqual(28)
          }
        }
      }
    })
    it('leaves a lone marker where it is', () => {
      expect(fanPositions({ x: 5, y: 6 }, 1)).toEqual([{ x: 5, y: 6 }])
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
