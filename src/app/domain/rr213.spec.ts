import { describe, expect, it } from 'vitest'
import { RR213_LINE_SLOTS, RR213_MAX_LINES, RR213_SLOT, rr213LineTabIndex, rr213SpareTabIndexes } from './rr213'

describe('rr213 tab stops (E-283)', () => {
  const start = 100

  // Every number from `start` up, in DOM order: the drawn lines' stops, then the spare placeholders.
  function domOrder(lineCount: number): number[] {
    const drawn: number[] = []
    for (let i = 0; i < lineCount; i++) {
      for (let s = 0; s < RR213_LINE_SLOTS; s++) {
        if (s === RR213_SLOT.remove && lineCount <= 1) continue
        drawn.push(rr213LineTabIndex(start, i, s))
      }
    }
    return [...drawn, ...rr213SpareTabIndexes(start, lineCount)]
  }

  it('every line count gives unique, ascending, gap-free tab stops covering all nine lines', () => {
    for (let n = 1; n <= RR213_MAX_LINES; n++) {
      const stops = domOrder(n)
      expect(stops.length).toBe(RR213_MAX_LINES * RR213_LINE_SLOTS)
      expect(stops).toEqual(stops.map((_, i) => start + i))
    }
  })

  it('a second line gets its own numbers after the first line, not the page end', () => {
    expect(rr213LineTabIndex(start, 1, RR213_SLOT.qty)).toBe(start + RR213_LINE_SLOTS)
    expect(rr213LineTabIndex(start, 1, RR213_SLOT.qty)).toBeGreaterThan(rr213LineTabIndex(start, 0, RR213_SLOT.neededBy))
    expect(rr213SpareTabIndexes(start, 2)).not.toContain(rr213LineTabIndex(start, 1, RR213_SLOT.qty))
    expect(rr213SpareTabIndexes(start, 1)).toContain(rr213LineTabIndex(start, 0, RR213_SLOT.remove))
  })
})
