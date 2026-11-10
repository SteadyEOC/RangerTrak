import {
  HEAT_GRADIENT,
  heatGradientCss,
  heatPoints,
  heatRadiusForZoom,
} from './heat-points'

describe('heatPoints (E-274)', () => {
  it('turns entries with a location into [lat, lng] points, one each', () => {
    const pts = heatPoints([
      { location: { lat: 47.1, lng: -122.2 } },
      { location: { lat: 47.1, lng: -122.2 } },
    ])
    expect(pts).toEqual([
      [47.1, -122.2],
      [47.1, -122.2],
    ])
  })

  it('skips entries without a usable location', () => {
    const pts = heatPoints([
      { location: { lat: 0, lng: 0 } },
      { location: { lat: 47, lng: 0 } },
      {},
      { location: { lat: 47.5, lng: -122.5 } },
    ])
    expect(pts).toEqual([[47.5, -122.5]])
  })

  it('uses only the entries it is given (filtered input respected)', () => {
    const all = [
      { location: { lat: 1, lng: 1 } },
      { location: { lat: 2, lng: 2 } },
      { location: { lat: 3, lng: 3 } },
    ]
    expect(heatPoints(all.filter((e) => e.location.lat !== 2))).toEqual([
      [1, 1],
      [3, 3],
    ])
    expect(heatPoints([])).toEqual([])
  })
})

describe('heatGradientCss', () => {
  it('writes the heat map stops cold to hot, left to right', () => {
    expect(heatGradientCss()).toBe(
      'linear-gradient(to right, blue 40%, cyan 60%, lime 70%, yellow 80%, red 100%)'
    )
  })

  it('is the gradient the layer is given (one source for map and legend)', () => {
    expect(Object.keys(HEAT_GRADIENT).length).toBe(5)
  })
})

describe('heatRadiusForZoom', () => {
  it('keeps the 25 px default at zoom 14 and wider', () => {
    expect(heatRadiusForZoom(14)).toEqual({ radius: 25, blur: 15 })
    expect(heatRadiusForZoom(10)).toEqual({ radius: 25, blur: 15 })
  })

  it('grows closer in so the heat shows around the markers, capped at 80 px', () => {
    expect(heatRadiusForZoom(16).radius).toBe(50)
    expect(heatRadiusForZoom(17).radius).toBe(71)
    expect(heatRadiusForZoom(19).radius).toBe(80)
  })
})
