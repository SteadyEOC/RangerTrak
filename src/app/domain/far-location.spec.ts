import { FAR_FROM_DEFAULT_KM, farLocation, farLocationText, isUsablePoint } from './far-location'

// Vashon Island area: roughly 0.009 degrees latitude per km.
const base = { lat: 47.42, lng: -122.46 }
const near = (dLatKm: number, dLngKm = 0) => ({ lat: base.lat + dLatKm * 0.009, lng: base.lng + dLngKm * 0.0133 })

describe('farLocation (E-300)', () => {
  const six = [near(0), near(1), near(-1), near(0, 1), near(0, -1), near(0.5, 0.5)]

  it('stays quiet for a point inside the reports\' spread', () => {
    expect(farLocation(near(0.8), six, base)).toBeNull()
  })

  it('stays quiet when the spread grows by less than half', () => {
    expect(farLocation(near(1.4), six, base)).toBeNull()
  })

  it('warns when a point grows the spread by more than half, giving the nearest report', () => {
    const r = farLocation(near(5), six, base)
    expect(r?.against).toBe('reports')
    expect(r!.km).toBeGreaterThan(3.5)
    expect(r!.km).toBeLessThan(4.5)
  })

  it('catches a dropped minus sign', () => {
    expect(farLocation({ lat: base.lat, lng: -base.lng }, six, base)?.against).toBe('reports')
  })

  it('treats a tight cluster as at least 1 km across', () => {
    const tight = Array.from({ length: 6 }, () => near(0))
    expect(farLocation(near(1.2), tight, base)).toBeNull()
    expect(farLocation(near(2), tight, base)).not.toBeNull()
  })

  it('with 5 or fewer reports, compares with the default location', () => {
    const few = six.slice(0, 5)
    expect(farLocation(near(10), few, base)).toBeNull()
    const r = farLocation(near(FAR_FROM_DEFAULT_KM + 5), few, base)
    expect(r?.against).toBe('default')
  })

  it('skips unusable positions and says nothing it cannot judge', () => {
    expect(farLocation({ lat: -1, lng: -1 }, six, base)).toBeNull()
    expect(farLocation(near(100), [], null)).toBeNull()
    const withJunk = [...six.slice(0, 5), { lat: 0, lng: 0 }, { lat: -1, lng: -1 }, undefined]
    expect(farLocation(near(5), withJunk, base)).toBeNull() // only 5 usable: default rule, 5 km is near
  })

  it('knows a usable point', () => {
    expect(isUsablePoint(base)).toBe(true)
    expect(isUsablePoint({ lat: 91, lng: 0 })).toBe(false)
    expect(isUsablePoint({ lat: NaN, lng: 0 })).toBe(false)
  })

  it('writes a plain note that says saving is still allowed', () => {
    expect(farLocationText({ km: 4.04, against: 'reports' })).toContain('about 4.0 km from the nearest other report')
    expect(farLocationText({ km: 1234.5, against: 'default' })).toContain('1,235 km from the mission\'s default location')
    expect(farLocationText({ km: 42, against: 'default' })).toContain('You can still save it')
  })
})
