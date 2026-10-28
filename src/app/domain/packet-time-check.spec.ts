import { FUTURE_SLACK_MS, checkPacketTimes, packetTimeWarning } from './packet-time-check'

describe('checkPacketTimes', () => {
  const now = Date.parse('2026-10-28T18:00:00Z')
  const opStart = '2026-10-28T08:00:00Z'
  const at = (iso: string) => ({ date: new Date(iso) })

  it('passes a packet from this op period', () => {
    const r = checkPacketTimes({ incoming: [at('2026-10-28T09:00:00Z'), at('2026-10-28T17:59:00Z')], existing: [], opPeriodStart: opStart, now })
    expect(r.before).toBe(0)
    expect(r.future).toBe(0)
  })

  // The case the check exists for: last month's packet, still on a ranger's phone.
  it('counts reports from before the mission started', () => {
    const r = checkPacketTimes({ incoming: [at('2026-09-20T09:00:00Z'), at('2026-10-28T09:00:00Z')], existing: [], opPeriodStart: opStart, now })
    expect(r.before).toBe(1)
    expect(r.windowStart?.toISOString()).toBe('2026-10-28T08:00:00.000Z')
  })

  // No op-period history: a report from op period 1 is fine once the mission is in op period 3,
  // because this device's own oldest report opens the window earlier.
  it('opens the window at this device\'s oldest report when that is earlier', () => {
    const r = checkPacketTimes({
      incoming: [at('2026-10-27T10:00:00Z')], existing: [at('2026-10-27T07:00:00Z')], opPeriodStart: opStart, now,
    })
    expect(r.before).toBe(0)
    expect(r.windowStart?.toISOString()).toBe('2026-10-27T07:00:00.000Z')
  })

  it('counts reports dated in the future, allowing a few minutes of clock drift', () => {
    const r = checkPacketTimes({
      incoming: [{ date: new Date(now + FUTURE_SLACK_MS - 1000) }, { date: new Date(now + FUTURE_SLACK_MS + 1000) }],
      existing: [], opPeriodStart: opStart, now,
    })
    expect(r.future).toBe(1)
  })

  it('reads dates that arrive as JSON strings', () => {
    const r = checkPacketTimes({ incoming: [{ date: '2026-09-01T00:00:00Z' }], existing: [], opPeriodStart: opStart, now })
    expect(r.before).toBe(1)
  })

  it('skips unreadable dates (the merge rejects those itself)', () => {
    const r = checkPacketTimes({ incoming: [{ date: 'not a date' }], existing: [], opPeriodStart: opStart, now })
    expect(r.before + r.future).toBe(0)
  })

  it('checks only the future when nothing opens the window', () => {
    const r = checkPacketTimes({ incoming: [at('2001-01-01T00:00:00Z')], existing: [], opPeriodStart: null, now })
    expect(r.before).toBe(0)
    expect(r.windowStart).toBeNull()
  })
})

describe('packetTimeWarning', () => {
  const fmt = (d: Date) => d.toISOString()

  it('says nothing when every report is in the window', () => {
    expect(packetTimeWarning({ before: 0, future: 0, windowStart: new Date(0) }, 3, fmt)).toBeNull()
  })

  it('names both problems and the total', () => {
    const text = packetTimeWarning({ before: 2, future: 1, windowStart: new Date('2026-10-28T08:00:00Z') }, 5, fmt)!
    expect(text).toContain('2 reports in this packet are dated before this mission started (2026-10-28T08:00:00.000Z)')
    expect(text).toContain('1 report in this packet is dated in the future')
    expect(text).toContain('Import all 5 reports anyway?')
  })
})
