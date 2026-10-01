import { MGRSToDD, edgeTickStep, formatEdgeTick, formatLatLng } from './coordinate'

describe('printed map edge ticks', () => {
  it('picks a round decimal-degree step giving at most 6 ticks', () => {
    expect(edgeTickStep(0.012, 'DD')).toBe(0.002)
    expect(edgeTickStep(3, 'DD')).toBe(0.5)
  })

  it('picks a round minutes step for DDM', () => {
    expect(edgeTickStep(0.012, 'DDM') * 60).toBeCloseTo(0.2, 9) // 0.72′ span
    expect(edgeTickStep(0.5, 'DDM') * 60).toBeCloseTo(5, 9)     // 30′ span
    expect(edgeTickStep(20, 'DDM')).toBe(5)
  })

  it('labels DD ticks with only the decimals the step needs', () => {
    expect(formatEdgeTick(36.094, false, 'DD', 0.002)).toBe('36.094° N')
    expect(formatEdgeTick(-112.19, true, 'DD', 0.01)).toBe('112.19° W')
  })

  it('labels DDM ticks in minutes, and whole degrees for a degree step', () => {
    expect(formatEdgeTick(36 + 5.25 / 60, false, 'DDM', 0.25 / 60)).toBe('36° 5.25′ N')
    expect(formatEdgeTick(-(112 + 10 / 60), true, 'DDM', 5 / 60)).toBe('112° 10′ W')
    expect(formatEdgeTick(-30, false, 'DDM', 5)).toBe('30° S')
  })
})

describe('formatLatLng (map coordinate readout)', () => {
  const lat = 37.8521
  const lng = -77.4191

  it('writes decimal degrees to 5 places', () => {
    expect(formatLatLng(lat, lng, 'DD')).toBe('37.85210, -77.41910')
  })

  it('writes degrees and decimal minutes with hemisphere letters', () => {
    expect(formatLatLng(lat, lng, 'DDM')).toBe('37° 51.126′ N, 77° 25.146′ W')
  })

  it('carries 60 minutes over into the next degree', () => {
    expect(formatLatLng(10.9999999, 0, 'DDM')).toBe('11° 0.000′ N, 0° 0.000′ E')
  })

  it('writes USNG with spaces, and it reads back to the same place', () => {
    const usng = formatLatLng(lat, lng, 'USNG')
    const m = usng.match(/^(\d{1,2}[C-X]) ([A-Z]{2}) (\d{5}) (\d{5})$/)
    expect(m).withContext(usng).not.toBeNull()
    const back = MGRSToDD(m![1] + m![2], Number(m![3]), Number(m![4]))!
    expect(back.lat).toBeCloseTo(lat, 4)
    expect(back.lng).toBeCloseTo(lng, 4)
  })

  it('falls back to decimal degrees where USNG has no grid (near the poles)', () => {
    expect(formatLatLng(89.5, 10, 'USNG')).toBe('89.50000, 10.00000')
  })
})
