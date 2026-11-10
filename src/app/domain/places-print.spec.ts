import type { MissionLocationType } from '../shared/services/mission-location.interface'
import { buildPlacesPrint, NO_CATEGORY_LABEL } from './places-print'

const p = (
  name: string,
  type: string,
  over: Partial<MissionLocationType> = {}
): MissionLocationType => ({ name, type, lat: 47.5, lng: -122.5, ...over })

describe('buildPlacesPrint', () => {
  it('is empty when there are no places', () => {
    expect(buildPlacesPrint([], ['Shelters'], 'DD')).toEqual([])
  })

  it('follows the mission category order and leaves out a category with no places', () => {
    const groups = buildPlacesPrint(
      [p('Fire 1', 'Fire Stations'), p('School', 'Shelters')],
      ['Shelters', 'Staging Areas', 'Fire Stations'],
      'DD'
    )
    expect(groups.map((g) => g.label)).toEqual(['Shelters', 'Fire Stations'])
  })

  it('puts a category the list lacks after the listed ones, and no category last', () => {
    const groups = buildPlacesPrint(
      [p('X', ''), p('Y', 'Odd'), p('Z', 'Shelters')],
      ['Shelters'],
      'DD'
    )
    expect(groups.map((g) => g.label)).toEqual(['Shelters', 'Odd', NO_CATEGORY_LABEL])
  })

  it('matches categories ignoring case and spacing', () => {
    const groups = buildPlacesPrint([p('A', ' shelters ')], ['Shelters'], 'DD')
    expect(groups.length).toBe(1)
    expect(groups[0].label).toBe('Shelters')
  })

  it('sorts places A to Z by name within a category', () => {
    const [g] = buildPlacesPrint(
      [p('b', 'S'), p('A', 'S'), p('c10', 'S'), p('c2', 'S')],
      ['S'],
      'DD'
    )
    expect(g.rows.map((r) => r.name)).toEqual(['A', 'b', 'c2', 'c10'])
  })

  it('writes coordinates in the format asked for', () => {
    const place = p('A', 'S', { lat: 47.5, lng: -122.25 })
    expect(buildPlacesPrint([place], ['S'], 'DD')[0].rows[0].coordinates).toBe(
      '47.50000, -122.25000'
    )
    expect(buildPlacesPrint([place], ['S'], 'DDM')[0].rows[0].coordinates).toBe(
      '47° 30.000′ N, 122° 15.000′ W'
    )
    expect(buildPlacesPrint([place], ['S'], 'MGRS')[0].rows[0].coordinates).toMatch(
      /^10T /
    )
  })

  it('carries address and note, blank when missing', () => {
    const [g] = buildPlacesPrint(
      [p('A', 'S', { address: '1 Main', note: 'Key at desk' }), p('B', 'S')],
      ['S'],
      'DD'
    )
    expect(g.rows[0]).toEqual(
      expect.objectContaining({ address: '1 Main', note: 'Key at desk' })
    )
    expect(g.rows[1]).toEqual(expect.objectContaining({ address: '', note: '' }))
  })
})
