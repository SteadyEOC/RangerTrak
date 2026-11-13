import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

import { formatMsgNoFull } from '../../domain/msg-no'
import type { MsgNo } from '../../domain/msg-no'
import { formatStation } from '../../domain/station-label'
import { RR213_DEFAULT_PRIORITY, rr213ContactText, rr213LineText, rr213PriorityLabel } from '../../domain/rr213'
import type { Rr213Priority } from '../../domain/rr213'
import type { Rr213LineType, Rr213Type, RadioLogEntryType } from '../services/radio-log-entry.interface'
import type { MissionType } from '../services/mission.interface'
import { appendAttachmentPages, drawPrintBrand } from './ics213-pdf'
import type { Ics213Attachment } from './ics213-pdf'

/**
 * E-283: fills the real FEMA ICS 213RR (Resource Request) v3, `src/assets/forms/ics-213rr.pdf`: one
 * landscape page, nine order rows. Pure like ics213-pdf.ts: it takes the template's bytes and never
 * fetches. Loaded on demand only (never in the eager bundle).
 *
 * What is never filled, because it is not the requester's to write: block 3 (the Resource Request
 * Number: Logistics assigns it, so RangerTrak's own message number is printed in the margins
 * instead), each row's Estimated Arrival and Cost, blocks 10-13 (Logistics), 15, 16, 17, 19
 * (Finance) and the three signatures.
 */

export const ICS213RR_ROWS = 9

export const ICS213RR_FIELD = {
  incident: '1. Incident Name',
  dateTime: '2 DateTime',
  deliverTo: '5 Requested DeliveryReporting Location',
  substitutes: '6 Suitable Substitutes andor Suggested Sources',
  requestedBy: '7 Requested by NamePosition',
} as const

export const ICS213RR_PRIORITY_BOX = {
  // Washington EMD's priorities onto the nearest of the FEMA form's own boxes.
  'life-saving': '8. Priority: Urgent',
  'incident-stabilization': '8. Priority: Routine',
  'property-preservation': '8. Priority: Low',
} as const

export const rrQtyField = (n: number) => `QtyRow${n}`
export const rrKindField = (n: number) => `KindRow${n}`
export const rrTypeField = (n: number) => `TypeRow${n}`
export const rrDescField = (n: number) => `Detailed Item Description Vital characteristics brand specs experience size etcRow${n}`
export const rrNeededField = (n: number) => `Arrival Date/Time: RequestedRow${n}`

export type Ics213rrSourceReport = Pick<RadioLogEntryType, 'callsign' | 'tacticalCall' | 'date' | 'rr213'>
export type Ics213rrSourceMission = Pick<MissionType, 'event' | 'mission'>

export type Ics213rrFill = {
  /** Text fields to fill, by exact AcroForm name. */
  fields: Record<string, string>,
  /** Checkboxes to tick. */
  checked: string[],
  /** Washington EMD priority, printed in the margins beside the message number. */
  priority?: Rr213Priority,
  /** Order lines beyond the form's nine rows: listed on a continuation page. */
  overflow: Rr213LineType[],
}

/** mm/dd/yyyy HH:mm, 24-hour, as the form and the 213 have it. */
function formDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Block 5: where to deliver, then ". On-site contact: name, phone" (missing parts left out cleanly). */
export function rr213DeliverText(rr: Pick<Rr213Type, 'deliverTo' | 'contactName' | 'contactPhone'> | undefined): string {
  const deliver = rr?.deliverTo?.trim() ?? ''
  const contact = rr ? rr213ContactText(rr) : ''
  if (!contact) return deliver
  return `${deliver ? `${deliver}. ` : ''}On-site contact: ${contact}`
}

/** The one place the entry's request is mapped to the form's fields (Messages and Entry both call it). */
export function rr213FieldsFromReport(report: Ics213rrSourceReport, mission: Ics213rrSourceMission | undefined): Ics213rrFill {
  const rr = report.rr213
  const fields: Record<string, string> = {
    [ICS213RR_FIELD.incident]: mission?.event || mission?.mission || '',
    [ICS213RR_FIELD.dateTime]: formDateTime(new Date(report.date)),
    [ICS213RR_FIELD.requestedBy]: formatStation(report.tacticalCall, report.callsign),
    [ICS213RR_FIELD.deliverTo]: rr213DeliverText(rr),
    [ICS213RR_FIELD.substitutes]: rr?.substitutes ?? '',
  }
  const lines = rr?.lines ?? []
  lines.slice(0, ICS213RR_ROWS).forEach((l, i) => {
    const n = i + 1
    fields[rrQtyField(n)] = l.qty ?? ''
    fields[rrKindField(n)] = l.kind ?? ''
    fields[rrTypeField(n)] = l.type ?? ''
    fields[rrDescField(n)] = l.description ?? ''
    fields[rrNeededField(n)] = l.neededBy ?? ''
  })
  return {
    fields,
    checked: [ICS213RR_PRIORITY_BOX[rr?.priority ?? RR213_DEFAULT_PRIORITY]],
    priority: rr?.priority ?? RR213_DEFAULT_PRIORITY,
    overflow: lines.slice(ICS213RR_ROWS),
  }
}

