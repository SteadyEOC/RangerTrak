import { MGRSToDD, formatLatLng } from './coordinate'

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
