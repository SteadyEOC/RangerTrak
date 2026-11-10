import type { AttachmentRef } from '../../domain/attachments'
import { placePreview, previewRefs } from './attachment-hover-preview'

/** E-194: the hover preview's pure rules. */
describe('attachment hover preview', () => {
  const ref = (n: number, over: Partial<AttachmentRef> = {}): AttachmentRef => ({
    sha256: String(n).repeat(64),
    name: `f${n}.jpg`,
    type: 'image/jpeg',
    size: 1,
    addedAt: '2026-10-16T10:00:00.000Z',
    addedBy: 'K7ABC',
    ...over,
  })

  describe('previewRefs', () => {
    it('shows live refs in entry order and counts the rest', () => {
      const r = previewRefs({ attachments: [1, 2, 3, 4, 5, 6].map((n) => ref(n)) })
      expect(r.shown.map((x) => x.name)).toEqual(['f1.jpg', 'f2.jpg', 'f3.jpg', 'f4.jpg'])
      expect(r.more).toBe(2)
    })
    it('skips removed refs', () => {
      const r = previewRefs({
        attachments: [ref(1), ref(2, { removed: { at: 'x', by: 'y' } }), ref(3)],
      })
      expect(r.shown.map((x) => x.name)).toEqual(['f1.jpg', 'f3.jpg'])
      expect(r.more).toBe(0)
    })
    it('is empty for no entry', () => {
      expect(previewRefs(undefined)).toEqual({ shown: [], more: 0 })
    })
  })

  describe('placePreview', () => {
    const vp = { width: 1000, height: 800 }
    const panel = { width: 200, height: 150 }
    const chip = (left: number, top: number) => ({
      left,
      top,
      right: left + 40,
      bottom: top + 20,
    })

    it('sits to the right of the chip, top-aligned', () => {
      expect(placePreview(chip(100, 100), panel, vp)).toEqual({ top: 100, left: 148 })
    })
    it('flips to the left near the right edge', () => {
      expect(placePreview(chip(900, 100), panel, vp)).toEqual({
        top: 100,
        left: 900 - 8 - 200,
      })
    })
    it('lifts so its bottom meets the chip bottom near the bottom edge', () => {
      expect(placePreview(chip(100, 780), panel, vp).top).toBe(800 - 8 - 150)
    })
    it('never leaves the viewport', () => {
      const p = placePreview(chip(0, 0), { width: 990, height: 790 }, vp)
      expect(p.left).toBeGreaterThanOrEqual(8)
      expect(p.top).toBeGreaterThanOrEqual(8)
      expect(p.left + 990).toBeLessThanOrEqual(1000)
    })
  })
})