/** The handle printed in the top and bottom margins: Logistics gives its own number, this one ties the paper to the log. */
export function rr213MsgNoLabel(msgNo: MsgNo | undefined, priority?: Rr213Priority): string {
  const t = formatMsgNoFull(msgNo)
  if (!t) return ''
  return `RangerTrak msg ${t}${priority ? ` · Priority: ${rr213PriorityLabel(priority)}` : ''}`
}

/** Margin font size: 8 pt, shrunk (to at most 5 pt) only if the text would run past the page's right margin. */
export function rr213MarginFontSize(widthAt8: number, pageWidth: number): number {
  const room = pageWidth - 72
  return widthAt8 <= room ? 8 : Math.max(5, Math.floor((8 * room / widthAt8) * 10) / 10)
}

export async function fillIcs213RrPdf(
  templateBytes: Uint8Array,
  fill: Ics213rrFill,
  /** The mission is in Exercise mode: EXERCISE across the top. */
  exercise = false,
  attachments: readonly Ics213Attachment[] = [],
  msgNo?: MsgNo,
  version?: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes)
  const form = pdf.getForm()
  for (const [name, value] of Object.entries(fill.fields)) {
    if (value) form.getTextField(name).setText(value)
  }
  for (const name of fill.checked) form.getCheckBox(name).check()
  form.flatten()
  for (let i = pdf.getPageCount() - 1; i >= 1; i--) pdf.removePage(i)

  const page = pdf.getPage(0)
  const { width, height } = page.getSize()
  if (exercise) {
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    const size = 14
    const w = font.widthOfTextAtSize('EXERCISE', size)
    const x = (width - w) / 2
    const y = height - 26
    page.drawRectangle({ x: x - 10, y: y - 5, width: w + 20, height: size + 8, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5 })
    page.drawText('EXERCISE', { x, y, size, font, color: rgb(0, 0, 0) })
  }
  const label = rr213MsgNoLabel(msgNo, fill.priority)
  if (label) {
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const size = rr213MarginFontSize(font.widthOfTextAtSize(label, 8), width)
    page.drawText(label, { x: 36, y: height - 20, size, font, color: rgb(0, 0, 0) })
    page.drawText(label, { x: 36, y: 12, size, font, color: rgb(0, 0, 0) })
  }

  if (fill.overflow.length) await appendContinuationPage(pdf, fill.overflow, exercise, label)
  if (attachments.length) await appendAttachmentPages(pdf, attachments, exercise)
  if (version) await drawPrintBrand(pdf, version)
  return pdf.save()
}

/** Lines past the ninth row, one per line of text, on landscape pages after the form. */
async function appendContinuationPage(pdf: PDFDocument, lines: readonly Rr213LineType[], exercise: boolean, label: string): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = pdf.getPage(0).getSize()
  const margin = 54
  let page = pdf.addPage([width, height])
  let y = height - margin
  const start = () => {
    page.drawText(`Order lines ${ICS213RR_ROWS + 1} and after (continued from block 4)`, { x: margin, y, size: 13, font: bold, color: rgb(0, 0, 0) })
    if (exercise) page.drawText('EXERCISE', { x: width - margin - 70, y, size: 12, font: bold, color: rgb(0, 0, 0) })
    if (label) {
      page.drawText(label, { x: 36, y: height - 20, size: 8, font, color: rgb(0, 0, 0) })
      page.drawText(label, { x: 36, y: 12, size: 8, font, color: rgb(0, 0, 0) })
    }
    y -= 24
  }
  start()
  lines.forEach((l, i) => {
    const text = [`${ICS213RR_ROWS + 1 + i}.`, rr213LineText(l), l.type ? `(type: ${l.type})` : '', l.neededBy ? `needed by ${l.neededBy}` : ''].filter(Boolean).join('  ')
    if (y < margin + 14) {
      page = pdf.addPage([width, height])
      y = height - margin
      start()
    }
    page.drawText(text, { x: margin, y, size: 10, font, color: rgb(0, 0, 0), maxWidth: width - 2 * margin })
    y -= 16
  })
}
