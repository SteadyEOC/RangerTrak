import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'

import {
  ACTIVITY_CELL_MAX_WIDTH, ActivityLogHeader, ActivityRow, buildActivityRows, chunkActivityRows,
} from '../../domain/activity-log'
import type { AarNoteType } from '../services/aar-note.interface'
import { fillIcs214Pdf, ics214SheetFields, Ics214Mission } from './ics214-pdf'

/**
 * These use the REAL bundled template (`assets/forms/ics-214.pdf`), fetched exactly as a caller
 * would in the browser, so a field-name typo or a template swap that renamed a field shows up
 * here and not only once someone opens a printed 214 and finds it blank (same approach as
 * ics213-pdf.spec.ts). `fillIcs214Pdf` flattens, which burns values into the page where they
 * cannot be read back as fields, so what lands where is checked through `ics214SheetFields`
 * (every name must exist in the real template, as a text field) and the output is checked for
 * page count, no live fields, and the signature fields staying empty.
 */
describe('ICS-214 filler (E-04 / D-63)', () => {
  let templateBytes: Uint8Array

  const mission: Ics214Mission = {
    event: 'Fernhollow Flood', mission: 'FH-2026',
    opPeriodStart: new Date(2026, 9, 20, 8, 0), opPeriodEnd: new Date(2026, 9, 20, 20, 0),
  }
  const header: ActivityLogHeader = {
    name: 'Pat Doe', icsPosition: 'Radio Operator', homeAgency: 'Fernhollow CERT',
    resources: [{ name: 'Sam Roe', icsPosition: 'Runner', homeAgency: 'Fernhollow CERT' }],
  }
  const preparedAt = new Date(2026, 9, 20, 18, 30)
  const rows = (n: number): ActivityRow[] => Array.from({ length: n }, (_, i) => ({ time: '10/20 09:00', text: `Line ${i + 1}` }))
  const pageCount = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount()

  beforeAll(async () => {
    const res = await fetch('/assets/forms/ics-214.pdf')
    templateBytes = new Uint8Array(await res.arrayBuffer())
  })

  it('the template has the three pages this filler expects', async () => {
    expect(await pageCount(templateBytes)).toBe(3)
  })

  it('puts 61 lines on three sheets (24 + 36 + 1) and drops the instructions page', async () => {
    const out = await fillIcs214Pdf(templateBytes, header, mission, rows(61), preparedAt)
    expect(await pageCount(out)).toBe(3)
    expect(chunkActivityRows(rows(61)).map(s => s.length)).toEqual([24, 36, 1])
  })

  it('gives one sheet for 24 lines or for none, two for 25', async () => {
    expect(await pageCount(await fillIcs214Pdf(templateBytes, header, mission, rows(24), preparedAt))).toBe(1)
    expect(await pageCount(await fillIcs214Pdf(templateBytes, header, mission, [], preparedAt))).toBe(1)
    expect(await pageCount(await fillIcs214Pdf(templateBytes, header, mission, rows(25), preparedAt))).toBe(2)
  })

  it('every field name it fills exists in the real template as a text field, on a full first and full continuation sheet', async () => {
    const full: ActivityLogHeader = {
      ...header, resources: Array.from({ length: 8 }, (_, i) => ({ name: `R${i}`, icsPosition: `P${i}`, homeAgency: `A${i}` })),
    }
    const form = (await PDFDocument.load(templateBytes)).getForm()
    const first = ics214SheetFields(0, full, mission, rows(24), preparedAt)
    const cont = ics214SheetFields(1, full, mission, rows(36), preparedAt)
    for (const name of [...Object.keys(first), ...Object.keys(cont)]) {
      expect(() => form.getTextField(name)).withContext(name).not.toThrow()
    }
    // 24 rows x 2 + 8 resources x 3 + the fixed header and footer fields.
    expect(Object.keys(first).filter(n => /^DateTimeRow\d+$/.test(n)).length).toBe(24)
    expect(Object.keys(cont).filter(n => /^DateTimeRow\d+(_2)?$/.test(n)).length).toBe(36)
    expect(Object.keys(cont).filter(n => /^Notable ActivitiesRow\d+(_2)?$/.test(n)).length).toBe(36)
  })

  it('maps the header, period, resources, rows and footer to the right fields', () => {
    const first = ics214SheetFields(0, header, mission, rows(2), preparedAt)
    expect(first['1 Incident Name_19']).toBe('Fernhollow Flood')
    expect(first['3 Name']).toBe('Pat Doe')
    expect(first['4 ICS Position']).toBe('Radio Operator')
    expect(first['5 Home Agency and Unit']).toBe('Fernhollow CERT')
    expect(first['Date From']).toBe('10/20/2026')
    expect(first['Date To']).toBe('10/20/2026')
    expect(first['Time From']).toBe('08:00')
    expect(first['Time To']).toBe('20:00')
    expect(first['NameRow1_3']).toBe('Sam Roe')
    expect(first['ICS PositionRow1']).toBe('Runner')
    expect(first['Home Agency and UnitRow1']).toBe('Fernhollow CERT')
    expect(first['DateTimeRow1']).toBe('10/20 09:00')
    expect(first['Notable ActivitiesRow2']).toBe('Line 2')
    expect(first['8 Prepared by Name']).toBe('Pat Doe')
    expect(first['PositionTitle_15']).toBe('Radio Operator')
    expect(first['DateTime_15']).toBe('10/20/2026 18:30')
  })

  it('maps continuation rows 1-24 to the _2 names and 25-36 to the bare ones', () => {
    const cont = ics214SheetFields(1, header, mission, rows(36), preparedAt)
    expect(cont['1 Incident Name_20']).toBe('Fernhollow Flood')
    expect(cont['Notable ActivitiesRow1_2']).toBe('Line 1')
    expect(cont['Notable ActivitiesRow24_2']).toBe('Line 24')
    expect(cont['Notable ActivitiesRow25']).toBe('Line 25')
    expect(cont['Notable ActivitiesRow36']).toBe('Line 36')
    expect(cont['8 Prepared by Name_2']).toBe('Pat Doe')
    expect(cont['DateTime_16']).toBe('10/20/2026 18:30')
    expect(cont['3 Name']).toBeUndefined()
  })

  it('never names a signature field, and the output has no live fields left', async () => {
    const names = [...Object.keys(ics214SheetFields(0, header, mission, rows(24), preparedAt)),
      ...Object.keys(ics214SheetFields(1, header, mission, rows(36), preparedAt))]
    expect(names.some(n => /signature/i.test(n))).toBeFalse()
    const out = await PDFDocument.load(await fillIcs214Pdf(templateBytes, header, mission, rows(30), preparedAt))
    expect(out.getForm().getFields().length).withContext('flattened').toBe(0)
    // No page keeps an /Annots list naming widgets the flatten deleted (they read as a damaged file).
    for (const page of out.getPages()) expect(page.node.has(PDFName.of('Annots'))).toBeFalse()
  })

  it('leaves the period blank when the mission has none', () => {
    const none: Ics214Mission = { ...mission, opPeriodStart: new Date(0), opPeriodEnd: new Date(0) }
    const f = ics214SheetFields(0, header, none, rows(1), preparedAt)
    expect(f['Date From']).toBeUndefined()
    expect(f['Time To']).toBeUndefined()
  })

  it('falls back to the mission name when there is no event name', () => {
    const f = ics214SheetFields(0, header, { ...mission, event: '' }, rows(1), preparedAt)
    expect(f['1 Incident Name_19']).toBe('FH-2026')
  })

  it('stamps EXERCISE on every sheet only when asked', async () => {
    const plain = await fillIcs214Pdf(templateBytes, header, mission, rows(30), preparedAt, false)
    const stamped = await fillIcs214Pdf(templateBytes, header, mission, rows(30), preparedAt, true)
    expect(stamped.length).toBeGreaterThan(plain.length)
    expect(await pageCount(stamped)).toBe(2)
  })

  it('prints the RangerTrak version on every sheet only when given (E-280)', async () => {
    const plain = await fillIcs214Pdf(templateBytes, header, mission, rows(30), preparedAt, false)
    const versioned = await fillIcs214Pdf(templateBytes, header, mission, rows(30), preparedAt, false, 'RangerTrak 1.0.0-beta.2')
    expect(versioned.length).toBeGreaterThan(plain.length)
    expect(await pageCount(versioned)).toBe(2)
  })

  it('wraps a long line so no row is wider than the real font allows in its cell', async () => {
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const long = 'Repeater on the north ridge went down at the top of the hour so the net moved to simplex on 146.520 and net control relayed traffic by runner until the repeater trustee restored it. '.repeat(3)
    const note: AarNoteType = { uid: 'x', createdAt: new Date(2026, 9, 20, 9).toISOString(), text: long, page: 'Entry', about: 'incident', kind: 'activity' }
    const built = buildActivityRows([note])
    expect(built.length).toBeGreaterThan(1)
    for (const r of built) {
      expect(font.widthOfTextAtSize(r.text, 10)).withContext(r.text).toBeLessThanOrEqual(ACTIVITY_CELL_MAX_WIDTH)
    }
    const widest = 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW'
    for (const r of buildActivityRows([{ ...note, text: widest }])) {
      expect(font.widthOfTextAtSize(r.text, 10)).toBeLessThanOrEqual(ACTIVITY_CELL_MAX_WIDTH)
    }
    // The filler takes every wrapped row without throwing.
    expect(await pageCount(await fillIcs214Pdf(templateBytes, header, mission, built, preparedAt))).toBeGreaterThanOrEqual(1)
  })
})
