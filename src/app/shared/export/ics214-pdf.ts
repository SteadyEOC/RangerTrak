import { PDFDocument, PDFName, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import { drawPrintBrand } from './ics213-pdf'

import {
  ICS214_MAX_RESOURCES, ActivityLogHeader, ActivityRow, chunkActivityRows, toWinAnsi,
} from '../../domain/activity-log'
import type { MissionType } from '../services/mission.interface'

/**
 * E-04 / ADR D-63 item 5: fills the real, official FEMA ICS-214 (Activity Log, v3.1) AcroForm PDF
 * - not a layout we drew ourselves. `src/assets/forms/ics-214.pdf` is FEMA's own fillable copy (a
 * US government work). The field names below were read out of its AcroForm with pdf-lib, not
 * guessed; `ics214-pdf.spec.ts` fills the REAL template so a template swap that renamed a field
 * shows up there.
 *
 * Same split as `ics213-pdf.ts`: PURE (no HTTP, no DOM, no Angular DI). A caller fetches the
 * template and hands the bytes here, and delivers the result with `printIcs213()` (which names
 * the form it prints). Rows arrive already wrapped and chunked-ready from `domain/activity-log.ts`.
 *
 * The template has three pages: page 0 (header, Resources Assigned, 24 activity rows), page 1 (the
 * continuation: 36 more rows) and page 2 (FEMA's instructions). The output is page 0 once, then
 * page 1 once per further sheet; the instructions page is dropped. Each sheet is filled on its own
 * fresh copy of the template and flattened, then copied into the one output document.
 *
 * The signature fields (`Signature_21`, `Signature_22`) are never filled: a signature is the
 * person's own, by hand, the same rule the 213 follows for its reply block.
 */

/** What the form's top and footer need from the mission: names and the operational period. */
export type Ics214Mission = Pick<MissionType, 'event' | 'mission' | 'opPeriodStart' | 'opPeriodEnd'>

/** mm/dd/yyyy, the form's own convention (E-153: never the device's locale order). */
export function formDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`
}

/** 24-hour hh:mm. */
export function formTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** The mission's operational period as the form's four fields; all blank when the mission has none. */
function opPeriodFields(mission: Ics214Mission): { dateFrom: string, dateTo: string, timeFrom: string, timeTo: string } {
  const s = mission.opPeriodStart ? new Date(mission.opPeriodStart) : null
  const e = mission.opPeriodEnd ? new Date(mission.opPeriodEnd) : null
  const real = !!s && !!e && !isNaN(s.getTime()) && !isNaN(e.getTime()) && s.getTime() > 0 && e.getTime() > s.getTime()
  return real
    ? { dateFrom: formDate(s!), dateTo: formDate(e!), timeFrom: formTime(s!), timeTo: formTime(e!) }
    : { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' }
}

/** The form's row-name suffixes: page 0 rows are bare; page 1's first 24 end `_2`, its last 12 are bare again. */
function continuationRowName(base: 'DateTimeRow' | 'Notable ActivitiesRow', i: number): string {
  return i <= 24 ? `${base}${i}_2` : `${base}${i}`
}

/** Resources Assigned name fields: rows 1-6 end `_3`, rows 7-8 are bare. */
function resourceNameField(i: number): string {
  return i <= 6 ? `NameRow${i}_3` : `NameRow${i}`
}

/** Fields drawn at a smaller size so a full mm/dd/yyyy or date-and-time fits the narrow cell. */
const SMALL_FONT_FIELDS = new Set(['Date From', 'Date To', 'Time From', 'Time To', 'DateTime_15', 'DateTime_16'])

/**
 * The field name -> value map for one sheet (`sheetIndex` 0 is the first sheet, any other a
 * continuation). Blank values are left out. Pure and exported so the spec can check every name
 * against the real template and every value against what it should be, without having to read
 * text back out of a flattened page.
 */
export function ics214SheetFields(
  sheetIndex: number, header: ActivityLogHeader, mission: Ics214Mission, sheetRows: readonly ActivityRow[], preparedAt: Date,
): Record<string, string> {
  const first = sheetIndex === 0
  const incident = mission.event?.trim() || mission.mission?.trim() || ''
  const period = opPeriodFields(mission)
  const prepared = `${formDate(preparedAt)} ${formTime(preparedAt)}`
  const text = (s: string | undefined) => toWinAnsi((s ?? '').replace(/\s*[\r\n]+\s*/g, ' '))
  const f: Record<string, string> = {}
  const put = (name: string, value: string) => { if (value) f[name] = value }

  // Shared by both pages (one field, two widgets): the operational period.
  put('Date From', period.dateFrom)
  put('Date To', period.dateTo)
  put('Time From', period.timeFrom)
  put('Time To', period.timeTo)

  if (first) {
    put('1 Incident Name_19', text(incident))
    put('3 Name', text(header.name))
    put('4 ICS Position', text(header.icsPosition))
    put('5 Home Agency and Unit', text(header.homeAgency))
    header.resources.slice(0, ICS214_MAX_RESOURCES).forEach((r, i) => {
      put(resourceNameField(i + 1), text(r.name))
      put(`ICS PositionRow${i + 1}`, text(r.icsPosition))
      put(`Home Agency and UnitRow${i + 1}`, text(r.homeAgency))
    })
    sheetRows.forEach((row, i) => {
      put(`DateTimeRow${i + 1}`, row.time)
      put(`Notable ActivitiesRow${i + 1}`, text(row.text))
    })
    put('8 Prepared by Name', text(header.name))
    put('PositionTitle_15', text(header.icsPosition))
    put('DateTime_15', prepared)
  } else {
    put('1 Incident Name_20', text(incident))
    sheetRows.forEach((row, i) => {
      put(continuationRowName('DateTimeRow', i + 1), row.time)
      put(continuationRowName('Notable ActivitiesRow', i + 1), text(row.text))
    })
    put('8 Prepared by Name_2', text(header.name))
    put('PositionTitle_16', text(header.icsPosition))
    put('DateTime_16', prepared)
  }
  return f
}

/**
 * Returns the filled, flattened ICS-214 as PDF bytes: one sheet per chunk of rows (24, then 36 per
 * continuation). `preparedAt` is the export time. `exercise` stamps EXERCISE on every sheet.
 */
export async function fillIcs214Pdf(
  templateBytes: Uint8Array,
  header: ActivityLogHeader,
  mission: Ics214Mission,
  rows: readonly ActivityRow[],
  preparedAt: Date,
  exercise = false,
  /** E-280: the app version: the RangerTrak mark, version and RangerTrak.org go in the top-right margin of every sheet. */
  version?: string,
): Promise<Uint8Array> {
  const sheets = chunkActivityRows(rows)
  const out = await PDFDocument.create()

  for (let k = 0; k < sheets.length; k++) {
    const doc = await PDFDocument.load(templateBytes)
    const form = doc.getForm()
    for (const [name, value] of Object.entries(ics214SheetFields(k, header, mission, sheets[k], preparedAt))) {
      const field = form.getTextField(name)
      if (SMALL_FONT_FIELDS.has(name)) field.setFontSize(9)
      field.setText(value)
    }

    // Flatten, then copy just the one page this sheet is: page 0 for the first sheet, page 1 after.
    // (Page 2, FEMA's instructions, is never copied.)
    form.flatten()
    // Flattening leaves the page's /Annots list naming widgets it deleted, which would copy across as
    // dangling references (some PDF readers report a damaged file). Every annotation on these pages
    // is a form widget and is burned in by now, so the list goes.
    const sheet = doc.getPage(k === 0 ? 0 : 1)
    sheet.node.delete(PDFName.of('Annots'))
    const [page] = await out.copyPages(doc, [k === 0 ? 0 : 1])
    out.addPage(page)
  }

  if (exercise) await stampExercise(out)
  if (version) await drawPrintBrand(out, version)

  return out.save()
}

/** Same look as the 213's banner: black text in a white box with a black border, centred in the top margin. */
async function stampExercise(pdf: PDFDocument): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.HelveticaBold)
  const size = 14
  const label = 'EXERCISE'
  const width = font.widthOfTextAtSize(label, size)
  pdf.getPages().forEach((page: PDFPage) => {
    const { width: pageWidth, height: pageHeight } = page.getSize()
    const x = (pageWidth - width) / 2
    const y = pageHeight - 26
    page.drawRectangle({ x: x - 10, y: y - 5, width: width + 20, height: size + 8, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5 })
    page.drawText(label, { x, y, size, font, color: rgb(0, 0, 0) })
  })
}
