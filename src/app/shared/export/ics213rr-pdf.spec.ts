import { PDFDocument, PDFCheckBox } from 'pdf-lib'

import { cleanRr213, rr213Brief, rr213DefaultNeededBy, rr213NeededByFromInput, rr213NeededByInputValue, rr213Summary } from '../../domain/rr213'
import type { RadioLogEntryType, Rr213Type } from '../services/radio-log-entry.interface'
import { buildIcs309Log } from './ics309-log'
import {
  fillIcs213RrPdf, ICS213RR_FIELD, ICS213RR_PRIORITY_BOX, rr213DeliverText, rr213FieldsFromReport, rr213MarginFontSize, rr213MsgNoLabel, rrDescField, rrQtyField,
} from './ics213rr-pdf'

/** E-283: fills the REAL bundled ICS 213RR template, as ics213-pdf.spec.ts does for the 213. */

const NEVER_FILLED_TEXT = [
  '3 Resource Request Number', '10 Logistics Order Number', '11 Supplier PhoneFaxEmail', '12 Name of SupplierPOC',
  '13 Notes', '15 DateTime', '17 ReplyComments from Finance', '19 DateTime',
]

const line = (n: number) => ({ qty: `${n} cases`, kind: 'Water', description: `Item ${n}` })

const report = (rr213: Rr213Type): Pick<RadioLogEntryType, 'callsign' | 'tacticalCall' | 'date' | 'rr213'> => ({
  callsign: 'K7ABC', tacticalCall: 'CERT Team 1', date: new Date(2026, 10, 12, 9, 5), rr213,
})

describe('fillIcs213RrPdf', () => {
  let templateBytes: Uint8Array
  beforeAll(async () => {
    const res = await fetch('/assets/forms/ics-213rr.pdf')
    templateBytes = new Uint8Array(await res.arrayBuffer())
  })

  const fillWith = (rr: Rr213Type, msgNo?: { mission: string, opPeriod: string, station: string, seq: number }) =>
    fillIcs213RrPdf(templateBytes, rr213FieldsFromReport(report(rr), { event: 'Test Drill', mission: 'M1' }), false, [], msgNo)

  it('flattens to one page with no live fields left', async () => {
    const rr: Rr213Type = { lines: [{ qty: '2', kind: 'Radio battery', type: 'Li-ion', description: 'BaoFeng BL-5', neededBy: '11/12/2026 14:00' }], priority: 'life-saving', deliverTo: 'PCC 2', substitutes: 'AA pack' }
    const doc = await PDFDocument.load(await fillWith(rr))
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getForm().getFields().map(f => f.getName())).toEqual([])
  })

  it('maps blocks 1, 2, 5, 6, 7, 8 and the first row, and nothing else', async () => {
    const rr: Rr213Type = { lines: [{ qty: '2', kind: 'Radio battery', type: 'Li-ion', description: 'BaoFeng BL-5', neededBy: '11/12/2026 14:00' }], priority: 'life-saving', deliverTo: 'PCC 2', substitutes: 'AA pack' }
    const fill = rr213FieldsFromReport(report(rr), { event: 'Test Drill', mission: 'M1' })
    // The same mapping filled into the live form (not flattened), so the values can be read back.
    const pdf = await PDFDocument.load(templateBytes)
    const form = pdf.getForm()
    for (const [k, v] of Object.entries(fill.fields)) if (v) form.getTextField(k).setText(v)
    for (const c of fill.checked) form.getCheckBox(c).check()

    expect(form.getTextField(ICS213RR_FIELD.incident).getText()).toBe('Test Drill')
    expect(form.getTextField(ICS213RR_FIELD.dateTime).getText()).toBe('11/12/2026 09:05')
    expect(form.getTextField(ICS213RR_FIELD.requestedBy).getText()).toBe('CERT Team 1 (K7ABC)')
    expect(form.getTextField(ICS213RR_FIELD.deliverTo).getText()).toBe('PCC 2')
    expect(form.getTextField(ICS213RR_FIELD.substitutes).getText()).toBe('AA pack')
    expect(form.getTextField(rrQtyField(1)).getText()).toBe('2')
    expect(form.getTextField(rrDescField(1)).getText()).toBe('BaoFeng BL-5')
    // Priority: exactly the chosen box.
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX['life-saving']).isChecked()).toBe(true)
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX['incident-stabilization']).isChecked()).toBe(false)
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX['property-preservation']).isChecked()).toBe(false)
    // Never filled: block 3 (Logistics assigns it), the Logistics and Finance bands, estimated arrival, cost.
    for (const n of NEVER_FILLED_TEXT) expect(form.getTextField(n).getText() ?? '', n).toBe('')
    expect(form.getTextField('Arrival Date/Time: EstimatedRow1').getText() ?? '').toBe('')
    expect(form.getTextField('CostRow1').getText() ?? '').toBe('')
    expect((form.getField('16. Order placed by: SPUL') as PDFCheckBox).isChecked()).toBe(false)
    expect((form.getField('16. Order placed by: PROC') as PDFCheckBox).isChecked()).toBe(false)
    // And the mapping never names them.
    for (const n of NEVER_FILLED_TEXT) expect(n in fill.fields, n).toBe(false)
  })

  it('defaults the priority to Incident stabilization (Routine box)', () => {
    const fill = rr213FieldsFromReport(report({ lines: [line(1)] }), undefined)
    expect(fill.checked).toEqual([ICS213RR_PRIORITY_BOX['incident-stabilization']])
  })

  it('maps nine rows onto the form and the rest onto a continuation page', async () => {
    const lines = Array.from({ length: 12 }, (_, i) => line(i + 1))
    const fill = rr213FieldsFromReport(report({ lines }), undefined)
    expect(fill.fields[rrQtyField(9)]).toBe('9 cases')
    expect(rrQtyField(10) in fill.fields).toBe(false)
    expect(fill.overflow.map(l => l.description)).toEqual(['Item 10', 'Item 11', 'Item 12'])

    expect((await PDFDocument.load(await fillWith({ lines }))).getPageCount()).toBe(2)
    // A request that fits has no continuation.
    expect((await PDFDocument.load(await fillWith({ lines: lines.slice(0, 9) }))).getPageCount()).toBe(1)
  })

  it('prints the message number in the margins only when the entry has one', async () => {
    const msgNo = { mission: '26-0142', opPeriod: 'OP 2', station: 'A', seq: 7 }
    expect(rr213MsgNoLabel(msgNo)).toContain('RangerTrak msg ')
    expect(rr213MsgNoLabel(undefined)).toBe('')
    const plain = await fillWith({ lines: [line(1)] })
    const numbered = await fillWith({ lines: [line(1)] }, msgNo)
    expect(numbered.length).toBeGreaterThan(plain.length)
    expect((await PDFDocument.load(numbered)).getPageCount()).toBe(1)
  })

  it('stamps EXERCISE only when asked', async () => {
    const fill = rr213FieldsFromReport(report({ lines: [line(1)] }), undefined)
    const plain = await fillIcs213RrPdf(templateBytes, fill, false)
    const stamped = await fillIcs213RrPdf(templateBytes, fill, true)
    expect(stamped.length).toBeGreaterThan(plain.length)
  })
})

