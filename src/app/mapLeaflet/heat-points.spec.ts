import { heatPoints } from './heat-points'

describe('heatPoints (E-274)', () => {
  it('turns entries with a location into [lat, lng] points, one each', () => {
    const pts = heatPoints([{ location: { lat: 47.1, lng: -122.2 } }, { location: { lat: 47.1, lng: -122.2 } }])
    expect(pts).toEqual([[47.1, -122.2], [47.1, -122.2]])
  })

  it('skips entries without a usable location', () => {
    const pts = heatPoints([
      { location: { lat: 0, lng: 0 } }, { location: { lat: 47, lng: 0 } }, {},
      { location: { lat: 47.5, lng: -122.5 } },
    ])
    expect(pts).toEqual([[47.5, -122.5]])
  })

  it('uses only the entries it is given (filtered input respected)', () => {
    const all = [{ location: { lat: 1, lng: 1 } }, { location: { lat: 2, lng: 2 } }, { location: { lat: 3, lng: 3 } }]
    expect(heatPoints(all.filter(e => e.location.lat !== 2))).toEqual([[1, 1], [3, 3]])
    expect(heatPoints([])).toEqual([])
  })
})
