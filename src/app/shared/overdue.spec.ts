import {
  DEFAULT_CHECK_IN_INTERVAL_MIN, OVERDUE_BAND_COUNT, OVERDUE_RED_MULTIPLE,
  elapsedMinutes, overdueBand,
} from './overdue'

describe('overdueBand', () => {
  const I = DEFAULT_CHECK_IN_INTERVAL_MIN // 30

  it('is colourless until the check-in is actually due', () => {
    expect(overdueBand(0, I)).toBe(0)
    expect(overdueBand(I - 1, I)).toBe(0)
  })

  it('enters band 1 exactly when the interval elapses', () => {
    expect(overdueBand(I, I)).toBe(1)
  })

  // The point of the whole feature: it must be able to go red. A ramp that never
  // reaches its top band would look like it was working while reporting nothing.
  it('reaches red at RED_MULTIPLE x the interval, and stays there', () => {
    expect(overdueBand(I * OVERDUE_RED_MULTIPLE, I)).toBe(OVERDUE_BAND_COUNT)
    expect(overdueBand(I * OVERDUE_RED_MULTIPLE + 1, I)).toBe(OVERDUE_BAND_COUNT)
    expect(overdueBand(I * 50, I)).toBe(OVERDUE_BAND_COUNT)
  })

  it('steps through every band in order, skipping none', () => {
    const seen = new Set<number>()
    for (let m = 0; m <= I * OVERDUE_RED_MULTIPLE; m++) seen.add(overdueBand(m, I))
    for (let b = 0; b <= OVERDUE_BAND_COUNT; b++) expect(seen.has(b)).withContext(`band ${b}`).toBe(true)
  })

  it('never returns a band outside 0..OVERDUE_BAND_COUNT', () => {
    for (let m = 0; m <= 1000; m += 7) {
      const b = overdueBand(m, I)
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(OVERDUE_BAND_COUNT)
    }
  })

  // With the default interval the ramp lands on the same round numbers the old
  // hard-coded version used, so a mission that keeps the default sees no change in feel -
  // except that red now arrives at 90 rather than the 80 the old arithmetic produced.
  it('puts the default mission on 30/40/50/60/70/80/90', () => {
    expect([30, 40, 50, 60, 70, 80, 90].map(m => overdueBand(m, I))).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('is relative: a shorter cycle goes red sooner, a longer one later', () => {
    expect(overdueBand(45, 15)).toBe(OVERDUE_BAND_COUNT)   // 15-min cycle: red at 45
    expect(overdueBand(45, 120)).toBe(0)                    // 2-hour cycle: not even due
    expect(overdueBand(360, 120)).toBe(OVERDUE_BAND_COUNT)  // ... red at 6h
  })

  it('treats a non-positive interval as "no cycle set" and disables escalation', () => {
    expect(overdueBand(10_000, 0)).toBe(0)
    expect(overdueBand(10_000, -5)).toBe(0)
  })
})

describe('elapsedMinutes', () => {
  const now = new Date('2026-09-22T12:00:00Z').getTime()

  it('measures whole minutes back from now', () => {
    expect(elapsedMinutes(new Date('2026-09-22T11:30:00Z'), now)).toBe(30)
  })

  it('accepts the string and number forms the stored log actually holds', () => {
    expect(elapsedMinutes('2026-09-22T11:00:00Z', now)).toBe(60)
    expect(elapsedMinutes(now - 90 * 60_000, now)).toBe(90)
  })

  it('clamps a future-dated report to 0 rather than reporting negative time', () => {
    expect(elapsedMinutes(new Date('2026-09-22T12:30:00Z'), now)).toBe(0)
  })

  it('returns 0 for an unparseable date instead of NaN', () => {
    expect(elapsedMinutes('not a date', now)).toBe(0)
  })
})
