import { RadioLogEntryType } from '../services/radio-log-entry.interface'

import { rehydrateDateFields } from '../services/json-dates'
import { buildIcs309Log, Ics309MissionInfo } from './ics309-log'

describe('buildIcs309Log', () => {
  const mission: Ics309MissionInfo = {
    mission: 'SAMPLE - Vashon Island Exercise',
    opPeriod: 'Period 1',
    opPeriodStart: new Date('2026-08-26T09:00:00'),
    opPeriodEnd: new Date('2026-08-26T21:00:00'),
  }

  const report = (over: Partial<RadioLogEntryType>): RadioLogEntryType => ({
    id: 0,
    callsign: 'ACS1',
    location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
    date: new Date('2026-08-26T14:00:00'),
    status: 'Normal',
    notes: 'test',
    ...over,
  })

  it('orders rows chronologically, oldest first, regardless of input order', () => {
    const late = report({ date: new Date('2026-08-26T16:00:00'), notes: 'late' })
    const early = report({ date: new Date('2026-08-26T12:00:00'), notes: 'early' })
    const mid = report({ date: new Date('2026-08-26T14:00:00'), notes: 'mid' })

    const log = buildIcs309Log([late, early, mid], mission)

    expect(log.rows.map(r => r.message)).toEqual(['[Normal] early', '[Normal] mid', '[Normal] late'])
  })

  it('does not mutate the array passed in', () => {
    const rows = [report({ date: new Date('2026-08-26T16:00:00') }), report({ date: new Date('2026-08-26T12:00:00') })]
    const snapshot = [...rows]

    buildIcs309Log(rows, mission)

    expect(rows).toEqual(snapshot)
  })

  it('brackets whatever status string is configured, not a hardcoded "Normal"', () => {
    // A renamed default status must still show, per this module's own doc comment on why
    // it never special-cases a literal 'Normal'.
    const log = buildIcs309Log([report({ status: 'All Clear', notes: 'checked in' })], mission)

    expect(log.rows[0].message).toBe('[All Clear] checked in');
  })

  it('falls back to "(no callsign)" for a callsignless report - D-42, this is expected data', () => {
    const log = buildIcs309Log([report({ callsign: '' })], mission)

    expect(log.rows[0].from).toBe('(no callsign)')
  })

  it('carries the mission name and a real operational-period string through the header', () => {
    const log = buildIcs309Log([], mission)

    expect(log.header.incidentName).toBe('SAMPLE - Vashon Island Exercise')
    expect(log.header.operationalPeriod).toContain('Period 1')
    // The standard form's box 2 needs the raw bounds, not just the formatted string.
    expect(log.header.opPeriodStart).toBeInstanceOf(Date)
    expect(log.header.opPeriodEnd).toBeInstanceOf(Date)
  })

  it('handles zero reports without throwing', () => {
    const log = buildIcs309Log([], mission)

    expect(log.rows).toEqual([])
  })

  it('stamps datePrepared from the supplied "now", not a hidden Date.now() call', () => {
    const now = new Date('2026-08-26T18:00:00')
    const log = buildIcs309Log([], mission, now)

    expect(log.header.datePrepared).toBe(now)
  })
})

/**
 * Regression, 2026-08-31 (0.90.5). buildIcs309Log() sorts with
 * `a.date.getTime() - b.date.getTime()`. Every report reaching it has been through JSON -
 * localStorage, a backup, a Report Packet, or even EntryComponent's own
 * JSON.stringify/parse deep clone of a freshly typed report - so `date` was an ISO string
 * and this threw `getTime is not a function`.
 *
 * It only threw with TWO OR MORE reports: Array.prototype.sort never calls the comparator
 * for 0 or 1 element, so an empty or single-report log printed fine. That is why the
 * existing specs above, which build Dates in memory, all stayed green.
 *
 * Fixed at the load boundaries (see json-dates.ts). These tests assert the contract from
 * the consumer's side: whatever the boundary hands over must be sortable and orderable.
 */
describe('buildIcs309Log with reports that have been through JSON', () => {
  const mission: Ics309MissionInfo = {
    mission: 'SAMPLE - Vashon Island Exercise',
    opPeriod: 'Period 1',
    opPeriodStart: new Date('2026-08-26T09:00:00'),
    opPeriodEnd: new Date('2026-08-26T21:00:00'),
  }

  /** What migrateRadioLog()/mergeIncomingEntries() now hand downstream. */
  function restored(dates: string[]): RadioLogEntryType[] {
    return dates.map((iso, i) => rehydrateDateFields({
      id: i,
      callsign: `ACS${i}`,
      location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
      date: iso,
      status: 'Normal',
      notes: '',
    } as unknown as RadioLogEntryType, ['date', 'revisedAt', 'printedAt']))
  }

  it('does not throw on two or more reports - the exact 0.90.5 crash', () => {
    const reports = restored(['2026-08-26T14:00:00', '2026-08-26T11:00:00'])

    expect(() => buildIcs309Log(reports, mission)).not.toThrow()
  })

  it('orders them correctly, not just without throwing', () => {
    const reports = restored([
      '2026-08-26T14:00:00', '2026-08-26T11:00:00', '2026-08-26T19:00:00',
    ])

    const rows = buildIcs309Log(reports, mission).rows

    expect(rows.map(r => r.time.getHours())).toEqual([11, 14, 19])
  })

  it('still handles the single-report case that always happened to work', () => {
    expect(() => buildIcs309Log(restored(['2026-08-26T14:00:00']), mission)).not.toThrow()
  })

  it('formats the operational period from a mission that has been through JSON', () => {
    // The same class of bug on the mission side: formatOperationalPeriod() calls
    // opPeriodStart.toLocaleString(), which throws on a string.
    const roundTripped = JSON.parse(JSON.stringify(mission)) as Ics309MissionInfo
    const restoredMission = rehydrateDateFields(roundTripped, ['opPeriodStart', 'opPeriodEnd'])

    expect(() => buildIcs309Log(restored(['2026-08-26T14:00:00']), restoredMission)).not.toThrow()
  })
})
