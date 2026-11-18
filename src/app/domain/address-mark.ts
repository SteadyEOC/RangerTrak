/**
 * Q112 (John 11-17): an address RangerTrak looked up from the position is shown on screen as "(inferred)" and written
 * in files (CSV, radio text) with a leading "~", plain ASCII so it survives Winlink, FLDIGI and spreadsheets. An address
 * the scribe typed or was told stays as written.
 */
export function markedAddress(location: { address?: string, derivedFromAddress?: boolean } | undefined): string {
  const a = (location?.address ?? '').trim()
  if (!a) return ''
  return location?.derivedFromAddress === false ? `~${a}` : a
}
