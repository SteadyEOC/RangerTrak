/**
 * E-327 (John 2026-11-18, Q119 b): an optional band or mode on each radio log entry, picked from a list the mission
 * keeps (Mission page, "Bands"). Capability, not policy: never required, and an entry without one is complete.
 * Pure helpers; no Angular, no storage (D-57).
 */

/** What a new mission starts with. A mission edits its own copy; this list is never read back over it. */
export const DEFAULT_BANDS: ReadonlyArray<string> = ['VHF', 'UHF', 'HF', 'D-STAR', 'Data']

/** A band as stored: trimmed, inner spaces collapsed, at most 24 characters. Blank means none. */
export function cleanBand(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 24) : ''
}

/**
 * The mission's list with one more band added: cleaned, and ignored when blank or already there
 * (compared without regard to case, so "vhf" does not sit beside "VHF").
 */
export function addBand(list: readonly string[], value: string): string[] {
  const band = cleanBand(value)
  if (!band || list.some(b => b.toLowerCase() === band.toLowerCase())) return [...list]
  return [...list, band]
}

/**
 * The choices Entry offers: the mission's list, plus `current` when it is not on the list (an entry being
 * edited whose band has since been removed from the list keeps showing it, so saving never drops it).
 */
export function bandChoices(list: readonly string[] | null | undefined, current?: string): string[] {
  const out = [...(list ?? [])].map(cleanBand).filter(Boolean)
  const cur = cleanBand(current)
  if (cur && !out.some(b => b.toLowerCase() === cur.toLowerCase())) out.push(cur)
  return out
}

/** The `band` key for an entry: present only when a band was picked, like every other optional entry field. */
export function bandField(value: unknown): { band?: string } {
  const band = cleanBand(value)
  return band ? { band } : {}
}
