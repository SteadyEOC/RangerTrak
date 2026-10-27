/**
 * Which roster ranger a typed call sign (or name, or ID) means, and what an edit of a saved
 * report's Callsign does to its roster link.
 *
 * Pure (D-57): no injection, no storage. Entry and the Radio Log grid both resolve through
 * `matchRanger`, so a call typed on Entry and the same call typed into the grid land on the
 * same ranger.
 */
import type { RangerType } from '../shared/services/ranger.interface'
import type { RadioLogEntryType } from '../shared/services/radio-log-entry.interface'

/**
 * Resolves what the scribe typed (or picked) to one ranger, or null.
 *
 * Matches the same three fields Entry's autocomplete offers, and in the same priority order
 * it presents them, so "the row I clicked" and "the row this resolves to" cannot disagree.
 * Exact match only - a substring is fine for *narrowing a list a human then picks from*, but
 * not for silently deciding who a report belongs to.
 */
export function matchRanger(rangers: readonly RangerType[], value: string): RangerType | null {
  const needle = value.trim().toLowerCase()
  if (!needle) {
    return null
  }
  return rangers.find(r => r.callsign?.trim().toLowerCase() === needle)
    ?? rangers.find(r => r.fullName?.trim().toLowerCase() === needle)
    ?? rangers.find(r => r.id?.trim().toLowerCase() === needle)
    ?? null
}

export interface CallsignEdit {
  changed: boolean
  oldCallsign: string
  newCallsign: string
  /** The roster ranger the report now belongs to, or null when the new call matches no one. */
  ranger: RangerType | null
}

/**
 * Tester report 2026-10-26: correcting a report's Callsign in the grid changed the text but
 * left `rangerUid` on the old ranger, so the colour, map trail, operator tooltip and Tactical
 * hover all still named the first ranger. An edit now re-resolves the link the way Entry does
 * at save time: a roster match takes that ranger's uid and call sign as written on the roster;
 * no match keeps the typed text with an empty uid (RadioLogEntryType.rangerUid's rule).
 *
 * `tacticalCall` is left alone: it is the call that was heard (recorded at save time, E-165),
 * and the operator on it is exactly what is being corrected. Mutates `entry`.
 */
export function applyCallsignEdit(entry: RadioLogEntryType, typed: unknown, rangers: readonly RangerType[]): CallsignEdit {
  const oldCallsign = entry.callsign ?? ''
  const text = typeof typed === 'string' ? typed.trim() : typed == null ? '' : String(typed).trim()
  const ranger = matchRanger(rangers, text)
  const newCallsign = ranger ? (ranger.callsign ?? '').trim() : text
  const newUid = ranger?.uid ?? ''
  const changed = newCallsign !== oldCallsign || newUid !== (entry.rangerUid ?? '')
  if (changed) {
    entry.callsign = newCallsign
    entry.rangerUid = newUid
  }
  return { changed, oldCallsign, newCallsign, ranger }
}

/**
 * John 10-26: both quiet outcomes of a Callsign edit get a short pop-up, not a dialog (a
 * blocking dialog on every grid correction would slow a scribe on a busy net). Null when the
 * edit needs no remark: it found a ranger and the report has no tactical call.
 */
export function callsignEditNotice(edit: CallsignEdit, tacticalCall: string | undefined): string | null {
  if (!edit.changed) return null
  const parts: string[] = []
  if (!edit.ranger && edit.newCallsign) {
    parts.push(`${edit.newCallsign} isn't on the roster, so this report isn't linked to a ranger.`)
  }
  const tactical = tacticalCall?.trim()
  if (tactical) {
    parts.push(`Its tactical call ${tactical} stays as recorded.`)
  }
  return parts.length ? parts.join(' ') : null
}
