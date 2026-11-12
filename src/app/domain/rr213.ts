import type { Rr213LineType, Rr213Type } from '../shared/services/radio-log-entry.interface'

/**
 * E-283 (ICS-213RR Resource Request): small pure helpers, no pdf-lib, so Entry, Messages and the
 * ICS-309 text can use them without pulling the PDF code into their chunk.
 */

export type Rr213Priority = NonNullable<Rr213Type['priority']>

export const RR213_PRIORITIES: ReadonlyArray<{ value: Rr213Priority, label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'routine', label: 'Routine' },
  { value: 'low', label: 'Low' },
]

export const RR213_DEFAULT_PRIORITY: Rr213Priority = 'routine'

export function rr213PriorityLabel(p: Rr213Priority | undefined): string {
  return RR213_PRIORITIES.find(x => x.value === (p ?? RR213_DEFAULT_PRIORITY))?.label ?? 'Routine'
}

export function blankRr213Line(): Rr213LineType {
  return { qty: '', kind: '', type: '', description: '', neededBy: '' }
}

/** A line is worth keeping when it says what is wanted. */
export function rr213LineHasContent(l: Rr213LineType): boolean {
  return !!(l.qty?.trim() || l.kind?.trim() || l.description?.trim())
}

/** One order line as plain text: "2 x radio battery" (Kind, then Description when both are there). */
export function rr213LineText(l: Rr213LineType): string {
  const what = [l.kind?.trim(), l.description?.trim()].filter(Boolean).join(' - ')
  const qty = l.qty?.trim()
  return qty ? `${qty} × ${what || 'item'}` : what
}

/**
 * The form to store: trimmed text, empty optional parts left off, blank lines dropped, priority
 * and delivery only when given. Returns undefined when no line has any content (no request).
 */
export function cleanRr213(raw: { lines: Rr213LineType[], priority?: Rr213Priority, deliverTo?: string, substitutes?: string }): Rr213Type | undefined {
  const lines = raw.lines.filter(rr213LineHasContent).map((l): Rr213LineType => ({
    qty: l.qty?.trim() ?? '',
    kind: l.kind?.trim() ?? '',
    ...(l.type?.trim() ? { type: l.type.trim() } : {}),
    description: l.description?.trim() ?? '',
    ...(l.neededBy?.trim() ? { neededBy: l.neededBy.trim() } : {}),
  }))
  if (!lines.length) return undefined
  return {
    lines,
    priority: raw.priority ?? RR213_DEFAULT_PRIORITY,
    ...(raw.deliverTo?.trim() ? { deliverTo: raw.deliverTo.trim() } : {}),
    ...(raw.substitutes?.trim() ? { substitutes: raw.substitutes.trim() } : {}),
  }
}

/**
 * The ICS-309 / list text: "Resource request (ICS-213RR): 2 x radio battery, Urgent, deliver to PCC 2".
 * The first line only, then "+N more" when the request has several.
 */
export function rr213Summary(rr: Rr213Type): string {
  const first = rr.lines[0] ? rr213LineText(rr.lines[0]) : ''
  const more = rr.lines.length > 1 ? ` +${rr.lines.length - 1} more` : ''
  const deliver = rr.deliverTo?.trim() ? `, deliver to ${rr.deliverTo.trim()}` : ''
  return `Resource request (ICS-213RR): ${first}${more}, ${rr213PriorityLabel(rr.priority)}${deliver}`
}