describe('rr213 text', () => {
  it('summarises a request for the ICS-309 and lists', () => {
    expect(rr213Summary({ lines: [{ qty: '2', kind: 'radio battery', description: '' }], priority: 'life-saving', deliverTo: 'PCC 2' }))
      .toBe('Resource request (ICS-213RR): 2 × radio battery, Life saving, deliver to PCC 2')
    expect(rr213Summary({ lines: [line(1), line(2), line(3)] }))
      .toBe('Resource request (ICS-213RR): 1 cases × Water - Item 1 +2 more, Incident stabilization')
  })

  it('cleans a request: trims, drops blank lines and empty optional parts, none when empty', () => {
    expect(cleanRr213({ lines: [{ qty: ' 2 ', kind: ' Water ', type: ' ', description: '', neededBy: '' }, { qty: '', kind: '', description: '' }], deliverTo: ' ' }))
      .toEqual({ lines: [{ qty: '2', kind: 'Water', description: '' }], priority: 'incident-stabilization' })
    expect(cleanRr213({ lines: [{ qty: '', kind: '', description: '' }] })).toBeUndefined()
  })

  // 2026-11-12, John: "Needed by" is a date-and-time control that starts at the next op period.
  it('defaults Needed by to the op period end while that is ahead, else the top of the next hour', () => {
    const now = new Date(2026, 10, 14, 9, 20)
    expect(rr213DefaultNeededBy(new Date(2026, 10, 14, 18, 0), now)).toBe('11/14/2026 18:00')
    expect(rr213DefaultNeededBy(new Date(2026, 10, 14, 18, 0).toISOString(), now)).toBe('11/14/2026 18:00')
    expect(rr213DefaultNeededBy(new Date(2026, 10, 13, 18, 0), now)).toBe('11/14/2026 10:00')
    expect(rr213DefaultNeededBy(undefined, now)).toBe('11/14/2026 10:00')
    expect(rr213DefaultNeededBy('not a date', new Date(2026, 11, 31, 23, 40))).toBe('01/01/2027 00:00')
  })

  it('converts Needed by between the stored text and the date-and-time control', () => {
    expect(rr213NeededByInputValue('11/14/2026 18:00')).toBe('2026-11-14T18:00')
    expect(rr213NeededByInputValue('1/4/2027 8:05')).toBe('2027-01-04T08:05')
    expect(rr213NeededByInputValue('ASAP')).toBe('')
    expect(rr213NeededByInputValue(undefined)).toBe('')
    expect(rr213NeededByFromInput('2026-11-14T18:00')).toBe('11/14/2026 18:00')
    expect(rr213NeededByFromInput('')).toBe('')
  })

  it('puts the request text on the ICS-309 line', () => {
    const e = {
      id: 1, callsign: 'ACS1', location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
      date: new Date('2026-08-26T14:00:00'), status: 'Normal', notes: 'Need batteries',
      rr213: { lines: [{ qty: '2', kind: 'radio battery', description: '' }], priority: 'life-saving' as const, deliverTo: 'PCC 2' },
    } as RadioLogEntryType
    const log = buildIcs309Log([e], { mission: 'M', opPeriod: '', opPeriodStart: new Date(), opPeriodEnd: new Date() })
    expect(log.rows[0].message).toBe('[Normal] Need batteries - Resource request (ICS-213RR): 2 × radio battery, Life saving, deliver to PCC 2')
  })
})

