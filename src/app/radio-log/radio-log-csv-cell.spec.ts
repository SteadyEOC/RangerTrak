import { radioLogCsvCell } from './radio-log-csv-cell'
import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'

describe('radioLogCsvCell (Q112)', () => {
  const entry = (address: string, derivedFromAddress: boolean) =>
    ({ location: { lat: 1, lng: 2, address, derivedFromAddress } }) as unknown as RadioLogEntryType

  it('writes a looked-up address with a leading "~", never "(inferred)"', () => {
    expect(radioLogCsvCell('location.address', '12 Main St', entry('12 Main St', false), v => `${v} (inferred)`, true)).toBe('~12 Main St')
  })

  it('writes an address that was said exactly as said', () => {
    expect(radioLogCsvCell('location.address', 'the red barn', entry('the red barn', true), v => `${v} (inferred)`, true)).toBe('the red barn')
  })

  it('leaves other columns as AG Grid would: formatted when the column has a formatter, raw otherwise', () => {
    expect(radioLogCsvCell('status', 'ok', entry('', true), v => `<${v}>`, true)).toBe('<ok>')
    expect(radioLogCsvCell('note', 'hi', entry('', true), v => `<${v}>`, false)).toBe('hi')
  })
})
