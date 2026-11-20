import { DEFAULT_BANDS, addBand, bandChoices, bandField, cleanBand } from './band'

describe('E-327 bands', () => {
  it('starts missions with a short list', () => {
    expect(DEFAULT_BANDS).toEqual(['VHF', 'UHF', 'HF', 'D-STAR', 'Data'])
  })

  it('cleans a band', () => {
    expect(cleanBand('  2 m   simplex ')).toBe('2 m simplex')
    expect(cleanBand(42)).toBe('')
    expect(cleanBand(undefined)).toBe('')
    expect(cleanBand('x'.repeat(40))).toHaveLength(24)
  })

  it('adds a band once, whatever the case', () => {
    expect(addBand(['VHF'], ' UHF ')).toEqual(['VHF', 'UHF'])
    expect(addBand(['VHF'], 'vhf')).toEqual(['VHF'])
    expect(addBand(['VHF'], '   ')).toEqual(['VHF'])
  })

  it('offers the list, plus a band an edited entry still carries', () => {
    expect(bandChoices(['VHF', 'UHF'])).toEqual(['VHF', 'UHF'])
    expect(bandChoices(['VHF', 'UHF'], 'uhf')).toEqual(['VHF', 'UHF'])
    expect(bandChoices(['VHF'], 'GMRS')).toEqual(['VHF', 'GMRS'])
    expect(bandChoices(undefined)).toEqual([])
  })

  it('leaves the key off when no band was picked', () => {
    expect(bandField('')).toEqual({})
    expect(bandField(undefined)).toEqual({})
    expect(bandField(' VHF ')).toEqual({ band: 'VHF' })
  })
})
