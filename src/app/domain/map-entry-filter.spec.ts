import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'
import {
  flaggedStatuses, isStatusFlagged, mapFilterChips, selectMapEntries, type MapFilterState
} from './map-entry-filter'

const e = (id: number, callsign: string, date: string, status = 'Normal', rangerUid?: string) =>
  ({ id, callsign, rangerUid, date: new Date(date), status, notes: '', location: { lat: 1, lng: 1 } }) as unknown as RadioLogEntryType

describe('selectMapEntries', () => {
  const a1 = e(1, 'A', '2026-10-15T10:00:00Z', 'Normal', 'u1')
  const a2 = e(2, 'A', '2026-10-15T11:00:00Z', 'Urgent', 'u1')
  const b1 = e(3, 'B', '2026-10-15T09:00:00Z', 'Normal', 'u2')
  const flagged = new Set(['Urgent'])

  it('all returns everything', () => {
    expect(selectMapEntries([a1, a2, b1], 'all', flagged)).toEqual([a1, a2, b1])
  })
  it('latest keeps the newest per ranger, whatever the array order', () => {
    expect(selectMapEntries([a2, b1, a1], 'latest', flagged)).toEqual([a2, b1])
  })
  it('latest keys by rangerUid, so two people sharing a call sign stay separate', () => {
    const x = e(4, 'SAME', '2026-10-15T10:00:00Z', 'Normal', 'u3')
    const y = e(5, 'SAME', '2026-10-15T09:00:00Z', 'Normal', 'u4')
    expect(selectMapEntries([x, y], 'latest', flagged)).toEqual([x, y])
  })
  it('latest falls back to the call sign when there is no rangerUid', () => {
    const x = e(4, 'T1', '2026-10-15T10:00:00Z')
    const y = e(5, 'T1', '2026-10-15T12:00:00Z')
    expect(selectMapEntries([x, y], 'latest', flagged)).toEqual([y])
  })
  it('latest keeps every entry that has no ranger key at all (no shared empty key)', () => {
    const x = e(6, '', '2026-10-15T10:00:00Z')
    const y = e(7, '', '2026-10-15T12:00:00Z')
    expect(selectMapEntries([x, y], 'latest', flagged)).toEqual([x, y])
  })
  it('attention keeps only flagged statuses', () => {
    expect(selectMapEntries([a1, a2, b1], 'attention', flagged)).toEqual([a2])
  })
  it('attention with nothing flagged is empty', () => {
    expect(selectMapEntries([a1, b1], 'attention', new Set())).toEqual([])
  })
})

describe('isStatusFlagged / flaggedStatuses', () => {
  const s = (color: string, flagOnMap?: boolean) => ({ status: color, color, icon: '', flagOnMap })
  it('defaults by colour key', () => {
    for (const k of ['urgent', 'need-rest-food', 'evidence-report']) expect(isStatusFlagged(s(k))).toBe(true)
    for (const k of ['normal', 'location-report', 'incident-check-in', 'incident-check-out']) {
      expect(isStatusFlagged(s(k))).toBe(false)
    }
  })
  it('flags a custom colour by default', () => {
    expect(isStatusFlagged(s('#ff00ff'))).toBe(true)
    expect(isStatusFlagged(s(''))).toBe(true)
  })
  it('an explicit value overrides the default either way', () => {
    expect(isStatusFlagged(s('urgent', false))).toBe(false)
    expect(isStatusFlagged(s('normal', true))).toBe(true)
  })
  it('collects status names', () => {
    expect([...flaggedStatuses([
      { status: 'Fine', color: 'normal', icon: '' },
      { status: 'Help', color: 'urgent', icon: '' },
      { status: 'Odd', color: 'normal', icon: '', flagOnMap: true },
    ])]).toEqual(['Help', 'Odd'])
  })
})

describe('mapFilterChips', () => {
  const none: MapFilterState = {
    locationsHidden: false, entriesHidden: false, pathsHidden: false, choice: 'all', selectedOnly: false,
  }
  const labels = (o: Partial<MapFilterState>) => mapFilterChips({ ...none, ...o }).map(c => c.label)
  it('is empty when nothing is filtered', () => expect(labels({})).toEqual([]))
  it('words each filter', () => {
    expect(labels({ locationsHidden: true })).toEqual(['Places hidden'])
    expect(labels({ entriesHidden: true })).toEqual(['Radio log entries hidden'])
    expect(labels({ pathsHidden: true })).toEqual(['Ranger paths hidden'])
    expect(labels({ choice: 'latest' })).toEqual(['Showing: latest per ranger'])
    expect(labels({ choice: 'attention' })).toEqual(['Showing: needs attention'])
    expect(labels({ selectedOnly: true })).toEqual(['Showing: selected on Radio Log'])
  })
  it('lists every combination together, with stable keys', () => {
    const chips = mapFilterChips({
      locationsHidden: true, entriesHidden: true, pathsHidden: true, choice: 'attention', selectedOnly: true,
    })
    expect(chips.map(c => c.key)).toEqual(['locations', 'entries', 'paths', 'selected', 'show'])
  })
})
