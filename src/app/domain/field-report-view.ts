import type { FieldReportRecord } from './field-report-state'
import type { Rr213Type } from '../shared/services/radio-log-entry.interface'
import { rr213Brief } from './rr213'

/**
 * E-251/E-253 (2026-11-11, ADR D-69): the plain words My reports shows for a report on a field phone.
 * Pure (D-57). The text is shown on the phone only; none of it goes to the Log page, the journal or
 * any storage key (rule 5).
 */
type Shown = {
  notes?: string, subject213?: string, message213?: string, callsign?: string, tacticalCall?: string,
  toCallsign?: string, toTactical?: string, status?: string, date: Date | string, rr213?: Rr213Type,
}

const firstNonBlankLine = (text: string | undefined): string =>
  (text ?? '').split(/\r?\n/).map(l => l.trim()).find(l => l) ?? ''

/** 24-hour hh:mm, the same as the rest of the app. */
export function clock(date: Date | string | undefined | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The resource request (E-283) as one labelled line, or '' when the report has none. */
const rrText = (e: Shown): string => e.rr213?.lines?.length ? `Resource request: ${rr213Brief(e.rr213)}` : ''

/** The first line of the report: Notes, else the 213 subject, else the 213 message, else the resource request. */
export function reportFirstLine(e: Shown): string {
  return firstNonBlankLine(e.notes) || firstNonBlankLine(e.subject213) || firstNonBlankLine(e.message213) || rrText(e) || '(no text)'
}

/** The whole report as read-only text: who, status, Notes, then the 213 parts that were filled in. */
export function reportFullText(e: Shown): string {
  const from = e.tacticalCall || e.callsign
  const to = e.toTactical || e.toCallsign
  const lines: string[] = []
  if (from || to) lines.push(`From ${from || '(blank)'}${to ? ` to ${to}` : ''}`)
  if (e.status) lines.push(`Status: ${e.status}`)
  if (e.notes?.trim()) lines.push(e.notes.trim())
  if (e.subject213?.trim()) lines.push(`213 subject: ${e.subject213.trim()}`)
  if (e.message213?.trim()) lines.push(`213 message: ${e.message213.trim()}`)
  const rr = rrText(e)
  if (rr) lines.push(rr)
  return lines.join('\n') || '(no text)'
}

/** The chip: Not sent / Sent 10:42 (or Sent) / Received · A007 (or Received). */
export function stateChip(record: FieldReportRecord | undefined): string {
  if (!record) return 'Not sent'
  if (record.receivedAt) return record.msgNo ? `Received · ${record.msgNo}` : 'Received'
  const at = clock(record.sentAt)
  return at ? `Sent ${at}` : 'Sent'
}
