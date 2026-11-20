/**
 * E-332: which Entry screen a mission uses. Every layout saves the same entry through the same code; only the
 * screen differs. Framework-free (D-57). To add a layout, add its id to EntryLayout and a row to ENTRY_LAYOUTS.
 */
export type EntryLayout = 'basic' | 'net' | 'field' | 'full'

export type EntryLayoutInfo = { id: EntryLayout; label: string; description: string }

/** In the order shown on the Mission page. */
export const ENTRY_LAYOUTS: readonly EntryLayoutInfo[] = [
  { id: 'basic', label: 'Basic log (ICS-309)', description: 'Time, From, To, Message. Like FLMSG\'s 309 log.' },
  { id: 'net', label: 'Net or radio room', description: 'One line per call, check-ins by default, log underneath.' },
  { id: 'field', label: 'Field team', description: 'Today\'s report form, fitted to a laptop screen.' },
  { id: 'full', label: 'Command post / EOC', description: 'Everything: location, map, ICS-213, resource request, attachments.' },
]

/** A mission without the field reads as `full`, so existing missions do not change. */
export function entryLayoutOf(mission: { entryLayout?: EntryLayout } | null | undefined): EntryLayout {
  const id = mission?.entryLayout
  return ENTRY_LAYOUTS.some(l => l.id === id) ? id as EntryLayout : 'full'
}

export type NetDirection = 'in' | 'out'

/**
 * Who sent and who received. In: the caller is From and our station is To. Out: the other way round.
 * `ourStation` is the "Sending as" call, our side of the exchange.
 */
export function netEntryParties(call: string, direction: NetDirection, ourStation: string): { from: string; to: string } {
  const c = (call ?? '').trim()
  const us = (ourStation ?? '').trim()
  return direction === 'out' ? { from: us, to: c } : { from: c, to: us }
}

/** The live "From X → To Y" line shown under the net entry line. Blanks show as a dash. */
export function netPartiesLine(parties: { from: string; to: string }): string {
  return `From ${parties.from || '-'} → To ${parties.to || '-'}`
}

/** A blank message on the net line is a check-in. */
export function netMessage(text: string): string {
  const t = (text ?? '').trim()
  return t || 'Check-in'
}

/**
 * The choices for "Sending as": the mission's station call, the operator's own call, the tactical calls,
 * without blanks or repeats (compared upper-cased). The first is the default.
 */
export function sendingAsOptions(stationCall: string, operatorCall: string, tacticalNames: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [stationCall, operatorCall, ...tacticalNames]) {
    const v = (raw ?? '').trim()
    const k = v.toUpperCase()
    if (!v || seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

/**
 * The mission's own station call: its Winlink call (E-307, the call this station signs with), else the first EOC /
 * fixed-station call sign, else blank. "Sending as" can always be typed over.
 */
export function missionStationCall(
  mission: { winlinkCall?: string, eocCalls?: readonly string[] } | null | undefined,
): string {
  const own = mission?.winlinkCall?.trim()
  if (own) return own.toUpperCase()
  return mission?.eocCalls?.find(c => !!c?.trim())?.trim() ?? ''
}

/** Time typed into the basic log's Time box: HH:mm, or HHmm, on the given day; blank or unreadable is `now`. */
export function basicEntryTime(text: string, now: Date): Date {
  const m = /^\s*(\d{1,2})\s*:?\s*(\d{2})\s*$/.exec(text ?? '')
  if (!m) return new Date(now)
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return new Date(now)
  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  return d
}

/** The From and To shown for a saved entry: the tactical call when there is one, else the call sign. */
export function entryFromTo(e: { tacticalCall?: string; callsign?: string; toTactical?: string; toCallsign?: string }): { from: string; to: string } {
  return {
    from: e.tacticalCall?.trim() || e.callsign?.trim() || '',
    to: e.toTactical?.trim() || e.toCallsign?.trim() || '',
  }
}
