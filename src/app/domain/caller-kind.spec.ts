import { callerKind, normalizeCall, type CallerContext } from './caller-kind'

const ctx = (over: Partial<CallerContext> = {}): CallerContext => ({
  eocCalls: ['W7XYZ'],
  roster: [
    { callsign: 'K7ABC', id: 'R-1', team: 'Team 1' },
    { callsign: 'N7DEF', id: 'R-2', team: '' },
    { callsign: '', id: 'R-3', team: 'Team 3' },
  ],
  tacticalCalls: [{ name: 'CERT Team 1' }],
  ...over,
})

describe('callerKind', () => {
  it('blank text is blank', () => {
    expect(callerKind('  ', ctx()).kind).toBe('blank')
  })
  it('EOC call is blue EOC, case-insensitive and ignoring SSID and suffix', () => {
    expect(callerKind('w7xyz', ctx())).toEqual({ kind: 'eoc', tag: 'EOC' })
    expect(callerKind('W7XYZ-7', ctx()).kind).toBe('eoc')
    expect(callerKind('W7XYZ/P', ctx()).kind).toBe('eoc')
  })
  it('EOC wins over the roster', () => {
    const c = ctx({ roster: [{ callsign: 'W7XYZ', team: 'Team 9' }] })
    expect(callerKind('W7XYZ', c).kind).toBe('eoc')
  })
  it('roster operator tags with the team, or Roster when blank', () => {
    expect(callerKind('k7abc', ctx())).toEqual({ kind: 'operator', tag: 'Team 1' })
    expect(callerKind('N7DEF', ctx())).toEqual({ kind: 'operator', tag: 'Roster' })
  })
  it('matches by Ranger ID too', () => {
    expect(callerKind('r-3', ctx())).toEqual({ kind: 'operator', tag: 'Team 3' })
  })
  it('tactical names match', () => {
    expect(callerKind(' cert team 1 ', ctx())).toEqual({ kind: 'tactical', tag: 'Tactical' })
  })
  it('a directory hit is neutral with the name', () => {
    const r = callerKind('VE7QQQ', ctx({ directoryHit: { name: 'Pat Example', city: 'Victoria', region: 'BC' } }))
    expect(r.kind).toBe('directory')
    expect(r.tag).toBe('Not on roster')
    expect(r.detail).toBe('Pat Example, Victoria, BC')
  })
  it('unknown without a directory is plain Unknown', () => {
    expect(callerKind('VE7QQQ', ctx())).toEqual({ kind: 'unknown', tag: 'Unknown' })
  })
  it('call-shaped text absent from a loaded directory is a likely typo', () => {
    expect(callerKind('VE7QQQ', ctx({ directoryHit: null })).tag).toBe('Not in call sign list')
    expect(callerKind('VE7QQQ-3', ctx({ directoryHit: null })).tag).toBe('Not in call sign list')
  })
  it('non-call text with a directory loaded stays Unknown', () => {
    expect(callerKind('the mayor', ctx({ directoryHit: null })).tag).toBe('Unknown')
  })
})

describe('normalizeCall', () => {
  it('strips SSID and suffixes', () => {
    expect(normalizeCall(' k7abc-9 ')).toBe('K7ABC')
    expect(normalizeCall('K7ABC/M')).toBe('K7ABC')
    expect(normalizeCall('VE7/K7ABC')).toBe('K7ABC')
  })
})
