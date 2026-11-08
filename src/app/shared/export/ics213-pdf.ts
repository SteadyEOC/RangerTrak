import { LineCapStyle, PDFArray, PDFDocument, PDFName, PDFPage, PDFString, StandardFonts, rgb } from 'pdf-lib'
import {
  BRAND_URL, BRAND_URL_LABEL, MARK_ANTENNA, MARK_BODY, MARK_NAVY, MARK_PIN, MARK_SIGNAL, MARK_TIP, MARK_VIEWBOX, MARK_WAVES,
} from '../print-brand/rangertrak-mark'
import { buildSuffix } from '../build-stamp'
import { formatStation } from '../../domain/station-label'
// `import type` only - erased at compile time, so this doesn't pull radio-log-entry.interface.ts/
// mission.interface.ts's own runtime code (there isn't any) into whichever chunk imports this
// module. Kept as narrow Pick<>s below rather than the full types, so this file states exactly
// which fields the mapping actually reads.
import { formatMsgNoFull } from '../../domain/msg-no'
import type { MsgNo } from '../../domain/msg-no'
import type { RadioLogEntryType } from '../services/radio-log-entry.interface'
import type { MissionType } from '../services/mission.interface'

/**
 * Fills the real, official ICS-213 (General Message) AcroForm PDF - not a layout we drew
 * ourselves. `src/assets/forms/ics-213.pdf` is FEMA's own fillable copy (a US government
 * work, public domain), downloaded and inspected field-by-field with `pypdf` before this was
 * written (E-31/E-41 phase 3 scoping, 2026-08-26) rather than guessed - the 15 field names
 * below are exact, not approximated.
 *
 * D-42-style split deliberately kept: this module is PURE (no HTTP, no DOM, no Angular DI) -
 * it takes template bytes and fills them, and never decides where the bytes come from. A
 * caller `fetch()`s `assets/forms/ics-213.pdf` and hands the result here; that keeps this
 * testable with the real template with no Karma/HttpClient machinery inside the function
 * itself, same reasoning as `ranger-migration.ts`'s own "pure, no injection" split.
 *
 * The 213's REPLY block (fields 9/10, plus both signature fields) is deliberately never
 * filled by this function - a reply is written by the actual recipient, by hand, after the
 * fact. Filling it here would be inventing data nobody has entered, the same trap D-42's
 * `normalizeRangerIds()` refuses for a credential number.
 */

/**
 * E-194 / ADR D-60: an attachment as the 213 lists it on the extra page(s) after the form. The
 * form's own page is untouched. `thumbJpeg` is the stored, EXIF-free thumbnail of an image
 * (video and audio are listed without one).
 */
export type Ics213Attachment = { name: string, fingerprint: string, thumbJpeg?: Uint8Array, smallerCopy?: string }

/** Every fillable text field on the real form, exactly as named in the PDF's own AcroForm. */
export const ICS213_FIELDS = [
  '1 Incident Name Optional',
  '2 To Name and Position',
  '3 From Name and Position',
  '4 Subject',
  '5 Date',
  '6 Time',
  '7 Message',
  '8 Approved by Name',
] as const

export type Ics213FieldName = typeof ICS213_FIELDS[number]

/** Values to fill in. Any field left out of `fields` stays blank on the printed form. */
export type Ics213FieldValues = Partial<Record<Ics213FieldName, string>>

/**
 * Returns the filled PDF's bytes. `flatten` (default true) burns the field values into the
 * page content so the result prints identically everywhere, including a browser's own PDF
 * viewer/print pipeline that may not render live AcroForm widgets - pass false only if a
 * caller genuinely wants the recipient able to keep editing the fields (e.g. to hand-fill the
 * Reply block after receiving it).
 */
