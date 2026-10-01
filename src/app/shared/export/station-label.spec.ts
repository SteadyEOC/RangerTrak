import { formatStation } from './station-label'

describe('formatStation (E-165)', () => {
  it('shows the tactical call with the FCC call in brackets when both are present', () => {
    expect(formatStation('CERT Team 1', 'K7ABC')).toBe('CERT Team 1 (K7ABC)')
  })

  it('shows the tactical call alone when there is no FCC call', () => {
    expect(formatStation('Vashon EOC', '')).toBe('Vashon EOC')
    expect(formatStation('Vashon EOC', undefined)).toBe('Vashon EOC')
  })

  it('shows the FCC call alone when there is no tactical call', () => {
    expect(formatStation('', 'K7ABC')).toBe('K7ABC')
    expect(formatStation(undefined, 'K7ABC')).toBe('K7ABC')
  })

  it('returns an empty string, never a placeholder, when neither is present', () => {
    expect(formatStation()).toBe('')
    expect(formatStation('', '')).toBe('')
    expect(formatStation('  ', ' ')).toBe('')
    expect(formatStation(null, null)).toBe('')
  })

  it('trims whitespace around both parts', () => {
    expect(formatStation('  CERT Team 1 ', ' K7ABC  ')).toBe('CERT Team 1 (K7ABC)')
  })
})
