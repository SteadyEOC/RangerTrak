import { redact } from './redact'

describe('redact (E-258)', () => {
  it('strips email addresses', () => {
    expect(redact('mail jane.doe+x@example.org now')).toBe('mail [email] now')
  })

  it('strips phone-like digit runs with separators', () => {
    expect(redact('call 206-555-0142 or (206) 555 0142 or +1 206.555.0142')).not.toMatch(/\d{3}/)
    expect(redact('call 5550142')).toBe('call [number]')
  })

  it('strips lat/lng decimal pairs', () => {
    expect(redact('at 47.4471, -122.4627 here')).toBe('at [coords] here')
    expect(redact('47.4471 -122.4627')).toBe('[coords]')
  })

  it('leaves ordinary text and short numbers alone', () => {
    const s = 'TypeError: x is undefined at line 123 (v1.0.0-beta.1)'
    expect(redact(s)).toBe(s)
  })
})
