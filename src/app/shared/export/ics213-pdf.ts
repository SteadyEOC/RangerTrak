import { PDFDocument } from 'pdf-lib'
// `import type` only - erased at compile time, so this doesn't pull radio-log-entry.interface.ts/
// mission.interface.ts's own runtime code (there isn't any) into whichever chunk imports this
// module. Kept as narrow Pick<>s below rather than the full types, so this file states exactly
// which fields the mapping actually reads.
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

  return pdf.save()
}

/** The report fields `ics213FieldsFromReport()` below actually reads - narrower than the full
 *  `RadioLogEntryType` so this file states exactly what it depends on. */
export type Ics213SourceReport = Pick<
  RadioLogEntryType, 'callsign' | 'date' | 'subject213' | 'message213' | 'recipients213' | 'operator'
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
    '3 From Name and Position': report.callsign,
    '4 Subject': report.subject213 ?? '',
    '5 Date': d.toLocaleDateString(),
    // hour12: false - 24-hour throughout the app, and the ICS-213's own convention.
    '6 Time': d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
    '7 Message': report.message213 ?? '',
    '8 Approved by Name': report.operator ?? '',
  }
}
