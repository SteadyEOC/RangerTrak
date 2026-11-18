import { check } from 'emcomm-forms'
import * as EmcommForms from 'emcomm-forms'

import type { RadioLogEntryType } from '../../services/radio-log-entry.interface'
import type { MissionType } from '../../services/mission.interface'
import { buildB2f, buildFlmsg, buildSaveData, buildText, transferEstimate } from './outputs'
import {
  FLMSG_309_MAX_ROWS, ics213Payload, ics213rrPayload, ics214Payload, ics309Payload, radioAddress, type RadioPayload,
} from './mapping'

const forms = EmcommForms
const mission = {
  event: 'Test Drill', mission: 'M1', opPeriod: 'OP 1',
  opPeriodStart: new Date(2026, 10, 12, 8, 0), opPeriodEnd: new Date(2026, 10, 12, 20, 0),
} as MissionType

const entry = (over: Partial<RadioLogEntryType> = {}): RadioLogEntryType => ({
  id: 1, callsign: 'K7ABC', tacticalCall: 'CERT Team 1', toCallsign: 'W7EOC',
  location: { lat: 0, lng: 0, address: '', derivedFromAddress: true },
  date: new Date(2026, 10, 12, 9, 5), status: 'Normal', notes: 'Team at the trailhead.',
  generates213: true, subject213: 'Trail status', message213: 'Trail is clear.\nNo injuries.', recipients213: ['Incident Commander'],
  operator: 'Pat Q', ...over,
}) as RadioLogEntryType

const rrEntry = (): RadioLogEntryType => entry({
  rr213: {
    priority: 'life-saving', deliverTo: 'Staging', contactName: 'Sam', contactPhone: '',
    substitutes: 'any', lines: Array.from({ length: 10 }, (_, i) => ({ qty: String(i + 1), kind: 'Each', type: '', description: `Item ${i + 1}`, neededBy: '' })),
  },
} as Partial<RadioLogEntryType>)

