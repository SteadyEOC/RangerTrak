import { LatLng } from 'leaflet'
import { mapPoint } from './map-point'

describe('mapPoint (Leaflet 2.0.0-beta.3 coordinate guard)', () => {
  const cases: [unknown, unknown][] = [
    [47.45, -122.46],
    ['47.45', '-122.46'],
    [' 47.45 ', '-122.46'],
    [-33.9, 151.2],
    [null, -122.46],
    [47.45, null],
    [undefined, 1],
    ['', 1],
    ['  ', 1],
    ['abc', 1],
    ['47.4N', 1],
    [true, 1],
    [false, 1],
    [NaN, 1],
    [Infinity, 1],
    [0, 1],
    [1, 0],
    ['0', 1],
    [{}, 1],
    [[47], 1],
  ]

  it('never accepts a coordinate that Leaflet would throw on', () => {
    for (const [lat, lng] of cases) {
      const at = mapPoint({ lat, lng })
      if (at) {
        expect(LatLng.validate(lat as number, lng as number), `${lat}, ${lng}`).toBe(true)
        expect(() => new LatLng(at[0], at[1])).not.toThrow()
      }
    }
  })

  it('returns numbers for numbers and numeric strings', () => {
    expect(mapPoint({ lat: 47.45, lng: -122.46 })).toEqual([47.45, -122.46])
    expect(mapPoint({ lat: '47.45', lng: '-122.46' })).toEqual([47.45, -122.46])
  })

  it('rejects blanks, nulls, booleans, junk, non-finite and the 0 "no fix" value', () => {
    for (const [lat, lng] of cases.slice(4)) {
      expect(mapPoint({ lat, lng }), `${String(lat)}, ${String(lng)}`).toBeUndefined()
    }
    expect(mapPoint(null)).toBeUndefined()
    expect(mapPoint(undefined)).toBeUndefined()
    expect(mapPoint({ lat: 47.45 })).toBeUndefined()
  })
})
