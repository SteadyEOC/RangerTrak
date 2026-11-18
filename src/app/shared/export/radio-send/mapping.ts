/**
 * E-307: what "Send by radio" sends, per form. Pure: no Angular, no DOM, no library import at run time (the
 * emcomm-forms writers are called by the dialog, which loads them on demand). This file only maps the
 * app's own data to the writers' inputs, REUSING the builders the PDF exports use (ics213FieldsFromReport,
 * rr213FieldsFromReport, ics214SheetFields, buildIcs309Log) so the radio text can never drift from the paper.
 *
 * Rule 5: the roster never rides along. Only names already on the paper form (the tactical call and call
 * sign in From/To, the operator on Approved by) are used; nothing is looked up in the roster.
 *
 * Q112: an address RangerTrak looked up (shown on screen as "(inferred)") is written with a leading "~"
 * (plain ASCII, so it survives Winlink and FLDIGI). See radioAddress().
 */
import { chunkActivityRows, type ActivityRow, type ActivityLogHeader } from '../../../domain/activity-log'
import { csvRow } from '../csv'
import { ics213FieldsFromReport } from '../ics213-pdf'
import { ICS213RR_FIELD, rr213FieldsFromReport, rrDescField, rrKindField, rrNeededField, rrQtyField, rrTypeField, ICS213RR_ROWS } from '../ics213rr-pdf'
import { formDate, formTime, ics214SheetFields } from '../ics214-pdf'
import { buildIcs309Log, type Ics309MissionInfo } from '../ics309-log'
import { rr213PriorityLabel } from '../../../domain/rr213'
import type { RadioLogEntryType } from '../../services/radio-log-entry.interface'
import type { MissionType } from '../../services/mission.interface'

export type RadioForm = 'ics213' | 'ics213rr' | 'ics214' | 'ics309'
export type SaveDataFormId = 'ICS-213' | 'ICS-213RR' | 'ICS-214'
export type SaveDataValues = Record<string, string | number>
export type FlmsgFormName = 'ics213' | 'ics309' | 'plaintext' | 'csvform'

export interface RadioFlmsg {
  form: FlmsgFormName
  fields: Record<string, string>
  rows?: Record<string, string>[]
  /** Plain words for the dialog: which FLMSG file this is and why (only the 309 can differ). */
  note: string
}

export interface RadioPayload {
  form: RadioForm
  /** "ICS-213" and so on, for button and journal text. */
  formLabel: string
  /** Heading line of the plain text. */
  title: string
  /** Prefilled message subject (editable in the dialog). */
  subject: string
  /** "Label: value" lines of the plain text. */
  fields: { label: string, value: string }[]
  /** Free text after the fields. */
  body: string
  /** The Load Data file's input. Absent for the 309, which has no Save Data layout. */
  saveData?: { formId: SaveDataFormId, values: SaveDataValues }
  flmsg: RadioFlmsg
  /** How many lines did not fit the form's own Save Data rows (they are still in the text). */
  notInSaveData: number
}

/** Q112: a looked-up address reads "~123 Main St"; one the scribe typed or was told stays as written. */
export function radioAddress(location: { address?: string, derivedFromAddress?: boolean } | undefined): string {
  const a = (location?.address ?? '').trim()
  if (!a) return ''
  return location?.derivedFromAddress === false ? `~${a}` : a
}

const mm = (d: Date) => `${formDate(d)} ${formTime(d)}`
const one = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/** The 213's own message text. Address is not a field on the 213, so none is added. */
export function ics213Payload(report: RadioLogEntryType, mission: MissionType | undefined): RadioPayload {
  const f = ics213FieldsFromReport(report, mission)
  const incident = f['1 Incident Name Optional'] ?? ''
  const to = f['2 To Name and Position'] ?? ''
  const from = f['3 From Name and Position'] ?? ''
  const subject = f['4 Subject'] ?? ''
  const date = f['5 Date'] ?? ''
  const time = f['6 Time'] ?? ''
  const message = f['7 Message'] ?? ''
  const approved = f['8 Approved by Name'] ?? ''
  return {
    form: 'ics213', formLabel: 'ICS-213', title: 'GENERAL MESSAGE (ICS 213)',
    subject: subject || `ICS-213 ${from}`.trim(),
    fields: [
      { label: '1. Incident name', value: incident },
      { label: '2. To', value: to },
      { label: '3. From', value: from },
      { label: '4. Subject', value: subject },
      { label: '5. Date', value: date },
      { label: '6. Time', value: time },
      { label: '8. Approved by', value: approved },
    ].filter(x => x.value),
    body: message,
    saveData: {
      formId: 'ICS-213',
      values: {
        inc_name: incident, to_name: to, fm_name: from,
        // The form's own Subject box holds 50 characters; longer text would be cut when loaded.
        Subjectline: subject.slice(0, 50), Mdate: date, Mtime: time, Message: message, Approved_Name: approved,
      },
    },
    flmsg: {
      form: 'ics213', note: 'This is an FLMSG ICS-213 file (.213).',
      fields: { inc: incident, to, fm: from, sb: subject, d1: date, t1: time, mg: message, s1: approved },
    },
    notInSaveData: 0,
  }
}

