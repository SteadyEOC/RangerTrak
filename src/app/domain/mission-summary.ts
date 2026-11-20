/**
 * E-189: the numbers behind the Mission summary page, its printout and its CSV.
 *
 * One pure function, computed live from the radio log, roster, mission statuses and AAR notes
 * every time it is asked. Nothing here is stored, and nothing here stops field work: it only
 * reads. Framework-free (D-57); the caller passes `now`, so there is no clock in here.
 *
 * Everything time-based uses the entry's `date` (when the traffic happened), never `loggedAt`
 * (when it was typed in) - `loggedAt` is used only to say whether an entry was logged late.
 */
import type { AarNoteType } from './model/aar-note.interface'
import type { RadioLogEntryType, RadioLogStatusType } from './model/radio-log-entry.interface'
import type { RangerType } from './model/ranger.interface'
import { flaggedStatuses } from './map-entry-filter'
import { formatStation } from './station-label'

/** An entry logged more than this long after it happened is "late". */
export const LATE_ENTRY_MINUTES = 15
/** The bucket sizes the chart may use, smallest first. */
export const BUCKET_HOURS_CHOICES = [1, 2, 3, 6, 12, 24] as const
/** The most bars the chart draws (as long as a 24-hour bucket can satisfy it). */
export const MAX_BUCKETS = 48

export const NO_TEAM_LABEL = 'No team / not on roster'
export const NOT_RECORDED_LABEL = '(not recorded)'
export const NO_STATION_LABEL = '(no call sign)'
export const NO_AREA_LABEL = 'No area'
/** Colour for a status found on entries but not in the mission's status list. */
export const UNKNOWN_STATUS_COLOR = '#A3A3A3'

export type SummaryInput = {
  entries: readonly RadioLogEntryType[]
  rangers: readonly RangerType[]
  statuses: readonly RadioLogStatusType[]
  notes: readonly AarNoteType[]
  /** null = the whole log. */
  window: { from: Date; to: Date } | null
  now: Date
}

export type SummaryBucket = { start: Date; count: number; attentionCount: number }
export type SummaryCount = { label: string; count: number }
export type SummaryStatusRow = { status: string; color: string; count: number; inSettings: boolean }
export type SummaryStationRow = { station: string; count: number; lastHeard: Date }
export type SummaryNoteGroup = { area: string; notes: AarNoteType[] }

export type MissionSummary = {
  generatedAt: Date
  window: {
    from: Date
    to: Date
    /** The requested end was still in the future, so `to` was clipped at `now`. */
    soFar: boolean
    /** The whole log was asked for (window was null). */
    wholeLog: boolean
  }
  totals: {
    entries: number
    stations: number
    first: Date | null
    last: Date | null
    /** Entries edited after they were logged (`revisedAt` set). */
    revised: number
    /** Entries logged more than LATE_ENTRY_MINUTES after they happened. */
    late: number
    /** Entries whose status is flagged "needs attention". */
    attention: number
  }
  buckets: { hours: number; items: SummaryBucket[] }
  byStatus: SummaryStatusRow[]
  byTeam: SummaryCount[]
  /** Each team's messages split by status, in the same order as `byStatus` (for stacked bars). */
  byTeamStatus: Record<string, { status: string; count: number }[]>
  byStation: SummaryStationRow[]
  byOperator: SummaryCount[]
  bySource: SummaryCount[]
  /** Newest first. */
  attention: RadioLogEntryType[]
  aar: {
    groups: SummaryNoteGroup[]
    /** Incident notes in the window (the ones listed in `groups`). */
    incidentCount: number
    /** Notes about RangerTrak itself: counted, not listed. */
    appCount: number
  }
}

function ms(d: Date | string | undefined | null): number {
  if (d === undefined || d === null) return NaN
  return new Date(d).getTime()
}

/** The start of the bucket containing `d`: local time, floored to a multiple of `hours`. */
function floorToBucket(d: Date, hours: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(d.getHours() / hours) * hours)
}

/**
 * Bucket starts, local time, contiguous (a bucket for every step even when it is empty). Stops
 * once the next start would be at or past `to`; always at least one. Local-time arithmetic
 * (hour overflow), so a daylight-saving change cannot skip or repeat a bar. `limit` stops the
 * walk early for sizes that are going to be rejected anyway.
 */
