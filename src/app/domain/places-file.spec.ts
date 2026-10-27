import type { MissionLocationType } from '../shared/services/mission-location.interface'
import { sniffDelimiter } from '../shared/import/sheet-reader'
import { describeLocationMerge, mergeLocations } from './location-merge'
import {
  applyPlaceMapping, categoryCounts, guessPlaceMapping, newCategoryEntries, parseCoordinateCell, parseGeoJsonPlaces,
  parseKmlPlaces, parseWktPoint, planPlacesImport, placesToRows, resolveCategories, selectPlaces, XmlDocumentLike,
} from './places-file'
import { headerSetKey, parseImportMappings, recallMapping, rememberMapping } from './roster-sheet'

/**
 * E-187 phase B: places from a sheet, a My Maps KML/KMZ and GeoJSON; categories; the additive
 * merge; and the round trip through the app's own export. Made-up places only (Fernhollow is the
 * demo region; nothing real).
 */
describe('places-file', () => {
  const parseXml = (text: string): XmlDocumentLike => {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('malformed XML')
    return doc
  }
  const place = (name: string, extra: Partial<MissionLocationType> = {}): MissionLocationType =>
    ({ name, type: 'Shelters', lat: 47.41, lng: -122.46, ...extra })

  describe('guessPlaceMapping', () => {
    it('recognises the headings the app writes, with zero edits', () => {
      const m = guessPlaceMapping(placesToRows([])[0])
      expect(m.targets).toEqual(['name', 'category', 'lat', 'lng', 'address', 'note', 'uid'])
      expect(m.unrecognised).toEqual([])
    })

    it('reads aliases regardless of case and punctuation, and Google My Maps\' WKT export', () => {
      expect(guessPlaceMapping(['WKT', 'name', 'description']).targets).toEqual(['wkt', 'name', 'note'])
      expect(guessPlaceMapping(['TITLE', 'Layer', 'LAT.', 'Lon', 'Comments']).targets)
        .toEqual(['name', 'category', 'lat', 'lng', 'note'])
      expect(guessPlaceMapping(['Facility', 'Kind', 'Y', 'X']).targets).toEqual(['name', 'category', 'lat', 'lng'])
    })

    it('lets the first column win a field, keeps every note column, and reports what it did not understand', () => {
      const m = guessPlaceMapping(['Name', 'Place', 'Notes', 'Description', 'Hours'])
      expect(m.targets).toEqual(['name', 'ignore', 'note', 'note', 'ignore'])
      expect(m.unrecognised).toEqual([1, 4])   // a second Name-like column is left for the user to look at
    })
  })

  describe('parseCoordinateCell', () => {
    it('reads decimal degrees, hemisphere letters, degrees-minutes and a decimal comma', () => {
      expect(parseCoordinateCell('47.41', 'lat')).toBeCloseTo(47.41, 6)
      expect(parseCoordinateCell('-122.46', 'lng')).toBeCloseTo(-122.46, 6)
      expect(parseCoordinateCell('122.46 W', 'lng')).toBeCloseTo(-122.46, 6)
      expect(parseCoordinateCell('S 12.5', 'lat')).toBeCloseTo(-12.5, 6)
      expect(parseCoordinateCell('47 24.6 N', 'lat')).toBeCloseTo(47.41, 6)
      expect(parseCoordinateCell('47°24\'36"N', 'lat')).toBeCloseTo(47.41, 6)
      expect(parseCoordinateCell('47,41', 'lat')).toBeCloseTo(47.41, 6)
    })

    it('rejects blanks, text, out of range values, the wrong hemisphere and two values in one cell', () => {
      expect(parseCoordinateCell('', 'lat')).toBeNull()
      expect(parseCoordinateCell('n/a', 'lat')).toBeNull()
      expect(parseCoordinateCell('91', 'lat')).toBeNull()
      expect(parseCoordinateCell('-181', 'lng')).toBeNull()
      expect(parseCoordinateCell('47 E', 'lat')).toBeNull()
      expect(parseCoordinateCell('47.4 -122.4', 'lat')).toBeNull()
    })
  })

  describe('applyPlaceMapping', () => {
    it('reads a ";" CSV with lat/lng, trims, drops blank rows, and skips rows without usable coordinates by row number', () => {
      const text = 'Name;Type;Latitude;Longitude;Notes\n'
        + ' Fernhollow Library ;Shelters;47.41;-122.46;Open 8-5\n'
        + ';;;;\n'
        + 'Mill Road Pump;Water;;;no fix yet\n'
        + 'North Dock;Dock;95;-122.4;\n'
        + 'Old Mill;Water;47.5;-122.5;'
      expect(sniffDelimiter(text)).toBe(';')
      const rows = text.split('\n').map(r => r.split(';'))
      const out = applyPlaceMapping(rows, guessPlaceMapping(rows[0]))

      expect(out.places.map(p => p.name)).toEqual(['Fernhollow Library', 'Old Mill'])
      expect(out.places[0]).toEqual({ name: 'Fernhollow Library', type: 'Shelters', lat: 47.41, lng: -122.46, note: 'Open 8-5' })
      expect(out.skipped).toBe(2)
      expect(out.warnings.length).toBe(2)
      expect(out.warnings[0]).toContain('Row 4 (Mill Road Pump)')
      expect(out.warnings[1]).toContain('Row 5 (North Dock)')
    })

    it('reads a Google My Maps CSV: WKT is POINT (lng lat), and a line is skipped', () => {
      const rows = [
        ['WKT', 'name', 'description'],
        ['POINT (-122.46 47.41)', 'Fernhollow School', 'Gym is the shelter'],
        ['LINESTRING (-122.5 47.4, -122.4 47.5)', 'Ferry Road', ''],
      ]
      const out = applyPlaceMapping(rows, guessPlaceMapping(rows[0]))
      expect(out.places).toEqual([{ name: 'Fernhollow School', type: '', lat: 47.41, lng: -122.46, note: 'Gym is the shelter' }])
      expect(out.skipped).toBe(1)
      expect(out.warnings[0]).toContain('Row 3 (Ferry Road)')
    })

    it('prefers latitude/longitude over a WKT column, keeps an address as text only, and needs a name', () => {
      const rows = [
        ['Name', 'Address', 'Latitude', 'Longitude'],
        ['Fernhollow Library', '1 Fern Rd', '47.41', '-122.46'],
        ['', '2 Fern Rd', '47.42', '-122.47'],
        ['Lookup Only', '3 Fern Rd', '', ''],
      ]
      const out = applyPlaceMapping(rows, guessPlaceMapping(rows[0]))
      expect(out.places.length).toBe(1)
      expect(out.places[0].address).toBe('1 Fern Rd')
      expect(out.skipped).toBe(2)
      expect(out.warnings.join(' ')).toContain('no name')
      expect(out.warnings.join(' ')).toContain('no coordinates')
    })
  })

  describe('parseWktPoint', () => {
    it('reads only single points', () => {
      expect(parseWktPoint('POINT (-122.46 47.41)')).toEqual({ lat: 47.41, lng: -122.46 })
      expect(parseWktPoint('POLYGON ((0 0, 1 1, 1 0, 0 0))')).toBeNull()
    })
  })

  describe('parseGeoJsonPlaces', () => {
    const collection = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.46, 47.41] }, properties: { name: 'Fernhollow Library', category: 'Shelters', description: 'Open 8-5' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-122.5, 47.4], [-122.4, 47.5]] }, properties: { name: 'Ferry Road' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.47, 47.42] }, properties: { Title: 'Mill Road Pump', Type: 'Water' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.48, 47.43] }, properties: {} },
      ],
    })

    it('takes points with names and categories, skips and counts other shapes, and warns about an unnamed point', () => {
      const out = parseGeoJsonPlaces(collection)
      expect(out.places).toEqual([
        { name: 'Fernhollow Library', type: 'Shelters', lat: 47.41, lng: -122.46, note: 'Open 8-5' },
        { name: 'Mill Road Pump', type: 'Water', lat: 47.42, lng: -122.47 },
      ])
      expect(out.skipped).toBe(2)
      expect(out.warnings[0]).toContain('1 shape that is not a single point')
      expect(out.warnings.some(w => w.includes('no name'))).toBeTrue()
    })

    it('reads a single Feature, and refuses text that is not GeoJSON', () => {
      const one = parseGeoJsonPlaces(JSON.stringify({ type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 47.4] }, properties: { name: 'A' } }))
      expect(one.places.length).toBe(1)
      expect(() => parseGeoJsonPlaces('not json')).toThrowError(/not GeoJSON/)
      expect(() => parseGeoJsonPlaces('{"rangers": []}')).toThrowError(/not GeoJSON/)
    })
  })

  describe('parseKmlPlaces', () => {
    // What Google My Maps writes: each map layer is a Folder; descriptions are CDATA HTML.
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Fernhollow planning map</name>
  <Folder><name>Shelters</name>
    <Placemark><name>Fernhollow Library</name><description><![CDATA[Open 8-5<br>Generator on site &amp; water]]></description>
      <Point><coordinates>-122.46,47.41,0</coordinates></Point></Placemark>
    <Placemark><name>Fernhollow School</name><Point><coordinates>
      -122.47,47.42,0
    </coordinates></Point></Placemark>
  </Folder>
  <Folder><name>Water points</name>
    <Placemark><name>Mill Road Pump</name><Point><coordinates>-122.48,47.43,0</coordinates></Point></Placemark>
    <Placemark><name>Ferry Road</name><LineString><coordinates>-122.5,47.4,0 -122.4,47.5,0</coordinates></LineString></Placemark>
    <Folder><name>Hand pumps</name>
      <Placemark><name>Orchard Pump</name><Point><coordinates>-122.49,47.44,0</coordinates></Point></Placemark>
    </Folder>
  </Folder>
  <Placemark><name>Loose Pin</name><Point><coordinates>-122.45,47.40,0</coordinates></Point></Placemark>
</Document></kml>`

    it('takes the nearest enclosing Folder name as the category, strips HTML from descriptions, and counts shapes it skips', () => {
      const out = parseKmlPlaces(kml, parseXml)
      expect(out.places.map(p => [p.name, p.type])).toEqual([
        ['Fernhollow Library', 'Shelters'],
        ['Fernhollow School', 'Shelters'],
        ['Mill Road Pump', 'Water points'],
        ['Orchard Pump', 'Hand pumps'],
        ['Loose Pin', ''],
      ])
      expect(out.places[0].note).toBe('Open 8-5 Generator on site & water')
      expect(out.places[0].lat).toBe(47.41)
      expect(out.places[0].lng).toBe(-122.46)
      expect(out.places[1].lat).toBe(47.42)   // whitespace around the tuple is fine
      expect(out.skipped).toBe(1)
      expect(out.warnings[0]).toContain('1 shape that is not a single point')
    })

    it('reads the unzipped doc.kml of a KMZ the same way, with Windows line ends', () => {
      const out = parseKmlPlaces(('﻿' + kml).replace(/\n/g, '\r\n').replace(/^﻿/, ''), parseXml)
      expect(out.places.length).toBe(5)
    })

    it('refuses text that is not KML', () => {
      expect(() => parseKmlPlaces('<html><body/></html>', parseXml)).toThrowError(/not KML/)
      expect(() => parseKmlPlaces('<kml><Document>', parseXml)).toThrowError(/could not be read as KML/)
    })
  })

  describe('resolveCategories and planPlacesImport', () => {
    it('matches existing categories case-insensitively, keeps their spelling, and names the new ones', () => {
      const out = resolveCategories(
        [place('A', { type: 'shelters' }), place('B', { type: 'Water points' }), place('C', { type: 'WATER POINTS' }), place('D', { type: '' })],
        ['Command Post', 'Shelters'])
      expect(out.places.map(p => p.type)).toEqual(['Shelters', 'Water points', 'Water points', ''])
      expect(out.newCategories).toEqual(['Water points'])
    })

    it('puts a new place with no category in "Other" (not the first category), and reports Other as new', () => {
      const plan = planPlacesImport([], [place('A', { type: '' })], ['Command Post', 'Shelters'])
      expect(plan.merge.locations[0].type).toBe('Other')
      expect(plan.newCategories).toEqual(['Other'])
    })

    it('never overwrites an existing place\'s category with the fallback when the cell is blank', () => {
      const existing = [place('A', { uid: 'u1', type: 'Shelters' })]
      const plan = planPlacesImport(existing, [place('A', { type: '' })], ['Shelters'])
      expect(plan.merge.locations[0].type).toBe('Shelters')
      expect(plan.merge.unchanged).toEqual(['A'])
      expect(plan.newCategories).toEqual([])
    })

    it('gives new categories a default colour and the generic pin', () => {
      const entries = newCategoryEntries(['Water points', 'Hand pumps'], 6)
      expect(entries.map(e => e.type)).toEqual(['Water points', 'Hand pumps'])
      expect(entries.every(e => e.icon === 'pin' && /^#[0-9A-F]{6}$/i.test(e.color))).toBeTrue()
      expect(entries[0].color).not.toBe(entries[1].color)
    })
  })

  describe('mergeLocations (additive, D-58)', () => {
    it('a blank incoming field keeps the existing value, and a matched row where nothing differs is Unchanged', () => {
      const existing = [place('A', { uid: 'u1', address: '1 Fern Rd', note: 'Open 8-5' })]
      const result = mergeLocations(existing, [place('A', { type: '', address: '', note: '', lat: NaN, lng: NaN })])
      expect(result.locations[0]).toEqual(existing[0])
      expect(result.unchanged).toEqual(['A'])
      expect(result.overwritten).toEqual([])
    })

    it('names the fields that changed, and keeps the existing uid and order', () => {
      const existing = [place('A', { uid: 'u1' }), place('B', { uid: 'u2' })]
      const result = mergeLocations(existing, [place('A', { note: 'Generator', lat: 47.5 })])
      expect(result.overwritten).toEqual(['A'])
      expect(result.changes).toEqual([{ name: 'A', changedFields: ['note', 'lat'] }])
      expect(result.locations.map(l => l.uid)).toEqual(['u1', 'u2'])
      expect(result.locations[0].note).toBe('Generator')
      expect(result.locations[0].lng).toBe(-122.46)
    })

    it('treats coordinates that agree to 5 decimals as the same place', () => {
      const result = mergeLocations([place('A', { uid: 'u1', lat: 47.4100049, lng: -122.4599951 })], [place('A')])
      expect(result.unchanged).toEqual(['A'])
      expect(result.locations[0].lat).toBe(47.4100049)
    })

    it('names who was added and updated, and caps a long list', () => {
      const merge = mergeLocations([place('A', { uid: 'u1' })],
        [place('A', { note: 'x' }), ...Array.from({ length: 12 }, (_v, i) => place(`New ${i}`))])
      const text = describeLocationMerge(merge)
      expect(text).toContain('added 12 (New 0, New 1')
      expect(text).toContain('and 4 more')
      expect(text).toContain('updated 1 (A: note)')
      expect(describeLocationMerge(mergeLocations([], []))).toBe('places: no changes')
    })
  })

  describe('export', () => {
    it('writes 5 decimals under headings the importer recognises, and the round trip is all Unchanged with zero edits', () => {
      const existing = [
        place('Fernhollow Library', { uid: 'u1', lat: 47.4100049, lng: -122.4599951, note: 'Open, "8-5"' }),
        place('Mill Road Pump', { uid: 'u2', type: 'Water points', address: '2 Mill Rd' }),
      ]
      const rows = placesToRows(existing)
      expect(rows[0]).toEqual(['Name', 'Category', 'Latitude', 'Longitude', 'Address', 'Notes', 'uid'])
      expect(rows[1].slice(2, 4)).toEqual(['47.41000', '-122.46000'])

      const mapping = guessPlaceMapping(rows[0])
      expect(mapping.unrecognised).toEqual([])
      const back = applyPlaceMapping(rows, mapping)
      expect(back.skipped).toBe(0)

      const plan = planPlacesImport(existing, back.places, ['Shelters', 'Water points'])
      expect(plan.merge.added).toEqual([])
      expect(plan.merge.overwritten).toEqual([])
      expect(plan.merge.unchanged).toEqual(['Fernhollow Library', 'Mill Road Pump'])
      expect(plan.newCategories).toEqual([])
    })

    it('re-importing after one place was deleted adds exactly that one back', () => {
      const all = [place('A', { uid: 'u1' }), place('B', { uid: 'u2' }), place('C', { uid: 'u3' })]
      const rows = placesToRows(all)
      const plan = planPlacesImport([all[0], all[2]], applyPlaceMapping(rows, guessPlaceMapping(rows[0])).places, ['Shelters'])
      expect(plan.merge.added).toEqual(['B'])
      expect(plan.merge.unchanged.length).toBe(2)
    })
  })

  describe('selection', () => {
    const places = [
      place('A', { type: 'Shelters', lat: 47.41, lng: -122.46 }),
      place('B', { type: 'shelters', lat: 47.60, lng: -122.30 }),
      place('C', { type: 'Water points', lat: 47.42, lng: -122.45 }),
    ]

    it('picks by category (case-insensitive), by what is inside a view, or both', () => {
      expect(selectPlaces(places).length).toBe(3)
      expect(selectPlaces(places, { categories: ['Shelters'] }).map(p => p.name)).toEqual(['A', 'B'])
      expect(selectPlaces(places, { categories: [] }).length).toBe(0)
      const view = { south: 47.4, west: -122.5, north: 47.5, east: -122.4 }
      expect(selectPlaces(places, { bounds: view }).map(p => p.name)).toEqual(['A', 'C'])
      expect(selectPlaces(places, { categories: ['Shelters'], bounds: view }).map(p => p.name)).toEqual(['A'])
    })

    it('counts places per mission category, then any category the list lacks', () => {
      expect(categoryCounts(places, ['Command Post', 'Shelters'])).toEqual([
        { name: 'Command Post', count: 0 }, { name: 'Shelters', count: 2 }, { name: 'Water points', count: 1 },
      ])
    })
  })

  describe('remembered mappings', () => {
    it('keeps places and roster mappings side by side under their own keys', () => {
      const valid = ['id', 'fullName', 'name', 'lat', 'lng', 'ignore']
      let memory = rememberMapping({}, headerSetKey(['Name', 'Lat', 'Lng']), ['fullName', 'ignore', 'ignore'])
      memory = rememberMapping(memory, 'places:' + headerSetKey(['Name', 'Lat', 'Lng']), ['name', 'lat', 'lng'])
      const reread = parseImportMappings(JSON.stringify(memory), valid)
      expect(recallMapping(reread, ['Name', 'Lat', 'Lng'])).toEqual(['fullName', 'ignore', 'ignore'])
      expect(recallMapping<string>(reread, ['Name', 'Lat', 'Lng'], 'places:')).toEqual(['name', 'lat', 'lng'])
    })
  })
})
