import { LocationCategoryType, LOCATION_ICON_OPTIONS, LocationIconId } from '../services'
import { locationMarkerSvg, resolveLocationIcon, safeMarkerColor } from './location-marker'

describe('resolveLocationIcon', () => {
  it('prefers an explicit icon over a name match', () => {
    const locationTypes: LocationCategoryType[] = [
      { type: 'Command Post', color: '#1565C0', icon: 'vehicle' },
    ]
    expect(resolveLocationIcon('Command Post', locationTypes)).toBe('vehicle')
  })

  it('falls back to the built-in name map when no icon is stored', () => {
    const locationTypes: LocationCategoryType[] = [
      { type: 'Command Post', color: '#1565C0' },
    ]
    expect(resolveLocationIcon('Command Post', locationTypes)).toBe('command-post')
  })

  it('falls back to the generic pin for a category with neither an icon nor a name match', () => {
    const locationTypes: LocationCategoryType[] = [
      { type: 'Rally Point', color: '#333333' },
    ]
    expect(resolveLocationIcon('Rally Point', locationTypes)).toBe('pin')
  })

  it('falls back to the generic pin for a location whose category was renamed or deleted', () => {
    const locationTypes: LocationCategoryType[] = [
      { type: 'Staging Area', color: '#EF6C00' },
    ]
    expect(resolveLocationIcon('No Longer A Category', locationTypes)).toBe('pin')
  })

  it('still resolves every built-in DEFAULT_LOCATION_TYPES name to its previous shape when icon is absent', () => {
    // Mirrors DEFAULT_LOCATION_TYPES (mission-migration.ts) BEFORE the icon field existed -
    // a returning user's stored settings look exactly like this.
    const preIconLocationTypes: LocationCategoryType[] = [
      { type: 'Command Post', color: '#1565C0' },
      { type: 'Staging Area', color: '#EF6C00' },
      { type: 'Ranger First Aid', color: '#C62828' },
      { type: 'EOC', color: '#6A1B9A' },
      { type: 'Fire Station', color: '#D84315' },
      { type: 'Dock', color: '#00838F' },
    ]
    const expected: Record<string, LocationIconId> = {
      'Command Post': 'command-post',
      'Staging Area': 'staging',
      'Ranger First Aid': 'first-aid',
      'EOC': 'eoc',
      'Fire Station': 'fire-station',
      'Dock': 'dock',
    }
    for (const category of preIconLocationTypes) {
      expect(resolveLocationIcon(category.type, preIconLocationTypes)).toBe(expected[category.type])
    }
  })
})

describe('locationMarkerSvg', () => {
  it('draws a non-empty <svg> for every LocationIconId, each one visually distinct', () => {
    const drawn = new Set<string>()
    for (const { id } of LOCATION_ICON_OPTIONS) {
      const svg = locationMarkerSvg(id, '#1565C0')
      expect(svg).toContain('<svg')
      expect(svg.length).toBeGreaterThan(20)
      expect(drawn.has(svg)).toBe(false)
      drawn.add(svg)
    }
    expect(drawn.size).toBe(LOCATION_ICON_OPTIONS.length)
  })

  it('carries the requested color into the drawn markup', () => {
    const svg = locationMarkerSvg('command-post', '#ABCDEF')
    expect(svg).toContain('#ABCDEF')
  })

  it('falls back to the generic pin for an icon id this build does not recognize (e.g. a newer export)', () => {
    const unknown = 'some-future-icon' as LocationIconId
    const svg = locationMarkerSvg(unknown, '#1565C0')
    expect(svg).toBe(locationMarkerSvg('pin', '#1565C0'))
  })

  describe('safeMarkerColor', () => {
    it('passes hex, named and rgb()/hsl() colors through unchanged', () => {
      ['#1565C0', '#abc', 'teal', 'rgb(10, 20, 30)', 'hsl(120 50% 40%)'].forEach(c =>
        expect(safeMarkerColor(c)).withContext(c).toBe(c))
    })

    it('replaces anything that could break out of the attribute with grey', () => {
      ['red"/><image href=x onerror=alert(1)>', 'url(javascript:x)', '', 'red; fill: blue'].forEach(c =>
        expect(safeMarkerColor(c)).withContext(c).toBe('#757575'))
      expect(locationMarkerSvg('pin', '"><script>')).not.toContain('<script>')
    })
  })
})
