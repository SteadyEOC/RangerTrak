import { RadioLogEntryType } from '../services/radio-log-entry.interface'

/**
 * Shapes field reports into an ICS-309 (Communications Log) structure - the DATA, not a
 * rendering. E-31/E-41 phase 3, second of four pieces (see the roadmap's 2026-08-26
 * rescoping).
 *
 * Unlike the 213 (`ics213-pdf.ts`), the 309 has no usable fillable-PDF template to fill:
 * checked, and it isn't even among FEMA's own official forms (it's an ARES/ham-community
 * standard, not FEMA-issued), and every "fillable" copy found online turned out to be flat -
 * no AcroForm fields at all. That tracks structurally too: a 309 is a variable-length LOG,
 * which doesn't fit a fixed-position template the way a single-message 213 does. So the 309
 * is generated - this module produces the rows and header, a later print/PDF view renders
 * them.
 *
 * Row shape matches this project's OWN prior verified research (see the roadmap's E-41 row,
 * "checked against the actual ICS-309 form structure"): Time + a single free-text Message
 * column - the real form has no structured To/Subject field, that's conventionally written
 * inline. `from` is kept as its own column anyway, not folded into the message text - our
 * data model already has `callsign` as a distinct field (D-42: kept on the report
 * deliberately, "the primary evidence of who reported"), and collapsing a field we already
 * have cleanly separated back into free text would only make the log harder to scan.
 *
 * Pure - no injection, no Date formatting library, no DOM - same split as
 * `ranger-migration.ts` and `ics213-pdf.ts`. A caller supplies already-resolved mission
 * strings rather than this module reading `MissionType` itself, so it stays testable with
 * plain objects and has no Angular dependency.
 */

export interface Ics309LogHeader {
  incidentName: string
  operationalPeriod: string
  datePrepared: Date
  // F29-48 (2026-08-29, D-44): the real ICS-309 form's "Prepared by: Name / Position /
  // Signature" footer - whoever is generating THIS log printout, not any one report's own
  // operator (RadioLogEntryType.operator, a separate per-row concept this module doesn't
  // surface - see the roadmap for why). Optional/blank same as datePrepared has no "unknown"
  // sentinel: this module has no UI wired to it yet (E-31/E-41 phase 3 status), so there is
  // nowhere for a caller to source this from today beyond passing it through.
  preparedBy: string
  // 2026-09-25: the standard form's box 2 splits the period into From/To date and time, so
  // the raw bounds travel alongside the formatted `operationalPeriod` string. Null when the
  // mission has no operational period at all (the same case that string is blank for).
  opPeriodStart: Date | null
  opPeriodEnd: Date | null
}

export interface Ics309LogRow {
  time: Date
  from: string
  // F29-46 (2026-08-29): ICS-309 has a genuine notion of how traffic arrived (radio, phone,
  // packet, ...) - a real per-contact fact, unlike `preparedBy` above which describes the log
  // as a whole. Blank for anything filed before `source` existed (E-41 phase 1).
  source: string
  message: string
}

export interface Ics309Log {
  header: Ics309LogHeader
  rows: Ics309LogRow[]
}

/** What a caller pulls from `MissionType` - kept narrow so this module has no Angular tie. */
export interface Ics309MissionInfo {
  mission: string
  opPeriod: string
  opPeriodStart: Date
  opPeriodEnd: Date
}

/**
 * `reports` is filtered by the caller first (Radio Log page's "all visible", "selected", or
 * "since the last print" scope picker - see the roadmap note) - this function only orders
 * and formats whatever it's handed, it does not itself decide which reports belong in a log.
 */
export function buildIcs309Log(
  reports: readonly RadioLogEntryType[],
  mission: Ics309MissionInfo,
  now: Date = new Date(),
  preparedBy: string = '',
): Ics309Log {
  const rows = [...reports]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((r): Ics309LogRow => ({
      time: r.date,
      from: r.callsign?.trim() || '(no callsign)',
      source: r.source ?? '',
      message: formatMessage(r),
    }))

  return {
    header: {
      incidentName: mission.mission,
      operationalPeriod: formatOperationalPeriod(mission),
      datePrepared: now,
      preparedBy,
      opPeriodStart: hasOperationalPeriod(mission) ? mission.opPeriodStart : null,
      opPeriodEnd: hasOperationalPeriod(mission) ? mission.opPeriodEnd : null,
    },
    rows,
  }
}

/**
 * `[Status] notes` - status is always shown, not just when it differs from some hardcoded
 * "Normal" default. Status text is a fully operator-configurable string
 * (`MissionType.radioLogStatuses`), so special-casing a literal `'Normal'` here would be
 * exactly the naive-string-match trap this project has already been bitten by once
 * ([[settings-marker-field-trap]]) - it would silently stop bracketing the moment someone
 * renamed their default status.
 */
function formatMessage(report: RadioLogEntryType): string {
  const status = report.status?.trim()
  const notes = report.notes?.trim() ?? ''
  return status ? `[${status}] ${notes}`.trim() : notes
}

function hasOperationalPeriod(mission: Ics309MissionInfo): boolean {
  return !!(mission.opPeriod || mission.opPeriodStart || mission.opPeriodEnd)
}

function formatOperationalPeriod(mission: Ics309MissionInfo): string {
  if (!hasOperationalPeriod(mission)) return ''
  const label = mission.opPeriod ? `${mission.opPeriod}: ` : ''
  // hour12: false - 24-hour clock throughout the app, and ICS-309's own convention.
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }
  return `${label}${mission.opPeriodStart.toLocaleString([], opts)} - ${mission.opPeriodEnd.toLocaleString([], opts)}`
}