export async function fillIcs213Pdf(
  templateBytes: Uint8Array,
  fields: Ics213FieldValues,
  flatten = true,
  /** E-168: stamp EXERCISE across the top of the page (the mission is in Exercise mode). */
  exercise = false,
  /** E-194: listed on extra page(s) after the form; the printed list may run to several pages. */
  attachments: readonly Ics213Attachment[] = [],
  /** E-220 / D-68: the entry's message number, printed small in the top margin. FEMA's form has no box for it. */
  msgNo?: MsgNo,
  /** E-280: the app version: the RangerTrak mark, version and RangerTrak.org go in the top-right margin of every page. */
  version?: string,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(templateBytes)
  const form = pdf.getForm()

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue
    form.getTextField(name).setText(value)
  }

  if (flatten) {
    form.flatten()
  }

  // The bundled template is FEMA's own 2-page distribution: page 1 is the actual form, page
  // 2 is a sample/instructions page that ships with every official copy. A printed 213
  // should be the filled form alone - remove pages after the first rather than trusting the
  // template to stay exactly 2 pages forever (a future template swap that's already
  // single-page would make index 1 out of range).
  for (let i = pdf.getPageCount() - 1; i >= 1; i--) {
    pdf.removePage(i)
  }

  // 2026-10-01, John: E-168 - an exercise's paper says so. Black text in a black box, centred in
  // the top margin: legible on a greyscale or photocopied sheet, no colour needed.
  if (exercise) {
    const page = pdf.getPage(0)
    const font = await pdf.embedFont(StandardFonts.HelveticaBold)
    const size = 14
    const text = 'EXERCISE'
    const width = font.widthOfTextAtSize(text, size)
    const { width: pageWidth, height: pageHeight } = page.getSize()
    const x = (pageWidth - width) / 2
    const y = pageHeight - 26
    page.drawRectangle({ x: x - 10, y: y - 5, width: width + 20, height: size + 8, color: rgb(1, 1, 1), borderColor: rgb(0, 0, 0), borderWidth: 1.5 })
    page.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) })
  }

  // E-220: "26-0142 / OP 2 / A007" as small text in the top-left margin, clear of the form fields and
  // of the EXERCISE box above. Nothing is drawn for an entry with no number.
  const msgNoText = formatMsgNoFull(msgNo)
  if (msgNoText) {
    const page = pdf.getPage(0)
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    page.drawText(`Msg ${msgNoText}`, { x: 36, y: page.getSize().height - 20, size: 8, font, color: rgb(0, 0, 0) })
  }

  if (attachments.length) await appendAttachmentPages(pdf, attachments, exercise)
  if (version) await drawPrintBrand(pdf, version)

  return pdf.save()
}

/**
 * E-280 (John, 2026-11-07): the small RangerTrak mark, then "<version> (build ...) · RangerTrak.org", in
 * the top-right margin of every page (Msg no. sits top-left, EXERCISE in the middle). The mark is
 * drawn from path data (rangertrak-mark.ts), so nothing is fetched and it works offline; the
 * site name is also a link in the PDF. The same brand as the HTML printouts' <rangertrak-print-brand>.
 */
export async function drawPrintBrand(pdf: PDFDocument, version: string): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const size = 7
  // No "RangerTrak" before the version: the mark and RangerTrak.org already say it, and the shorter
  // line clears the EXERCISE box in the middle of the top margin.
  const text = `${version}${buildSuffix()} · ${BRAND_URL_LABEL}`
  const textWidth = font.widthOfTextAtSize(text, size)
  const linkWidth = font.widthOfTextAtSize(BRAND_URL_LABEL, size)
  const markHeight = 14
  const s = markHeight / MARK_VIEWBOX.height
  const markWidth = MARK_VIEWBOX.width * s
  const navy = hexRgb(MARK_NAVY)
  const signal = hexRgb(MARK_SIGNAL)
  for (const page of pdf.getPages()) {
    const { width: pageWidth, height: pageHeight } = page.getSize()
    const right = pageWidth - 36
    const top = pageHeight - 9 // the mark's top edge; the text's baseline is at pageHeight - 20, as Msg no.'s
    const x = right - textWidth
    const mx = x - 3 - markWidth
    const at = { x: mx, y: top, scale: s }
    page.drawSvgPath(MARK_PIN, { ...at, borderColor: navy, borderWidth: 12 })
    page.drawSvgPath(MARK_ANTENNA, { ...at, borderColor: navy, borderWidth: 5, borderLineCap: LineCapStyle.Round })
    page.drawSvgPath(MARK_BODY, { ...at, color: navy })
    page.drawSvgPath(MARK_TIP, { ...at, color: navy })
    for (const w of MARK_WAVES) page.drawSvgPath(w, { ...at, borderColor: signal, borderWidth: 9, borderLineCap: LineCapStyle.Round })
    page.drawText(text, { x, y: pageHeight - 20, size, font, color: rgb(0.25, 0.25, 0.25) })
    addLink(pdf, page, BRAND_URL, [right - linkWidth, pageHeight - 22, right, pageHeight - 13])
  }
}

function hexRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** A plain URI link annotation over `rect` ([x1, y1, x2, y2]), no border. */
function addLink(pdf: PDFDocument, page: PDFPage, uri: string, rect: [number, number, number, number]): void {
  const link = pdf.context.register(pdf.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(uri) },
  }))
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (annots instanceof PDFArray) annots.push(link)
  else page.node.set(PDFName.of('Annots'), pdf.context.obj([link]))
}

