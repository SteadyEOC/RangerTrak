import { markedAddress } from '../domain/address-mark'
import type { RadioLogEntryType } from '../domain/model/radio-log-entry.interface'

/**
 * Q112 (John 11-17): the Radio Log CSV marks an address RangerTrak looked up with a leading "~", as the radio text
 * does, instead of the screen's "(inferred)". Every other column exports as before: through its valueFormatter
 * when it has one (AG Grid's default), else the raw value.
 */
export function radioLogCsvCell(
  colId: string,
  value: unknown,
  data: RadioLogEntryType | undefined,
  formatValue: ((v: unknown) => string) | undefined,
  hasFormatter: boolean,
): unknown {
  if (colId === 'location.address') return markedAddress(data?.location)
  return hasFormatter && formatValue ? formatValue(value) : value
}
