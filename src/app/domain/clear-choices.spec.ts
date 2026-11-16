import type { AarNoteType } from '../shared/services/aar-note.interface'
import type { ClearCounts } from './clear-choices'
import {
  applyTick,
  buildClearRows,
  chosenIds,
  clearedPlain,
  clearedSummary,
  countNotes,
  countText,
  DEFAULT_REPLACE_CLEAR,
  noteMatcher,
  photosFollowRoster,
} from './clear-choices'

const counts = (over: Partial<ClearCounts> = {}): ClearCounts => ({
  rangers: 42,
  photos: 5,
  entries: 318,
  places: 12,
  incidentNotes: 7,
  lines: 23,
  appNotes: 4,
  tacticalCalls: 6,
  ...over,
})
const note = (
  kind: 'aar' | 'activity',
  about: 'incident' | 'app',
  uid: string
): AarNoteType => ({
  uid,
  createdAt: '2026-10-23T00:00:00Z',
  text: uid,
  page: 'Entry',
  about,
  kind,
})

/** E-221: the pure rules behind the "What to clear" dialog. */
describe('clear-choices (E-221)', () => {
  it('a replace locks the mission data, ticks the incident items and leaves RangerTrak notes unticked', () => {
    const rows = buildClearRows('replace', counts())
    expect(rows.map((r) => r.id)).toEqual([
      'roster',
      'photos',
      'log',
      'places',
      'settings',
      'incidentNotes',
      'lines',
      'header',
      'appNotes',
    ])
    expect(rows.filter((r) => r.locked).map((r) => r.id)).toEqual([
      'roster',
      'photos',
      'log',
      'places',
      'settings',
    ])
    expect(rows.filter((r) => !r.locked && r.checked).map((r) => r.id)).toEqual([
      'incidentNotes',
      'lines',
      'header',
    ])
    expect(rows.find((r) => r.id === 'appNotes')!.checked).toBe(false)
  })

  it('hides rows whose count is 0 but always shows rows with no count', () => {
    const ids = buildClearRows(
      'replace',
      counts({ photos: 0, lines: 0, appNotes: 0 })
    ).map((r) => r.id)
    expect(ids).not.toContain('photos')
    expect(ids).not.toContain('lines')
    expect(ids).not.toContain('appNotes')
    expect(ids).toContain('settings')
    expect(ids).toContain('header')
  })

  it('Clear radio log locks only the log and ticks nothing else', () => {
    const rows = buildClearRows('log', counts())
    expect(rows.map((r) => r.id)).toEqual(['log', 'incidentNotes', 'lines', 'appNotes'])
    expect(rows.filter((r) => r.locked || r.checked).map((r) => r.id)).toEqual(['log'])
    expect(chosenIds(rows, new Set()).has('incidentNotes')).toBe(false)
  })

  it('chosenIds is the locked rows plus the ticked ones', () => {
    const rows = buildClearRows('log', counts())
    expect([...chosenIds(rows, new Set(['lines', 'header']))].sort()).toEqual([
      'lines',
      'log',
    ])
  })

  it('counts read "1 note" and "42 rangers"; a null count reads as nothing', () => {
    expect(countText('roster', 42)).toBe('42 rangers')
    expect(countText('incidentNotes', 1)).toBe('1 note')
    expect(countText('log', 318)).toBe('318 entries')
    expect(countText('settings', null)).toBe('')
  })

  it('the note matcher separates incident notes, 214 lines and RangerTrak notes', () => {
    const all = [
      note('aar', 'incident', 'i1'),
      note('aar', 'app', 'a1'),
      note('activity', 'incident', 'l1'),
    ]
    const gone = (ids: Parameters<typeof noteMatcher>[0]) =>
      all.filter(noteMatcher(ids)).map((n) => n.uid)
    expect(gone(DEFAULT_REPLACE_CLEAR)).toEqual(['i1', 'l1'])
    expect(gone(new Set(['appNotes']))).toEqual(['a1'])
    expect(gone(new Set())).toEqual([])
    expect(countNotes(all)).toEqual({ incidentNotes: 1, lines: 1, appNotes: 1 })
  })

  it('E-223: the log summary has row ids and counts only', () => {
    expect(clearedSummary('replace', DEFAULT_REPLACE_CLEAR, counts())).toBe(
      'roster 42, photos 5, log 318, places 12, settings, incidentNotes 7, lines 23, header'
    )
    expect(clearedSummary('log', new Set(['lines']), counts())).toBe('log 318, lines 23')
  })

  it('E-222: the journal summary says what went and what stayed, in plain words', () => {
    expect(
      clearedPlain('replace', DEFAULT_REPLACE_CLEAR, { ...counts(), appNotes: 4 })
    ).toBe(
      'Cleared: 42 rangers, 5 photos, 318 radio log entries, 12 places, the mission settings, 7 incident notes, 23 ICS-214 lines, the ICS-214 header. Kept: 4 notes about RangerTrak.'
    )
    expect(
      clearedPlain('log', new Set(), {
        ...counts(),
        appNotes: 0,
        lines: 0,
        incidentNotes: 0,
      })
    ).toBe('Cleared: 318 radio log entries.')
  })
})

