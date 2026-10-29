/**
 * E-234: is a log entry from the current op period?
 *
 * The rule is the entry's own stamped label (`msgNo.opPeriod`, E-220 / D-68) against the Mission's
 * current label (`settings.opPeriod`). It is the same answer the Msg # tooltip and the printed
 * ICS-309 header give, so the screen, the form and the CSV never disagree. The compare is trimmed
 * and case-folded, so "op 3" matches "OP 3". An entry with no number, or a blank current label,
 * is never current (a blank label means the scribe has not named a period, so nothing is marked).
 *
 * Pure (D-57): no injection, no storage.
 */
import type { MsgNo } from './msg-no'

function norm(s: string | undefined | null): string {
  return (s ?? '').trim().toLowerCase()
}

export function isCurrentOpPeriod(entry: { msgNo?: Pick<MsgNo, 'opPeriod'> } | null | undefined, currentLabel: string | undefined | null): boolean {
  const cur = norm(currentLabel)
  if (!cur) return false
  const own = norm(entry?.msgNo?.opPeriod)
  return own !== '' && own === cur
}

/** True when the toggle is worth showing: a current label is set and at least one entry is from another period. */
export function hasOtherOpPeriod(entries: readonly { msgNo?: Pick<MsgNo, 'opPeriod'> }[], currentLabel: string | undefined | null): boolean {
  if (!norm(currentLabel)) return false
  return entries.some(e => !isCurrentOpPeriod(e, currentLabel))
}