describe('Send by radio mapping (E-307)', () => {
  const payloads = (): { name: string, p: RadioPayload }[] => [
    { name: '213', p: ics213Payload(entry(), mission) },
    { name: '213RR', p: ics213rrPayload(rrEntry(), mission) },
    { name: '214', p: ics214Payload(
      { name: 'Pat Q', icsPosition: 'Radio Operator', homeAgency: 'CERT', resources: [{ name: 'Sam', icsPosition: 'Scout', homeAgency: 'CERT' }] },
      mission, [{ time: '11/12 09:05', text: 'Opened net' }], new Date(2026, 10, 12, 17, 0)) },
  ]

  it('writes Save Data files the checker accepts, for every form that has a layout', () => {
    for (const { name, p } of payloads()) {
      const out = buildSaveData(forms, p)!
      const result = check(out.bytes, `${name}.txt`)
      expect(result.kind, name).toBe('save-data')
      expect(result.errors, `${name}: ${result.issues.map(i => i.message).join('; ')}`).toBe(0)
    }
  })

  it('can go red: a wrong Save Data key is refused by the writer', () => {
    const p = ics213Payload(entry(), mission)
    const broken: RadioPayload = { ...p, saveData: { formId: 'ICS-213', values: { ...p.saveData!.values, Subject_line: 'x' } } }
    expect(() => buildSaveData(forms, broken)).toThrow(RangeError)
  })

  it('writes Pat outbox messages the checker accepts', () => {
    for (const { name, p } of payloads()) {
      const { bytes, name: file } = buildB2f(forms, p, { call: 'K7ABC', to: ['W7EOC', 'SMTP:eoc@example.org'], cc: [], subject: p.subject, at: new Date(Date.UTC(2026, 10, 12, 17, 5)) })
      expect(file).toMatch(/^[A-Z0-9]{12}\.b2f$/)
      const result = check(bytes, file)
      expect(result.kind, name).toBe('b2f')
      expect(result.errors, `${name}: ${result.issues.map(i => i.message).join('; ')}`).toBe(0)
    }
  })

  it('writes the 309 as a b2f the checker accepts (the 309 has no Save Data layout)', () => {
    const p = ics309Payload([entry()], mission, new Date(2026, 10, 12, 17, 0))
    expect(p.saveData).toBeUndefined()
    expect(buildSaveData(forms, p)).toBeNull()
    const { bytes, name } = buildB2f(forms, p, { call: 'K7ABC', to: ['W7EOC'], cc: [], subject: p.subject, at: new Date() })
    expect(check(bytes, name).errors).toBe(0)
  })

  it('uses the same text the paper form shows, and never the roster', () => {
    const p = ics213Payload(entry(), mission)
    expect(p.saveData!.values).toMatchObject({
      inc_name: 'Test Drill', to_name: 'Incident Commander', fm_name: 'CERT Team 1 (K7ABC)',
      Subjectline: 'Trail status', Mdate: '11/12/2026', Approved_Name: 'Pat Q',
    })
    expect(p.body).toBe('Trail is clear.\nNo injuries.')
  })

  it('keeps a 213 subject to the form\'s 50 characters in Save Data only', () => {
    const long = 'x'.repeat(80)
    const p = ics213Payload(entry({ subject213: long }), mission)
    expect(String(p.saveData!.values['Subjectline'])).toHaveLength(50)
    expect(p.subject).toBe(long)
  })

  it('213RR: eight rows in Save Data, every item in the text', () => {
    const p = ics213rrPayload(rrEntry(), mission)
    expect(p.notInSaveData).toBe(2)
    expect(p.saveData!.values['Item8']).toBe('Item 8')
    expect(p.saveData!.values['Item9']).toBeUndefined()
    expect(p.body).toContain('10. 10 Each - Item 10')
  })

  it('writes the FLMSG files: 213, plain text for 213RR and 214', () => {
    const at = new Date(Date.UTC(2026, 10, 12, 17, 5))
    const f213 = buildFlmsg(forms, ics213Payload(entry(), mission), 'K7ABC', at)
    expect(f213.ext).toBe('.213')
    expect(f213.text).toContain('Trail is clear.')
    expect(buildFlmsg(forms, ics213rrPayload(rrEntry(), mission), 'K7ABC', at).ext).toBe('.p2s')
    expect(buildFlmsg(forms, payloads()[2].p, '', at).ext).toBe('.p2s')
  })

  describe('ICS-309 and FLMSG', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => entry({ id: i, date: new Date(2026, 10, 12, 9, i % 60), notes: `note ${i}` }))
    it('is FLMSG\'s own .309 at 34 rows and a CSV .c2s at 35, and says which', () => {
      const at = new Date()
      const a = ics309Payload(many(FLMSG_309_MAX_ROWS), mission, at)
      expect(a.flmsg.form).toBe('ics309')
      expect(buildFlmsg(forms, a, 'K7ABC', at).ext).toBe('.309')
      expect(a.flmsg.note).toContain('.309')
      const b = ics309Payload(many(FLMSG_309_MAX_ROWS + 1), mission, at)
      expect(b.flmsg.form).toBe('csvform')
      expect(buildFlmsg(forms, b, 'K7ABC', at).ext).toBe('.c2s')
      expect(b.flmsg.note).toContain('.c2s')
      expect(b.flmsg.fields['mg']).toContain('"Time","From","To","Message"')
    })
  })

  describe('looked-up addresses carry a ~ (Q112)', () => {
    it('marks only an address RangerTrak looked up (derivedFromAddress false)', () => {
      expect(radioAddress({ address: '12 Main St', derivedFromAddress: false })).toBe('~12 Main St')
      expect(radioAddress({ address: '12 Main St', derivedFromAddress: true })).toBe('12 Main St')
      expect(radioAddress({ address: '  ', derivedFromAddress: false })).toBe('')
      expect(radioAddress(undefined)).toBe('')
    })

    it('puts the ~ in the 309 text and its FLMSG rows, and leaves said addresses alone', () => {
      const looked = entry({ id: 1, location: { lat: 1, lng: 2, address: '12 Main St', derivedFromAddress: false } })
      const said = entry({ id: 2, date: new Date(2026, 10, 12, 9, 10), location: { lat: 1, lng: 2, address: 'north gate', derivedFromAddress: true } })
      const p = ics309Payload([looked, said], mission, new Date())
      expect(p.body).toContain('Where: ~12 Main St')
      expect(p.body).toContain('Where: north gate')
      expect(p.body).not.toContain('~north gate')
      expect(p.flmsg.rows![0]['msg']).toContain('~12 Main St')
      expect(buildText(forms, p).text).toContain('~12 Main St')
    })
  })

  it('reports the size and a slow-link estimate', () => {
    expect(transferEstimate(300)).toBe('about 1 second')
    expect(transferEstimate(3000)).toBe('about 10 seconds')
    expect(transferEstimate(60000)).toBe('about 3 minutes')
    const out = buildText(forms, ics213Payload(entry({ message213: 'Caf\u00e9 \u2014 ok' }), mission))
    expect(out.folded).toBe(true)
    expect(out.bytes).toBeGreaterThan(50)
  })
})