/** E-319: Start the next mission. */
describe('clear-choices next (E-319)', () => {
  const rows = () => buildClearRows('next', counts({ missionMode: 'exercise' }))
  const byId = (id: string) => rows().find((r) => r.id === id)

  it('lists the rows in order, with the locked and ticked defaults John chose (Q93-Q95)', () => {
    expect(rows().map((r) => [r.id, r.locked, r.checked])).toEqual([
      ['log', true, true],
      ['identity', true, true],
      ['roster', false, false],
      ['photos', false, false],
      ['places', false, false],
      ['tactical', false, false],
      ['mode', false, false],
      ['incidentNotes', false, false],
      ['lines', false, true],
      ['header', false, true],
      ['appNotes', false, false],
    ])
    expect(byId('mode')?.label).toBe('Mission mode (Exercise)')
    expect(byId('tactical')?.count).toBe(6)
  })

  it('leaves out rows with a count of 0, and the mode row when no mode is set', () => {
    const ids = buildClearRows(
      'next',
      counts({ rangers: 0, photos: 0, places: 0, tacticalCalls: 0, lines: 0, incidentNotes: 0, appNotes: 0 })
    ).map((r) => r.id)
    expect(ids).toEqual(['log', 'identity', 'header'])
  })

  it('ticking Roster ticks Photos and locks it; unticking Roster unticks it', () => {
    const none = new Set<never>()
    const on = applyTick(none, 'roster', true, 'next')
    expect([...on].sort()).toEqual(['photos', 'roster'])
    expect(photosFollowRoster('next', on)).toBe(true)
    const off = applyTick(on, 'roster', false, 'next')
    expect(off.size).toBe(0)
    expect(photosFollowRoster('next', off)).toBe(false)
    // photos alone can be ticked while Roster is not
    expect([...applyTick(none, 'photos', true, 'next')]).toEqual(['photos'])
    // the coupling is for 'next' only
    expect([...applyTick(none, 'roster', true, 'log')]).toEqual(['roster'])
  })

  it('the ids a caller gets include Photos whenever Roster is chosen', () => {
    const r = rows()
    expect([...chosenIds(r, new Set(['roster']))].sort()).toEqual(['identity', 'log', 'photos', 'roster'])
    expect([...chosenIds(r, new Set())].sort()).toEqual(['identity', 'log'])
  })

  it('the log summary and journal text name the always-cleared rows and what was kept', () => {
    expect(clearedSummary('next', new Set(['lines', 'header']), counts())).toBe('log 318, identity, lines 23, header')
    expect(clearedPlain('next', new Set(['lines', 'header']), counts())).toBe(
      'Cleared: 318 radio log entries, the mission name, event and op period, 23 ICS-214 lines, the ICS-214 header. Kept: 42 rangers, 12 places, 6 tactical call signs, 7 incident notes, 4 notes about RangerTrak.'
    )
    expect(clearedPlain('next', new Set(['roster', 'tactical', 'mode']), counts({ missionMode: 'incident', appNotes: 0, incidentNotes: 0, lines: 0, places: 0 }))).toBe(
      'Cleared: 318 radio log entries, the mission name, event and op period, 42 rangers, 5 photos, 6 tactical call signs, the mission mode.'
    )
  })

  it('the replace and log contexts are unchanged', () => {
    expect(buildClearRows('log', counts()).map((r) => r.id)).toEqual(['log', 'incidentNotes', 'lines', 'appNotes'])
    expect(buildClearRows('replace', counts()).filter((r) => !r.locked).map((r) => r.id)).toEqual(['incidentNotes', 'lines', 'header', 'appNotes'])
  })
})
