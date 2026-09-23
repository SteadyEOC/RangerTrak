import { computeExtent } from './extent'

describe('computeExtent', () => {
  it('returns undefined for an empty point list', () => {
    expect(computeExtent([])).toBeUndefined()
  })

  it('broadens a single point rather than fitting a zero-area box', () => {
    const bounds = computeExtent([{ lat: 47.5, lng: -122.3 }], 0.0025)
    expect(bounds).toBeDefined()
    expect(bounds!.north).toBeCloseTo(47.5025, 6)
    expect(bounds!.south).toBeCloseTo(47.4975, 6)
    expect(bounds!.east).toBeCloseTo(-122.2975, 6)
    expect(bounds!.west).toBeCloseTo(-122.3025, 6)
  })

  it('fits several points exactly, with no broadening once the span already exceeds the margin', () => {
    const bounds = computeExtent([
      { lat: 47.0, lng: -122.5 },
      { lat: 48.0, lng: -122.0 },
      { lat: 47.5, lng: -123.0 },
    ], 0.0025)
    expect(bounds).toEqual({ north: 48.0, south: 47.0, east: -122.0, west: -123.0 })
  })

  it('skips a NaN/undefined coordinate mixed in rather than letting it poison the fit', () => {
    const bounds = computeExtent([
      { lat: 47.0, lng: -122.5 },
      { lat: NaN, lng: -122.0 },
      { lat: 48.0, lng: NaN },
      // @ts-expect-error - exercising a runtime-only bad value (e.g. a missing location)
      { lat: undefined, lng: -122.1 },
    ], 0.0025)
    expect(bounds).toEqual({ north: 47.0025, south: 46.9975, east: -122.4975, west: -122.5025 })
  })
})
