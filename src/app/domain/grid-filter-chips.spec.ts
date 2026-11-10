import { describeGridFilters } from './grid-filter-chips'

const headers: Record<string, string> = {
  team: 'Team',
  lat: 'Lat',
  date: 'Date',
  status: 'Status',
}
const hdr = (id: string) => headers[id] ?? id
const one = (model: Record<string, unknown>) =>
  describeGridFilters(model, hdr).map((c) => c.label)

describe('describeGridFilters', () => {
  it('returns [] for an empty, null or undefined model', () => {
    expect(describeGridFilters({}, hdr)).toEqual([])
    expect(describeGridFilters(null, hdr)).toEqual([])
    expect(describeGridFilters(undefined, hdr)).toEqual([])
  })

  it('keys each chip by colId', () => {
    expect(
      describeGridFilters(
        { team: { filterType: 'text', type: 'contains', filter: 'CERT' } },
        hdr
      )
    ).toEqual([{ key: 'team', label: 'Team: CERT' }])
  })

  it('labels every text filter type', () => {
    const t = (type: string) =>
      one({ team: { filterType: 'text', type, filter: 'CERT' } })[0]
    expect(t('contains')).toBe('Team: CERT')
    expect(t('equals')).toBe('Team = CERT')
    expect(t('notEqual')).toBe('Team ≠ CERT')
    expect(t('notContains')).toBe('Team: not CERT')
    expect(t('startsWith')).toBe('Team: CERT…')
    expect(t('endsWith')).toBe('Team: …CERT')
    expect(t('blank')).toBe('Team: blank')
    expect(t('notBlank')).toBe('Team: not blank')
  })

  it('labels number filters', () => {
    const n = (type: string, extra: Record<string, unknown> = {}) =>
      one({ lat: { filterType: 'number', type, filter: 47.4, ...extra } })[0]
    expect(n('equals')).toBe('Lat = 47.4')
    expect(n('notEqual')).toBe('Lat ≠ 47.4')
    expect(n('lessThan')).toBe('Lat < 47.4')
    expect(n('lessThanOrEqual')).toBe('Lat ≤ 47.4')
    expect(n('greaterThan')).toBe('Lat > 47.4')
    expect(n('greaterThanOrEqual')).toBe('Lat ≥ 47.4')
    expect(n('inRange', { filter: 47.3, filterTo: 47.5 })).toBe('Lat 47.3–47.5')
    expect(n('blank')).toBe('Lat: blank')
    expect(n('notBlank')).toBe('Lat: not blank')
  })

  it('labels date filters, trimmed to the date unless a time is present', () => {
    expect(
      one({
        date: {
          filterType: 'date',
          type: 'greaterThan',
          dateFrom: '2026-10-15 00:00:00',
          dateTo: null,
        },
      })[0]
    ).toBe('Date > 2026-10-15')
    expect(
      one({
        date: { filterType: 'date', type: 'equals', dateFrom: '2026-10-15 13:45:00' },
      })[0]
    ).toBe('Date = 2026-10-15 13:45')
    expect(
      one({
        date: {
          filterType: 'date',
          type: 'inRange',
          dateFrom: '2026-10-01 00:00:00',
          dateTo: '2026-10-15 00:00:00',
        },
      })[0]
    ).toBe('Date 2026-10-01–2026-10-15')
  })

  it('joins combined conditions with and / or', () => {
    expect(
      one({
        status: {
          filterType: 'text',
          operator: 'OR',
          conditions: [
            { filterType: 'text', type: 'contains', filter: 'Urgent' },
            { filterType: 'text', type: 'contains', filter: 'Evidence' },
          ],
        },
      })[0]
    ).toBe('Status: Urgent or Evidence')
    expect(
      one({
        lat: {
          filterType: 'number',
          operator: 'AND',
          conditions: [
            { filterType: 'number', type: 'greaterThan', filter: 47 },
            { filterType: 'number', type: 'lessThan', filter: 48 },
          ],
        },
      })[0]
    ).toBe('Lat > 47 and < 48')
  })

  it('says "filtered" for shapes it does not know, and never drops the column', () => {
    expect(one({ team: { filterType: 'set', values: ['a'] } })).toEqual([
      'Team: filtered',
    ])
    expect(one({ team: { something: 1 } })).toEqual(['Team: filtered'])
    expect(one({ team: 'weird' })).toEqual(['Team: filtered'])
    expect(one({ team: { filterType: 'text', type: 'brandNew', filter: 'x' } })).toEqual([
      'Team: filtered',
    ])
  })

  it('falls back to the colId when there is no header', () => {
    expect(one({ other: { filterType: 'text', type: 'contains', filter: 'x' } })).toEqual(
      ['other: x']
    )
  })

  it('truncates a long value', () => {
    const label = one({
      team: { filterType: 'text', type: 'contains', filter: 'x'.repeat(100) },
    })[0]
    expect(label.length).toBeLessThan(60)
    expect(label.endsWith('…')).toBe(true)
  })
})
