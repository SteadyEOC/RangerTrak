/**
 * E-326: a net summary for the Radio Log: how many entries, from how many stations, how they came in
 * (Voice, Packet ...), and who they were (EOC, roster, other, unknown). Pure; no stored data. The text form is
 * plain US-ASCII, 72 columns at most, so it pastes into a Winlink message, FLDIGI or a radio script as it is.
 */
import { callerKind, type CallerContext } from './caller-kind'
import type { RadioLogEntrySource } from './model/radio-log-entry.interface'

/** Display order, the same as RADIO_LOG_ENTRY_SOURCES (domain may import types only; `satisfies` keeps the names honest). */
const SOURCE_ORDER = ['Voice', 'Phone', 'Packet', 'APRS', 'Email'] as const satisfies readonly RadioLogEntrySource[]

type SummaryEntry = {
  date: Date | string
  callsign?: string
  tacticalCall?: string
  rangerUid?: string
  source?: string
  msgNo?: { station?: string }
}

export type NetSummary = {
  entries: number
  /** Distinct calling stations: by roster link when there is one, else the upper-cased call or tactical name. */
  stations: number
  /** In the order of RADIO_LOG_ENTRY_SOURCES; a blank source counts as Voice. Zero counts are left out. */
  bySource: { source: string; count: number }[]
  byKind: { eoc: number; roster: number; other: number; unknown: number }
  /** Only when 2 or more station letters are on the entries. */
  byStation: { station: string; count: number }[]
  first: Date | null
  last: Date | null
}

export type NetSummaryContext = Pick<CallerContext, 'eocCalls' | 'roster' | 'tacticalCalls'> & {
  /** Roster uids, so an entry linked to a roster member counts as Roster even when the call is blank. */
  rosterUids?: ReadonlySet<string>
}

export function netSummary(entries: readonly SummaryEntry[], ctx: NetSummaryContext, stationLetter?: string): NetSummary {
  const picked = stationLetter ? entries.filter(e => e.msgNo?.station === stationLetter) : [...entries]
  const sources = new Map<string, number>()
  const byKind = { eoc: 0, roster: 0, other: 0, unknown: 0 }
  const callers = new Set<string>()
  const letters = new Map<string, number>()
  let first: number | null = null
  let last: number | null = null

  for (const e of picked) {
    const src = e.source || 'Voice'
    sources.set(src, (sources.get(src) ?? 0) + 1)

    const call = (e.callsign ?? '').trim() || (e.tacticalCall ?? '').trim()
    const kind = callerKind(call, ctx).kind
    if (kind === 'eoc') byKind.eoc++
    else if (kind === 'operator' || (e.rangerUid && ctx.rosterUids?.has(e.rangerUid))) byKind.roster++
    else if (kind === 'unknown') byKind.unknown++
    else byKind.other++

    const who = e.rangerUid ? `uid:${e.rangerUid}` : call.toUpperCase()
    if (who) callers.add(who)

    const letter = e.msgNo?.station
    if (letter) letters.set(letter, (letters.get(letter) ?? 0) + 1)

    const t = new Date(e.date).getTime()
    if (Number.isFinite(t)) {
      if (first === null || t < first) first = t
      if (last === null || t > last) last = t
    }
  }

  const known: readonly string[] = SOURCE_ORDER
  const bySource = [
    ...known.filter(s => sources.has(s)).map(s => ({ source: s, count: sources.get(s)! })),
    ...[...sources].filter(([s]) => !known.includes(s)).map(([s, count]) => ({ source: s, count })),
  ]
  return {
    entries: picked.length,
    stations: callers.size,
    bySource,
    byKind,
    byStation: letters.size >= 2 ? [...letters].sort((a, b) => a[0].localeCompare(b[0])).map(([station, count]) => ({ station, count })) : [],
    first: first === null ? null : new Date(first),
    last: last === null ? null : new Date(last),
  }
}

const COLUMNS = 72

function ascii(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?')
}

function wrap(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of line.split(' ')) {
    if (cur && (cur + ' ' + word).length > COLUMNS) { out.push(cur); cur = word }
    else cur = cur ? cur + ' ' + word : word
    while (cur.length > COLUMNS) { out.push(cur.slice(0, COLUMNS)); cur = cur.slice(COLUMNS) }
  }
  if (cur) out.push(cur)
  return out
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
}

/** The text a scribe copies. Lines joined with \n only. */
export function netSummaryText(s: NetSummary, head: { mission?: string; opPeriod?: string; station?: string }): string {
  const title = ['NET SUMMARY', head.mission?.trim(), head.opPeriod?.trim() ? `OP ${head.opPeriod.trim().replace(/^op\s*/i, '')}` : '',
    head.station ? `Station ${head.station}` : ''].filter(Boolean).join('  ')
  const span = s.first && s.last ? `${hhmm(s.first)}-${hhmm(s.last)}  ` : ''
  const count = `${s.entries} ${s.entries === 1 ? 'entry' : 'entries'} from ${s.stations} ${s.stations === 1 ? 'station' : 'stations'}`
  const lines = [title, span + count]
  if (s.bySource.length) lines.push(s.bySource.map(x => `${x.source} ${x.count}`).join('  '))
  const k = s.byKind
  const kinds = ([['EOC', k.eoc], ['Roster', k.roster], ['Other', k.other], ['Unknown', k.unknown]] as const)
    .filter(([, n]) => n > 0).map(([label, n]) => `${label} ${n}`)
  if (kinds.length) lines.push(kinds.join('  '))
  if (s.byStation.length) lines.push('By station: ' + s.byStation.map(x => `${x.station} ${x.count}`).join('  '))
  return lines.flatMap(l => wrap(ascii(l))).join('\n')
}