describe('Washington EMD priorities and the on-site contact (E-283)', () => {
  it('ticks the nearest FEMA box for each Washington priority', () => {
    expect(ICS213RR_PRIORITY_BOX).toEqual({
      'life-saving': '8. Priority: Urgent',
      'incident-stabilization': '8. Priority: Routine',
      'property-preservation': '8. Priority: Low',
    })
    const l = { qty: '1', kind: 'Water', description: '' }
    for (const p of ['life-saving', 'incident-stabilization', 'property-preservation'] as const) {
      const fill = rr213FieldsFromReport({ callsign: 'K7ABC', date: new Date('2026-11-12T09:05:00'), rr213: { lines: [l], priority: p } }, undefined)
      expect(fill.checked).toEqual([ICS213RR_PRIORITY_BOX[p]])
      expect(fill.priority).toBe(p)
    }
  })

  it('prints the Washington words after the message number in the margin', () => {
    const msgNo = { mission: 'GC-1', opPeriod: 'A', station: 'A', seq: 42 }
    const plain = rr213MsgNoLabel(msgNo)
    expect(rr213MsgNoLabel(msgNo, 'life-saving')).toBe(`${plain} · Priority: Life saving`)
    expect(rr213MsgNoLabel(msgNo, 'property-preservation')).toContain('Priority: Property preservation')
    expect(rr213MsgNoLabel(undefined, 'life-saving')).toBe('')
  })

  it('keeps the margin at 8 pt when it fits and shrinks it (not below 5 pt) when it would overflow', () => {
    expect(rr213MarginFontSize(300, 792)).toBe(8)
    expect(rr213MarginFontSize(1440, 792)).toBeLessThan(8)
    expect(rr213MarginFontSize(1440, 792)).toBeGreaterThanOrEqual(5)
    expect(rr213MarginFontSize(100000, 792)).toBe(5)
  })

  it('puts the on-site contact after Deliver to in block 5, with no dangling commas', () => {
    expect(rr213DeliverText({ deliverTo: 'PCC 2', contactName: 'Jo Ames', contactPhone: '206-555-0100' })).toBe('PCC 2. On-site contact: Jo Ames, 206-555-0100')
    expect(rr213DeliverText({ deliverTo: 'PCC 2', contactName: 'Jo Ames' })).toBe('PCC 2. On-site contact: Jo Ames')
    expect(rr213DeliverText({ deliverTo: 'PCC 2', contactPhone: 'PCC 2 on the net' })).toBe('PCC 2. On-site contact: PCC 2 on the net')
    expect(rr213DeliverText({ contactName: 'Jo Ames' })).toBe('On-site contact: Jo Ames')
    expect(rr213DeliverText({ deliverTo: 'PCC 2' })).toBe('PCC 2')
    expect(rr213DeliverText(undefined)).toBe('')
    const fill = rr213FieldsFromReport({ callsign: 'K7ABC', date: new Date('2026-11-12T09:05:00'), rr213: { lines: [{ qty: '1', kind: 'Water', description: '' }], deliverTo: 'PCC 2', contactName: 'Jo', contactPhone: '555' } }, undefined)
    expect(fill.fields[ICS213RR_FIELD.deliverTo]).toBe('PCC 2. On-site contact: Jo, 555')
  })

  it('adds the contact to the summary the same way, and cleans it', () => {
    const lines = [{ qty: '2', kind: 'radio battery', description: '' }]
    expect(rr213Summary({ lines, priority: 'life-saving', deliverTo: 'PCC 2', contactName: 'Jo Ames', contactPhone: '206-555-0100' }))
      .toBe('Resource request (ICS-213RR): 2 × radio battery, Life saving, deliver to PCC 2, contact Jo Ames 206-555-0100')
    expect(rr213Brief({ lines, contactPhone: 'PCC 2 on the net' })).toBe('2 × radio battery, Incident stabilization, contact PCC 2 on the net')
    expect(rr213Brief({ lines })).toBe('2 × radio battery, Incident stabilization')
    expect(cleanRr213({ lines, contactName: ' Jo ', contactPhone: '  ' })).toEqual({ lines, priority: 'incident-stabilization', contactName: 'Jo' })
  })
})
