import { compassPoint, formatHeading, sanitizeHeading, withSanitizedHeading } from './heading'

describe('heading (E-268)', () => {
  it('names the 16 compass points', () => {
    expect(compassPoint(0)).toBe('N')
    expect(compassPoint(45)).toBe('NE')
    expect(compassPoint(90)).toBe('E')
    expect(compassPoint(180)).toBe('S')
    expect(compassPoint(270)).toBe('W')
    expect(compassPoint(22)).toBe('NNE')
    expect(compassPoint(337)).toBe('NNW')
  })

  it('wraps at the north boundary', () => {
    expect(compassPoint(350)).toBe('N')
    expect(compassPoint(359)).toBe('N')
    expect(compassPoint(11)).toBe('N')
    expect(compassPoint(12)).toBe('NNE')
  })

  it('formats as degrees true with the point', () => {
    expect(formatHeading(45)).toBe('45° T (NE)')
    expect(formatHeading(0)).toBe('0° T (N)')
    expect(formatHeading(null)).toBe('')
    expect(formatHeading(undefined)).toBe('')
    expect(formatHeading(400)).toBe('')
  })

  it('sanitizes to a whole 0-359 or null, 360 wrapping to 0', () => {
    expect(sanitizeHeading(0)).toBe(0)
    expect(sanitizeHeading(359)).toBe(359)
    expect(sanitizeHeading(360)).toBe(0)
    expect(sanitizeHeading(361)).toBeNull()
    expect(sanitizeHeading(-1)).toBeNull()
    expect(sanitizeHeading(45.5)).toBeNull()
    expect(sanitizeHeading(NaN)).toBeNull()
    expect(sanitizeHeading('45')).toBeNull()
    expect(sanitizeHeading(null)).toBeNull()
    expect(sanitizeHeading(undefined)).toBeNull()
  })

  it('withSanitizedHeading fixes a bad field and leaves a good or absent one alone', () => {
    const good = { evidenceDirection: 90 }
    expect(withSanitizedHeading(good)).toBe(good)
    const none = {}
    expect(withSanitizedHeading(none)).toBe(none)
    expect(withSanitizedHeading({ evidenceDirection: 'sideways' }).evidenceDirection).toBeNull()
    expect(withSanitizedHeading({ evidenceDirection: 360 }).evidenceDirection).toBe(0)
  })
})