function bucketStarts(from: Date, to: Date, hours: number, limit: number): Date[] {
  const first = floorToBucket(from, hours)
  const starts = [first]
  while (starts.length <= limit) {
    const n = starts.length
    const next = new Date(first.getFullYear(), first.getMonth(), first.getDate(), first.getHours() + n * hours)
    if (next.getTime() >= to.getTime()) break
    starts.push(next)
  }
  return starts
}

/** The smallest bucket size that gives at most MAX_BUCKETS bars (24 h when none does). */
function chooseBuckets(from: Date, to: Date): { hours: number; starts: Date[] } {
  for (const hours of BUCKET_HOURS_CHOICES) {
    const starts = bucketStarts(from, to, hours, MAX_BUCKETS)
    if (starts.length <= MAX_BUCKETS) return { hours, starts }
  }
  return { hours: 24, starts: bucketStarts(from, to, 24, Number.MAX_SAFE_INTEGER) }
}

function tally(labels: Iterable<string>): SummaryCount[] {
  const counts = new Map<string, number>()
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function summarizeMission(input: SummaryInput): MissionSummary {
  const { rangers, statuses, notes, now } = input

  // 1. Entries with a usable time, oldest first.
  const dated = input.entries
    .map(e => ({ e, t: ms(e.date) }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.e.id - b.e.id)

  // 2. The window actually used.
  const wholeLog = input.window === null
  let from: Date
  let to: Date
  let soFar = false
  if (input.window) {
    from = input.window.from
    to = input.window.to
    if (to.getTime() > now.getTime()) {
      to = now
      soFar = true
    }
  } else if (dated.length) {
    from = new Date(dated[0].t)
    to = new Date(dated[dated.length - 1].t)
  } else {
    from = now
    to = now
  }
  const inWindow = wholeLog
    ? dated
    : dated.filter(x => x.t >= from.getTime() && x.t <= to.getTime())
  const entries = inWindow.map(x => x.e)

  const flagged = flaggedStatuses(statuses)
  const isAttention = (e: RadioLogEntryType) => flagged.has(e.status)

  // 3. Totals.
  const stationLabel = (e: RadioLogEntryType) => formatStation(e.tacticalCall, e.callsign) || NO_STATION_LABEL
  const lateMs = LATE_ENTRY_MINUTES * 60_000
  let revised = 0
  let late = 0
  for (const e of entries) {
    if (e.revisedAt) revised++
    const logged = ms(e.loggedAt)
    if (Number.isFinite(logged) && logged - ms(e.date) > lateMs) late++
  }

  // 4. Buckets.
  // For the whole log the last entry is the window's end, so it needs a bar of its own even when it
  // lands exactly on an hour boundary; a chosen period keeps its end as given (an op period ending
  // at 20:00 does not grow an empty 20:00 bar).
  const bucketEnd = wholeLog && inWindow.length ? new Date(to.getTime() + 1) : to
  const { hours, starts } = chooseBuckets(from, bucketEnd)
  const items: SummaryBucket[] = starts.map(start => ({ start, count: 0, attentionCount: 0 }))
  for (const { e, t } of inWindow) {
    let i = Math.min(items.length - 1, Math.max(0, Math.floor((t - starts[0].getTime()) / (hours * 3_600_000))))
    // Daylight-saving days make the arithmetic guess off by one; settle it against the real starts.
    while (i < items.length - 1 && t >= starts[i + 1].getTime()) i++
    while (i > 0 && t < starts[i].getTime()) i--
    items[i].count++
    if (isAttention(e)) items[i].attentionCount++
  }

  // 5. By status: the mission's order first, then any found only on entries.
  const statusCounts = new Map<string, number>()
  for (const e of entries) statusCounts.set(e.status, (statusCounts.get(e.status) ?? 0) + 1)
  const byStatus: SummaryStatusRow[] = []
  for (const s of statuses) {
    const count = statusCounts.get(s.status)
    if (count && !byStatus.some(r => r.status === s.status)) {
      byStatus.push({ status: s.status, color: s.color, count, inSettings: true })
    }
  }
  for (const [status, count] of statusCounts) {
    if (!byStatus.some(r => r.status === status)) {
      byStatus.push({ status, color: UNKNOWN_STATUS_COLOR, count, inSettings: false })
    }
  }

  // 6. By team: the roster member by surrogate uid (D-42), else by exact call sign.
  const byUid = new Map<string, RangerType>()
  const byCall = new Map<string, RangerType>()
  for (const r of rangers) {
    if (r.uid) byUid.set(r.uid, r)
    if (r.callsign && !byCall.has(r.callsign)) byCall.set(r.callsign, r)
  }
  const teamOf = (e: RadioLogEntryType): string => {
    const r = (e.rangerUid ? byUid.get(e.rangerUid) : undefined) ?? (e.callsign ? byCall.get(e.callsign) : undefined)
    return r?.team?.trim() || NO_TEAM_LABEL
  }

  const teamStatus = new Map<string, Map<string, number>>()
  for (const e of entries) {
    const team = teamOf(e)
    const m = teamStatus.get(team) ?? new Map<string, number>()
    m.set(e.status, (m.get(e.status) ?? 0) + 1)
    teamStatus.set(team, m)
  }
  const byTeamStatus: MissionSummary['byTeamStatus'] = {}
  for (const [team, m] of teamStatus) {
    byTeamStatus[team] = byStatus.filter(r => m.has(r.status)).map(r => ({ status: r.status, count: m.get(r.status)! }))
  }

  // 7. By station.
  const stationMap = new Map<string, SummaryStationRow>()
  for (const { e, t } of inWindow) {
    const station = stationLabel(e)
    const row = stationMap.get(station)
    if (row) {
      row.count++
      if (t > row.lastHeard.getTime()) row.lastHeard = new Date(t)
    } else {
      stationMap.set(station, { station, count: 1, lastHeard: new Date(t) })
    }
  }
  const byStation = [...stationMap.values()]
    .sort((a, b) => b.count - a.count || a.station.localeCompare(b.station))

  // 8. Needs attention, newest first.
  const attention = inWindow.filter(x => isAttention(x.e))
    .sort((a, b) => b.t - a.t || b.e.id - a.e.id)
    .map(x => x.e)

  // 9. AAR notes: incident notes in the window, grouped by area (case-insensitive, first spelling wins).
  const noteFrom = from.getTime()
  const noteTo = to.getTime()
  const inNoteWindow = (n: AarNoteType) => {
    if (wholeLog) return true
    const t = ms(n.createdAt)
    return Number.isFinite(t) && t >= noteFrom && t <= noteTo
  }
  // E-04 / D-63: ICS-214 activity lines are not debrief notes and never count here.
  const windowNotes = notes.filter(n => n.kind !== 'activity').filter(inNoteWindow)
  const incident = windowNotes.filter(n => n.about !== 'app')
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt))
  const groupMap = new Map<string, SummaryNoteGroup>()
  for (const n of incident) {
    const area = n.area?.trim() ?? ''
    const key = area.toLowerCase()
    const g = groupMap.get(key)
    if (g) g.notes.push(n)
    else groupMap.set(key, { area: area || NO_AREA_LABEL, notes: [n] })
  }

  return {
    generatedAt: now,
    window: { from, to, soFar, wholeLog },
    totals: {
      entries: entries.length,
      stations: stationMap.size,
      first: inWindow.length ? new Date(inWindow[0].t) : null,
      last: inWindow.length ? new Date(inWindow[inWindow.length - 1].t) : null,
      revised,
      late,
      attention: attention.length,
    },
    buckets: { hours, items },
    byStatus,
    byTeam: tally(entries.map(teamOf)),
    byTeamStatus,
    byStation,
    byOperator: tally(entries.map(e => e.operator?.trim() || NOT_RECORDED_LABEL)),
    bySource: tally(entries.map(e => e.source?.trim() || NOT_RECORDED_LABEL)),
    attention,
    aar: {
      groups: [...groupMap.values()],
      incidentCount: incident.length,
      appCount: windowNotes.length - incident.length,
    },
  }
}