export function ics213rrPayload(report: RadioLogEntryType, mission: MissionType | undefined): RadioPayload {
  const fill = rr213FieldsFromReport(report, mission)
  const g = (k: string) => fill.fields[k] ?? ''
  const incident = g(ICS213RR_FIELD.incident)
  const when = g(ICS213RR_FIELD.dateTime)
  const requestedBy = g(ICS213RR_FIELD.requestedBy)
  const deliver = g(ICS213RR_FIELD.deliverTo)
  const subs = g(ICS213RR_FIELD.substitutes)
  const priority = rr213PriorityLabel(fill.priority)
  const lines = [...Array(ICS213RR_ROWS).keys()].map(i => i + 1).map(n => ({
    qty: g(rrQtyField(n)), kind: g(rrKindField(n)), type: g(rrTypeField(n)), item: g(rrDescField(n)), needed: g(rrNeededField(n)),
  })).filter(l => l.qty || l.kind || l.type || l.item || l.needed)
  const overflow = fill.overflow.map(l => ({ qty: l.qty ?? '', kind: l.kind ?? '', type: l.type ?? '', item: l.description ?? '', needed: l.neededBy ?? '' }))
  const all = [...lines, ...overflow]
  const lineText = (l: typeof all[number], i: number) =>
    `${i + 1}. ${[l.qty, l.kind, l.type].filter(Boolean).join(' ')}${l.item ? ` - ${l.item}` : ''}${l.needed ? ` (needed ${l.needed})` : ''}`.trim()
  const body = all.map(lineText).join('\n')
  const sd: SaveDataValues = { IncName: incident, ActivityDateTime1: when, ReqName: requestedBy, Delivery: deliver, Subs1: subs, Priority: priority }
  // The form's own Save Data has 8 rows; the 9th and later stay in the text only.
  lines.slice(0, 8).forEach((l, i) => {
    const n = i + 1
    sd[`Qty${n}`] = l.qty; sd[`Kind${n}`] = l.kind; sd[`Type${n}`] = l.type; sd[`Item${n}`] = l.item; sd[`ReqDateTime${n}`] = l.needed
  })
  const fields = [
    { label: 'Incident name', value: incident }, { label: 'Date/time', value: when }, { label: 'Priority', value: priority },
    { label: 'Requested by', value: requestedBy }, { label: 'Deliver to', value: deliver }, { label: 'Substitutes', value: subs },
  ].filter(x => x.value)
  return {
    form: 'ics213rr', formLabel: 'ICS-213RR', title: 'RESOURCE REQUEST (ICS 213RR)',
    subject: `ICS-213RR resource request${requestedBy ? ` from ${requestedBy}` : ''}`,
    fields, body: body ? `Items requested:\n${body}` : '',
    saveData: { formId: 'ICS-213RR', values: sd },
    flmsg: {
      form: 'plaintext', note: 'FLMSG has no 213RR form, so this is an FLMSG plain text file (.p2s).',
      fields: { tt: 'RESOURCE REQUEST (ICS 213RR)', fm: requestedBy, sb: `ICS-213RR ${incident}`.trim(), dt: when.split(' ')[0] ?? '', tm: when.split(' ')[1] ?? '', mg: [fields.map(x => `${x.label}: ${x.value}`).join('\n'), body].filter(Boolean).join('\n\n') },
    },
    notInSaveData: Math.max(0, all.length - 8),
  }
}