/** The attachments list: one line each (name and short fingerprint), a thumbnail under an image, new pages as needed. */
async function appendAttachmentPages(pdf: PDFDocument, attachments: readonly Ics213Attachment[], exercise: boolean): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const { width, height } = pdf.getPage(0).getSize()
  const margin = 54
  const thumbMax = 110
  let page = pdf.addPage([width, height])
  let y = height - margin
  const heading = (cont: boolean) => {
    page.drawText(`Attachments (${attachments.length})${cont ? ' - continued' : ''}`, { x: margin, y, size: 13, font: bold, color: rgb(0, 0, 0) })
    if (exercise) page.drawText('EXERCISE', { x: width - margin - 70, y, size: 12, font: bold, color: rgb(0, 0, 0) })
    y -= 24
  }
  heading(false)

  for (const a of attachments) {
    let thumb: Awaited<ReturnType<PDFDocument['embedJpg']>> | undefined
    if (a.thumbJpeg) {
      try { thumb = await pdf.embedJpg(a.thumbJpeg) } catch { /* an unreadable thumbnail is simply left off */ }
    }
    const scale = thumb ? Math.min(1, thumbMax / Math.max(thumb.width, thumb.height)) : 0
    const needed = 16 + (a.smallerCopy ? 13 : 0) + (thumb ? thumb.height * scale + 6 : 0)
    if (y - needed < margin) {
      page = pdf.addPage([width, height])
      y = height - margin
      heading(true)
    }
    page.drawText(`${a.name}  (${a.fingerprint})`, { x: margin, y, size: 10, font, color: rgb(0, 0, 0), maxWidth: width - 2 * margin })
    y -= 16
    if (a.smallerCopy) {
      page.drawText(a.smallerCopy, { x: margin, y, size: 9, font, color: rgb(0, 0, 0), maxWidth: width - 2 * margin })
      y -= 13
    }
    if (thumb) {
      page.drawImage(thumb, { x: margin, y: y - thumb.height * scale + 4, width: thumb.width * scale, height: thumb.height * scale })
      y -= thumb.height * scale + 6
    }
  }
}

/** The report fields `ics213FieldsFromReport()` below actually reads - narrower than the full
 *  `RadioLogEntryType` so this file states exactly what it depends on. */
export type Ics213SourceReport = Pick<
  RadioLogEntryType, 'callsign' | 'tacticalCall' | 'date' | 'subject213' | 'message213' | 'recipients213' | 'operator'
>
/** Likewise for the mission settings passed alongside the report. */
export type Ics213SourceMission = Pick<MissionType, 'event' | 'mission'>

/**
 * The ICS213_FIELDS mapping, lifted out of messages.component.ts's own `printAsIcs213()`
 * (2026-09-22) once entry.component.ts's auto-print-on-submit needed the exact same eight
 * fields - a second hand-written copy is exactly how F29-47 happened: '4 Subject' and
 * '8 Approved by Name' were both declared in ICS213_FIELDS since E-31/E-41 phase 3 but never
 * actually passed a value, so every 213 printed them blank for weeks before anyone noticed.
 * One function both callers use now, so they cannot drift apart again the same way.
 *
 * `RadioLogEntryType` has no Approved-by-Name field of its own - `operator` (D-44, whoever
 * actually filed the report) fills that slot, per this app's own established mapping; a
 * genuinely missing operator renders blank rather than substituting anything else. The 213's
 * REPLY block (fields 9/10, plus both signature fields) is never filled here either, for the
 * same reason `fillIcs213Pdf()`'s own header comment gives - that's the recipient's to write
 * by hand, after the fact.
 */
export function ics213FieldsFromReport(
  report: Ics213SourceReport,
  settings: Ics213SourceMission | undefined,
): Ics213FieldValues {
  const d = new Date(report.date)
  return {
    '1 Incident Name Optional': settings?.event || settings?.mission || '',
    '2 To Name and Position': (report.recipients213 ?? []).join(', '),
    // E-165: tactical call and FCC call both, "CERT Team 1 (K7ABC)" - the form asks for name
    // AND position, and the tactical call is the position.
    '3 From Name and Position': formatStation(report.tacticalCall, report.callsign),
    '4 Subject': report.subject213 ?? '',
    // E-153 (ARES review row 16): the form asks mm/dd/yyyy; toLocaleDateString() printed dd/mm
    // on a non-US device.
    '5 Date': `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`,
    // hour12: false - 24-hour throughout the app, and the ICS-213's own convention.
    '6 Time': d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    '7 Message': report.message213 ?? '',
    '8 Approved by Name': report.operator ?? '',
  }
}
