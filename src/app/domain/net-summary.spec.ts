import { netSummary, netSummaryText } from './net-summary'

const ctx = {
  eocCalls: ['W7EOC'],
  roster: [{ callsign: 'K7AAA', team: 'Team 1' }, { callsign: 'K7BBB', team: '' }],
  tacticalCalls: [{ name: 'CERT Team 1' }],
}
const at = (h: number, m: number) => new Date(2026, 10, 18, h, m)
const entry = (call: string, source: string | undefined, date: Date, station = 'A', extra: object = {}) =>
  ({ callsign: call, source, date, msgNo: { station }, ...extra })

describe('netSummary', () => {
  const entries = [
    entry('W7EOC', 'Voice', at(18, 30)),
    entry('K7AAA', undefined, at(18, 40)),           // blank source counts as Voice
    entry('K7AAA', 'Packet', at(18, 50), 'B'),
    entry('K7BBB', 'Phone', at(19, 10), 'B'),
    entry('', 'Voice', at(19, 15), 'B', { tacticalCall: 'CERT Team 1' }),
    entry('VE7ZZZ', 'Voice', at(19, 45)),
  ]

  it('counts entries, distinct stations, sources and kinds', () => {
    const s = netSummary(entries, ctx)
    expect(s.entries).toBe(6)
    expect(s.stations).toBe(5)
    expect(s.bySource).toEqual([{ source: 'Voice', count: 4 }, { source: 'Phone', count: 1 }, { source: 'Packet', count: 1 }])
    expect(s.byKind).toEqual({ eoc: 1, roster: 3, other: 1, unknown: 1 })
    expect(s.byStation).toEqual([{ station: 'A', count: 3 }, { station: 'B', count: 3 }])
    expect(s.first).toEqual(at(18, 30))
    expect(s.last).toEqual(at(19, 45))
  })

  it('counts an entry linked to a roster member as Roster even with no call sign', () => {
    const s = netSummary([entry('', 'Voice', at(9, 0), 'A', { rangerUid: 'u1' })], { ...ctx, rosterUids: new Set(['u1']) })
    expect(s.byKind.roster).toBe(1)
    expect(s.stations).toBe(1)
  })

  it('filters by station letter and then has no per-station line', () => {
    const s = netSummary(entries, ctx, 'B')
    expect(s.entries).toBe(3)
    expect(s.byStation).toEqual([])
  })

  it('E-327: has no band counts when no entry has a band', () => {
    const s = netSummary(entries, ctx)
    expect(s.byBand).toEqual([])
    expect(netSummaryText(s, {})).not.toContain('Band')
  })

  it('E-327: counts by band in the mission list order, then others, then the entries without one', () => {
    const banded = [
      entry('K7AAA', 'Voice', at(9, 0), 'A', { band: 'UHF' }),
      entry('K7BBB', 'Voice', at(9, 1), 'A', { band: 'GMRS' }),
      entry('W7EOC', 'Voice', at(9, 2), 'A', { band: 'VHF' }),
      entry('W7EOC', 'Voice', at(9, 3), 'A', { band: 'VHF' }),
      entry('K7AAA', 'Voice', at(9, 4)),
    ]
    const s = netSummary(banded, { ...ctx, bands: ['VHF', 'UHF', 'HF'] })
    expect(s.byBand).toEqual([
      { band: 'VHF', count: 2 }, { band: 'UHF', count: 1 }, { band: 'GMRS', count: 1 }, { band: 'No band', count: 1 },
    ])
    expect(netSummaryText(s, {}).split('\n')).toContain('Band: VHF 2  UHF 1  GMRS 1  No band 1')
  })

  it('an empty log is zeros without dates', () => {
    const s = netSummary([], ctx)
    expect(s.entries).toBe(0)
    expect(s.first).toBeNull()
    expect(netSummaryText(s, { mission: 'M' })).toBe('NET SUMMARY  M\n0 entries from 0 stations')
  })
})

describe('netSummaryText', () => {
  it('reads like the brief example', () => {
    const entries = [
      ...Array.from({ length: 2 }, () => entry('W7EOC', 'Voice', at(18, 30), 'B')),
      entry('K7AAA', 'Packet', at(19, 45), 'B'),
    ]
    const text = netSummaryText(netSummary(entries, ctx, 'B'), { mission: 'Fernhollow Exercise', opPeriod: '2', station: 'B' })
    expect(text).toBe([
      'NET SUMMARY  Fernhollow Exercise  OP 2  Station B',
      '1830-1945  3 entries from 2 stations',
      'Voice 2  Packet 1',
      'EOC 2  Roster 1',
    ].join('\n'))
  })

  it('does not double the OP prefix', () => {
    expect(netSummaryText(netSummary([], ctx), { opPeriod: 'OP 3' }).split('\n')[0]).toBe('NET SUMMARY  OP 3')
  })

  it('is US-ASCII, wraps at 72 columns, and has no carriage returns', () => {
    const long = 'Café Résumé ' + 'very long mission name '.repeat(6)
    const text = netSummaryText(netSummary([entry('K7AAA', 'Voice', at(1, 2))], ctx), { mission: long, opPeriod: '2' })
    expect(/^[\x20-\x7E\n]*$/.test(text)).toBe(true)
    expect(text).not.toContain('\r')
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(72)
    expect(text).toContain('Cafe Resume')
  })

  it('lists stations when no station is picked', () => {
    const s = netSummary([entry('K7AAA', 'Voice', at(1, 0), 'A'), entry('K7AAA', 'Voice', at(1, 5), 'C')], ctx)
    expect(netSummaryText(s, {})).toContain('By station: A 1  C 1')
  })
})