export function ics214Payload(
  header: ActivityLogHeader, mission: Pick<MissionType, 'event' | 'mission' | 'opPeriodStart' | 'opPeriodEnd'>,
  rows: readonly ActivityRow[], preparedAt: Date,
): RadioPayload {
  const sheets = chunkActivityRows(rows)
  const first = ics214SheetFields(0, header, mission, sheets[0] ?? [], preparedAt)
  const incident = first['1 Incident Name_19'] ?? ''
  const from = first['Date From'] ? `${first['Date From']} ${first['Time From'] ?? ''}`.trim() : ''
  const to = first['Date To'] ? `${first['Date To']} ${first['Time To'] ?? ''}`.trim() : ''
  const lineText = (r: ActivityRow) => `${r.time}  ${r.text}`
  const body = rows.map(lineText).join('\n')
  const resources = header.resources.map(r => [r.name, r.icsPosition, r.homeAgency].filter(Boolean).join(', ')).filter(Boolean)
  const fields = [
    { label: 'Incident name', value: incident }, { label: 'Operational period', value: [from, to].filter(Boolean).join(' to ') },
    { label: 'Name', value: one(header.name) }, { label: 'ICS position', value: one(header.icsPosition) },
    { label: 'Home agency', value: one(header.homeAgency) },
    ...(resources.length ? [{ label: 'Resources assigned', value: resources.join('; ') }] : []),
  ].filter(x => x.value)
  const sd: SaveDataValues = {
    Incident_Name: incident, DateTimeFrom: from, DateTimeTo: to, Name: one(header.name), ICS_Position: one(header.icsPosition),
    Home_Agency: one(header.homeAgency), PreparedName: one(header.name),
  }
  header.resources.slice(0, 8).forEach((r, i) => {
    const sfx = i === 0 ? '1' : String(i + 1)
    sd[`Name${sfx}`] = one(r.name); sd[`ICS_Position${sfx}`] = one(r.icsPosition); sd[`Home_Agency${sfx}`] = one(r.homeAgency)
  })
  rows.slice(0, 24).forEach((r, i) => { sd[`ActivityDateTime${i + 1}`] = r.time; sd[`Activities${i + 1}`] = r.text })
  const prepared = `${formDate(preparedAt)} ${formTime(preparedAt)}`
  return {
    form: 'ics214', formLabel: 'ICS-214', title: 'ACTIVITY LOG (ICS 214)',
    subject: `ICS-214 Activity Log${incident ? ` - ${incident}` : ''}`,
    fields, body: body ? `Activity log:\n${body}` : '',
    saveData: { formId: 'ICS-214', values: sd },
    flmsg: {
      form: 'plaintext', note: 'FLMSG has no 214 form, so this is an FLMSG plain text file (.p2s).',
      fields: { tt: 'ACTIVITY LOG (ICS 214)', fm: one(header.name), sb: `ICS-214 ${incident}`.trim(), dt: formDate(preparedAt), tm: formTime(preparedAt), mg: [fields.map(x => `${x.label}: ${x.value}`).join('\n'), body, `Prepared ${prepared}`].filter(Boolean).join('\n\n') },
    },
    notInSaveData: Math.max(0, rows.length - 24),
  }
}

/** FLMSG's ICS-309 holds 34 rows; a longer log goes as CSV text in a plain FLMSG form. */
export const FLMSG_309_MAX_ROWS = 34

export function ics309Payload(
  reports: readonly RadioLogEntryType[], mission: Ics309MissionInfo, now: Date, preparedBy = '',
): RadioPayload {
  const log = buildIcs309Log(reports, mission, now, preparedBy)
  const byTime = [...reports].sort((a, b) => a.date.getTime() - b.date.getTime())
  const rows = log.rows.map((r, i) => {
    // Q112: the report's address, "~" in front when RangerTrak looked it up. Added here because the radio
    // reader has no map; the paper log has no cell for it.
    const where = radioAddress(byTime[i]?.location)
    return {
      tm: formTime(r.time), to: one(r.to), fm: one(r.from),
      msg: [one(r.message), where ? `Where: ${where}` : ''].filter(Boolean).join(' | '),
    }
  })
  const h = log.header
  const period = h.operationalPeriod
  const fields = [
    { label: 'Incident name', value: h.incidentName }, { label: 'Operational period', value: period },
    { label: 'Prepared', value: mm(h.datePrepared) }, { label: 'Prepared by', value: h.preparedBy },
  ].filter(x => x.value)
  const body = rows.map(r => `${r.tm} ${r.fm}${r.to ? ` > ${r.to}` : ''}: ${r.msg}`).join('\n')
  const fits = rows.length <= FLMSG_309_MAX_ROWS
  const csv = [csvRow(['Time', 'From', 'To', 'Message']), ...rows.map(r => csvRow([r.tm, r.fm, r.to, r.msg]))].join('\n')
  const dfm = h.opPeriodStart ? formDate(h.opPeriodStart) : ''
  const tfm = h.opPeriodStart ? formTime(h.opPeriodStart) : ''
  const dto = h.opPeriodEnd ? formDate(h.opPeriodEnd) : ''
  const tto = h.opPeriodEnd ? formTime(h.opPeriodEnd) : ''
  return {
    form: 'ics309', formLabel: 'ICS-309', title: 'COMMUNICATIONS LOG (ICS 309)',
    subject: `ICS-309 Communications Log${h.incidentName ? ` - ${h.incidentName}` : ''}`,
    fields, body: body ? `Log:\n${body}` : '',
    flmsg: fits
      ? {
        form: 'ics309', note: `This is an FLMSG ICS-309 file (.309): the log has ${rows.length} rows, within FLMSG's limit of ${FLMSG_309_MAX_ROWS}.`,
        fields: { inc: h.incidentName, dfm, tfm, dto, tto, pre: h.preparedBy, dtm: mm(h.datePrepared) }, rows,
      }
      : {
        form: 'csvform', note: `This is an FLMSG CSV file (.c2s): the log has ${rows.length} rows, more than the ${FLMSG_309_MAX_ROWS} an FLMSG ICS-309 holds.`,
        fields: { mg: csv },
      },
    notInSaveData: 0,
  }
}

/** Name for a saved file: letters, digits and dashes only. */
export function radioFileStem(payload: Pick<RadioPayload, 'form'>, tag: string): string {
  const t = tag.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return `${payload.form}${t ? `-${t}` : ''}`
}
