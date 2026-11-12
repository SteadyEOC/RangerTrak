import { PDFDocument, PDFCheckBox } from 'pdf-lib'

import { cleanRr213, rr213Summary } from '../../domain/rr213'
import type { RadioLogEntryType, Rr213Type } from '../services/radio-log-entry.interface'
import { buildIcs309Log } from './ics309-log'
import {
  fillIcs213RrPdf, ICS213RR_FIELD, ICS213RR_PRIORITY_BOX, rr213FieldsFromReport, rr213MsgNoLabel, rrDescField, rrQtyField,
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
    const rr: Rr213Type = { lines: [{ qty: '2', kind: 'Radio battery', type: 'Li-ion', description: 'BaoFeng BL-5', neededBy: '11/12/2026 14:00' }], priority: 'urgent', deliverTo: 'PCC 2', substitutes: 'AA pack' }
    const doc = await PDFDocument.load(await fillWith(rr))
    expect(doc.getPageCount()).toBe(1)
    expect(doc.getForm().getFields().map(f => f.getName())).toEqual([])
  })

  it('maps blocks 1, 2, 5, 6, 7, 8 and the first row, and nothing else', async () => {
    const rr: Rr213Type = { lines: [{ qty: '2', kind: 'Radio battery', type: 'Li-ion', description: 'BaoFeng BL-5', neededBy: '11/12/2026 14:00' }], priority: 'urgent', deliverTo: 'PCC 2', substitutes: 'AA pack' }
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
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX.urgent).isChecked()).toBe(true)
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX.routine).isChecked()).toBe(false)
    expect(form.getCheckBox(ICS213RR_PRIORITY_BOX.low).isChecked()).toBe(false)
    // Never filled: block 3 (Logistics assigns it), the Logistics and Finance bands, estimated arrival, cost.
    for (const n of NEVER_FILLED_TEXT) expect(form.getTextField(n).getText() ?? '', n).toBe('')
    expect(form.getTextField('Arrival Date/Time: EstimatedRow1').getText() ?? '').toBe('')
    expect(form.getTextField('CostRow1').getText() ?? '').toBe('')
    expect((form.getField('16. Order placed by: SPUL') as PDFCheckBox).isChecked()).toBe(false)
    expect((form.getField('16. Order placed by: PROC') as PDFCheckBox).isChecked()).toBe(false)
    // And the mapping never names them.
    for (const n of NEVER_FILLED_TEXT) expect(n in fill.fields, n).toBe(false)
  })

  it('defaults the priority to Routine', () => {
    const fill = rr213FieldsFromReport(report({ lines: [line(1)] }), undefined)
    expect(fill.checked).toEqual([ICS213RR_PRIORITY_BOX.routine])
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
    expect(rr213Summary({ lines: [{ qty: '2', kind: 'radio battery', description: '' }], priority: 'urgent', deliverTo: 'PCC 2' }))
      .toBe('Resource request (ICS-213RR): 2 × radio battery, Urgent, deliver to PCC 2')
    expect(rr213Summary({ lines: [line(1), line(2), line(3)] }))
      .toBe('Resource request (ICS-213RR): 1 cases × Water - Item 1 +2 more, Routine')
  })

  it('cleans a request: trims, drops blank lines and empty optional parts, none when empty', () => {
    expect(cleanRr213({ lines: [{ qty: ' 2 ', kind: ' Water ', type: ' ', description: '', neededBy: '' }, { qty: '', kind: '', description: '' }], deliverTo: ' ' }))
      .toEqual({ lines: [{ qty: '2', kind: 'Water', description: '' }], priority: 'routine' })
    expect(cleanRr213({ lines: [{ qty: '', kind: '', description: '' }] })).toBeUndefined()
  })

  it('puts the request text on the ICS-309 line', () => {
    const e = {
      id: 1, callsign: 'ACS1', location: { lat: 0, lng: 0, address: '', derivedFromAddress: false },
      date: new Date('2026-08-26T14:00:00'), status: 'Normal', notes: 'Need batteries',
      rr213: { lines: [{ qty: '2', kind: 'radio battery', description: '' }], priority: 'urgent' as const, deliverTo: 'PCC 2' },
    } as RadioLogEntryType
    const log = buildIcs309Log([e], { mission: 'M', opPeriod: '', opPeriodStart: new Date(), opPeriodEnd: new Date() })
    expect(log.rows[0].message).toBe('[Normal] Need batteries - Resource request (ICS-213RR): 2 × radio battery, Urgent, deliver to PCC 2')
  })
})
