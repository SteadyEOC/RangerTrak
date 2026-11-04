import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'
import {
  flaggedStatuses, isStatusFlagged, mapFilterChips, selectMapEntries, SHOW_EVERYTHING, type MapFilterState
} from './map-entry-filter'

const e = (id: number, callsign: string, date: string, status = 'Normal', rangerUid?: string) =>
  ({ id, callsign, rangerUid, date: new Date(date), status, notes: '', location: { lat: 1, lng: 1 } }) as unknown as RadioLogEntryType

describe('selectMapEntries', () => {
  const a1 = e(1, 'A', '2026-10-15T10:00:00Z', 'Normal', 'u1')
  const a2 = e(2, 'A', '2026-10-15T11:00:00Z', 'Urgent', 'u1')
  const b1 = e(3, 'B', '2026-10-15T09:00:00Z', 'Normal', 'u2')
  const latest = { statuses: [], latestOnly: true }
  const only = (...statuses: string[]) => ({ statuses, latestOnly: false })

  it('shows everything by default', () => {
    expect(selectMapEntries([a1, a2, b1], SHOW_EVERYTHING)).toEqual([a1, a2, b1])
  })
  it('latest keeps the newest per ranger, whatever the array order', () => {
    expect(selectMapEntries([a2, b1, a1], latest)).toEqual([a2, b1])
  })
  it('latest keys by rangerUid, so two people sharing a call sign stay separate', () => {
    const x = e(4, 'SAME', '2026-10-15T10:00:00Z', 'Normal', 'u3')
    const y = e(5, 'SAME', '2026-10-15T09:00:00Z', 'Normal', 'u4')
    expect(selectMapEntries([x, y], latest)).toEqual([x, y])
  })
  it('latest falls back to the call sign when there is no rangerUid', () => {
    const x = e(4, 'T1', '2026-10-15T10:00:00Z')
    const y = e(5, 'T1', '2026-10-15T12:00:00Z')
    expect(selectMapEntries([x, y], latest)).toEqual([y])
  })
  it('latest keeps every entry that has no ranger key at all (no shared empty key)', () => {
    const x = e(6, '', '2026-10-15T10:00:00Z')
    const y = e(7, '', '2026-10-15T12:00:00Z')
    expect(selectMapEntries([x, y], latest)).toEqual([x, y])
  })
  it('statuses keeps only those statuses, several at once', () => {
    const c1 = e(8, 'C', '2026-10-15T09:30:00Z', 'Evidence', 'u5')
    expect(selectMapEntries([a1, a2, b1, c1], only('Urgent'))).toEqual([a2])
    expect(selectMapEntries([a1, a2, b1, c1], only('Urgent', 'Evidence'))).toEqual([a2, c1])
  })
  it('a status nobody has shows nothing', () => {
    expect(selectMapEntries([a1, b1], only('Urgent'))).toEqual([])
  })
  it('latest is taken before the status filter: a ranger whose newest report is another status drops out', () => {
    const show = { statuses: ['Normal'], latestOnly: true }
    expect(selectMapEntries([a1, a2, b1], show)).toEqual([b1])
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
    locationsHidden: false, entriesHidden: false, pathsHidden: false, show: SHOW_EVERYTHING, selectedOnly: false,
  }
  const labels = (o: Partial<MapFilterState>) => mapFilterChips({ ...none, ...o }).map(c => c.label)
  it('is empty when nothing is filtered', () => expect(labels({})).toEqual([]))
  it('words each filter', () => {
    expect(labels({ locationsHidden: true })).toEqual(['Places hidden'])
    expect(labels({ entriesHidden: true })).toEqual(['Radio log entries hidden'])
    expect(labels({ pathsHidden: true })).toEqual(['Ranger paths hidden'])
    expect(labels({ show: { statuses: [], latestOnly: true } })).toEqual(['Showing: latest per ranger'])
    expect(labels({ show: { statuses: ['Urgent', 'Evidence'], latestOnly: false } })).toEqual(['Showing: Urgent, Evidence'])
    expect(labels({ show: { statuses: ['A', 'B', 'C', 'D'], latestOnly: false } })).toEqual(['Showing: 4 statuses'])
    expect(labels({ selectedOnly: true })).toEqual(['Showing: selected on Radio Log'])
  })
  it('lists every combination together, with stable keys', () => {
    const chips = mapFilterChips({
      locationsHidden: true, entriesHidden: true, pathsHidden: true, selectedOnly: true,
      show: { statuses: ['Urgent'], latestOnly: true },
    })
    expect(chips.map(c => c.key)).toEqual(['locations', 'entries', 'paths', 'selected', 'statuses', 'latest'])
  })
})
