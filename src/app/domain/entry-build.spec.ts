import type { LocationType } from '../shared/services/location.interface'
import type { RangerType } from '../shared/services/ranger.interface'
import { buildRadioLogEntry, defaultStatus, missionDefaultLocation, stationFields } from './entry-build'

const ranger = (o: Partial<RangerType>): RangerType =>
  ({ callsign: '', fullName: '', phone: '', image: '', team: '', role: '', note: '', ...o })

const rangers = [
  ranger({ uid: 'u1', callsign: 'KB7ABC', fullName: 'Ann Able', team: ' Team 3 ' }),
  ranger({ uid: 'u2', callsign: '', fullName: 'Bob Baker', team: '' }),
  ranger({ uid: 'u3', callsign: 'W7XYZ', fullName: 'Cy Clark', team: 'Team 9' }),
]
const tacticalCalls = [
  { name: 'Medic 1', rangerUid: 'u1' },
  { name: 'Net Control' },
  { name: 'Ghost', rangerUid: 'deleted' },
]
const ctx = { tacticalCalls, rangers }

describe('P1 stationFields', () => {
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ['roster ranger with callsign, team present', 'KB7ABC', '',
      { rangerUid: 'u1', callsign: 'KB7ABC', team: 'Team 3' }],
    ['roster ranger without callsign, team blank', 'Bob Baker', '',
      { rangerUid: 'u2', callsign: '' }],
    ['unmatched text keeps the raw text, no team', '  K9NEW ', '',
      { rangerUid: '', callsign: 'K9NEW' }],
    ['blank From and blank To', '', '', { rangerUid: '', callsign: '' }],
    ['tactical From, staffed (operator uid, call and team)', 'medic 1', '',
      { rangerUid: 'u1', callsign: 'KB7ABC', tacticalCall: 'Medic 1', team: 'Team 3' }],
    ['tactical From, unstaffed', 'Net Control', '',
      { rangerUid: '', callsign: '', tacticalCall: 'Net Control' }],
    ['tactical From whose ranger was deleted', 'Ghost', '',
      { rangerUid: '', callsign: '', tacticalCall: 'Ghost' }],
    ['To a roster ranger', 'KB7ABC', 'W7XYZ',
      { rangerUid: 'u1', callsign: 'KB7ABC', team: 'Team 3', toCallsign: 'W7XYZ', toRangerUid: 'u3' }],
    ['To a roster ranger without callsign: uid only', 'KB7ABC', 'Bob Baker',
      { rangerUid: 'u1', callsign: 'KB7ABC', team: 'Team 3', toRangerUid: 'u2' }],
    ['To a tactical call, unstaffed', 'KB7ABC', 'Net Control',
      { rangerUid: 'u1', callsign: 'KB7ABC', team: 'Team 3', toTactical: 'Net Control' }],
    ['To unmatched text', 'W7XYZ', 'EOC',
      { rangerUid: 'u3', callsign: 'W7XYZ', team: 'Team 9', toCallsign: 'EOC' }],
  ]
  it.each(cases)('%s', (_name, from, to, expected) => {
    const out = stationFields(from, to, ctx)
    expect(out).toEqual(expected)
    // optional keys are absent, not undefined or blank
    expect(Object.keys(out).sort()).toEqual(Object.keys(expected).sort())
  })
})

describe('P1 defaultStatus', () => {
  const statuses = [{ status: 'Open' }, { status: 'Closed' }]
  it.each([
    ['index 0', { radioLogStatuses: statuses, defRadioLogStatus: 0 }, 'Open'],
    ['index 1', { radioLogStatuses: statuses, defRadioLogStatus: 1 }, 'Closed'],
    ['index unset', { radioLogStatuses: statuses }, 'Open'],
    ['index out of range', { radioLogStatuses: statuses, defRadioLogStatus: 7 }, ''],
    ['no statuses', { defRadioLogStatus: 0 }, ''],
    ['no mission', undefined, ''],
  ])('%s', (_n, mission, expected) => {
    expect(defaultStatus(mission)).toBe(expected)
  })
})

describe('P1 missionDefaultLocation', () => {
  const none: LocationType = { lat: -1, lng: -1, address: 'NONE', derivedFromAddress: false }
  it.each([
    ['both set', { defLat: 47.4, defLng: -122.4 }, { ...none, lat: 47.4, lng: -122.4 }],
    ['zero is a real value', { defLat: 0, defLng: 0 }, { ...none, lat: 0, lng: 0 }],
    ['one missing', { defLat: 47.4 }, { ...none, lat: 47.4 }],
    ['no mission', null, none],
  ])('%s', (_n, mission, expected) => {
    expect(missionDefaultLocation(mission, none)).toEqual(expected)
  })
})

describe('P1 buildRadioLogEntry', () => {
  const none: LocationType = { lat: -1, lng: -1, address: 'NONE', derivedFromAddress: false }
  const mission = { tacticalCalls, radioLogStatuses: [{ status: 'Open' }, { status: 'Closed' }], defRadioLogStatus: 1 }
  const base = { rangers, mission, operator: '  Pat  ', noLocation: none }

  it('builds the fixed base fields, the station block, the default status and a trimmed operator', () => {
    const when = new Date('2026-11-20T10:00:00Z')
    expect(buildRadioLogEntry({ from: 'KB7ABC', to: 'Net Control', message: 'hi', date: when }, base)).toEqual({
      id: -1, location: none, date: when, notes: 'hi', source: 'Voice',
      generates213: false, replyRequested213: false, message213: '', recipients213: [], subject213: '',
      rangerUid: 'u1', callsign: 'KB7ABC', team: 'Team 3', toTactical: 'Net Control',
      status: 'Closed', operator: 'Pat', evidenceLocation: null, evidenceDirection: null,
    })
  })
  it('uses the given location and status, and falls back to now for the date', () => {
    const loc = { ...none, lat: 1, lng: 2 }
    const e = buildRadioLogEntry({ from: '', to: '', message: '', location: loc, status: 'Open' },
      { ...base, now: () => new Date(5) })
    expect(e.location).toBe(loc)
    expect(e.status).toBe('Open')
    expect(e.date).toEqual(new Date(5))
  })
  it('falls back to a blank status when the mission default is out of range or there is no mission', () => {
    expect(buildRadioLogEntry({ from: 'x', to: '', message: '' },
      { ...base, mission: { ...mission, defRadioLogStatus: 9 } }).status).toBe('')
    const noMission = buildRadioLogEntry({ from: 'KB7ABC', to: '', message: '' }, { ...base, mission: undefined })
    expect(noMission.status).toBe('')
    expect(noMission.tacticalCall).toBeUndefined()
    expect(noMission.rangerUid).toBe('u1')
  })
})
