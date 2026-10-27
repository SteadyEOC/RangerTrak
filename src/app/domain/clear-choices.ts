import type { AarNoteType } from '../shared/services/aar-note.interface'

/**
 * E-221: what a "this replaces the mission" or "clear the radio log" action may clear. The
 * dialog (shared/clear-dialog) shows these rows; the services take the set of ids that were
 * chosen. Pure rules here, so the defaults and the counts are testable without a dialog.
 */
export type ClearId =
  | 'roster' | 'photos' | 'log' | 'places' | 'settings'
  | 'incidentNotes' | 'lines' | 'header'
  | 'appNotes'

/** `replace`: a demo load / Start a real mission / leaving Demo. `log`: Clear radio log. */
export type ClearContext = 'replace' | 'log'

export interface ClearRow {
  id: ClearId
  label: string
  /** How many there are, or null for a row with no count (settings, the 214 header). */
  count: number | null
  /** Cannot be kept: the action always clears it. Shown ticked and disabled. */
  locked: boolean
  checked: boolean
}

/** The live counts a caller passes in. */
export interface ClearCounts {
  rangers: number
  photos: number
  entries: number
  places: number
  /** `kind === 'aar'` and `about === 'incident'`. */
  incidentNotes: number
  /** ICS-214 activity lines (`kind === 'activity'`). */
  lines: number
  /** `kind === 'aar'` and `about === 'app'`. */
  appNotes: number
}

const NOUNS: Partial<Record<ClearId, [string, string]>> = {
  roster: ['ranger', 'rangers'],
  photos: ['photo', 'photos'],
  log: ['entry', 'entries'],
  places: ['place', 'places'],
  incidentNotes: ['note', 'notes'],
  lines: ['line', 'lines'],
  appNotes: ['note', 'notes'],
}

/** "42 rangers", "1 note"; '' for a row with no count. */
export function countText(id: ClearId, count: number | null): string {
  if (count === null) return ''
  const noun = NOUNS[id]
  return noun ? `${count} ${count === 1 ? noun[0] : noun[1]}` : String(count)
}

/**
 * The rows for one context, in display order. Rows with a count of 0 are left out; rows with no
 * count (settings, the 214 header) always show. For `replace` the roster, photos, log, places and
 * settings are locked; for `log` only the radio log is, and nothing else is ticked (John 2026-10-23:
 * be conservative, offer the choice).
 */
export function buildClearRows(context: ClearContext, c: ClearCounts): ClearRow[] {
  const replace = context === 'replace'
  const rows: ClearRow[] = replace
    ? [
      { id: 'roster', label: 'Roster', count: c.rangers, locked: true, checked: true },
      { id: 'photos', label: 'Ranger photos', count: c.photos, locked: true, checked: true },
      { id: 'log', label: 'Radio log entries (+ attachments)', count: c.entries, locked: true, checked: true },
      { id: 'places', label: 'Places', count: c.places, locked: true, checked: true },
      { id: 'settings', label: 'Mission settings & tactical calls', count: null, locked: true, checked: true },
    ]
    : [
      { id: 'log', label: 'Radio log entries (+ attachments)', count: c.entries, locked: true, checked: true },
    ]
  rows.push(
    { id: 'incidentNotes', label: 'After Action notes: this incident', count: c.incidentNotes, locked: false, checked: replace },
    { id: 'lines', label: 'ICS-214 activity lines', count: c.lines, locked: false, checked: replace },
  )
  if (replace) rows.push({ id: 'header', label: 'ICS-214 header (name, position, unit)', count: null, locked: false, checked: true })
  rows.push({ id: 'appNotes', label: 'After Action notes: about RangerTrak', count: c.appNotes, locked: false, checked: false })
  return rows.filter(r => r.count === null || r.count > 0)
}

/** The ids a caller gets when the operator accepts the dialog as shown: locked rows plus ticked ones. */
export function chosenIds(rows: readonly ClearRow[], ticked: ReadonlySet<ClearId>): Set<ClearId> {
  return new Set(rows.filter(r => r.locked || ticked.has(r.id)).map(r => r.id))
}

/** What a service clears when its caller names nothing: the dialog's defaults for a replace. */
export const DEFAULT_REPLACE_CLEAR: ReadonlySet<ClearId> = new Set<ClearId>(['incidentNotes', 'lines', 'header'])

/** True for the notes the chosen ids say to delete. Incident notes and 214 lines are told apart by kind. */
export function noteMatcher(clear: ReadonlySet<ClearId>): (n: AarNoteType) => boolean {
  return n => (n.kind === 'activity' && clear.has('lines'))
    || (n.kind !== 'activity' && n.about === 'incident' && clear.has('incidentNotes'))
    || (n.kind !== 'activity' && n.about === 'app' && clear.has('appNotes'))
}

/** The counts for the three note rows, from the stored notes. */
export function countNotes(notes: readonly AarNoteType[]): Pick<ClearCounts, 'incidentNotes' | 'lines' | 'appNotes'> {
  return {
    incidentNotes: notes.filter(n => n.kind !== 'activity' && n.about === 'incident').length,
    lines: notes.filter(n => n.kind === 'activity').length,
    appNotes: notes.filter(n => n.kind !== 'activity' && n.about === 'app').length,
  }
}

/**
 * E-223: what a clear removed, for the log: row ids and counts only, never the contents.
 * e.g. "roster 42, photos 3, log 118, places 9, settings, incidentNotes 2". `counts` are the
 * live counts taken before the clear. A replace always clears its locked rows; `clear` names
 * the rest (and, for a log clear, the log row is always included).
 */
export function clearedSummary(context: ClearContext, clear: ReadonlySet<ClearId>, counts: ClearCounts): string {
  const always: ClearId[] = context === 'replace' ? ['roster', 'photos', 'log', 'places', 'settings'] : ['log']
  const ids = [...new Set<ClearId>([...always, ...clear])]
  const countOf: Record<ClearId, number | null> = {
    roster: counts.rangers, photos: counts.photos, log: counts.entries, places: counts.places,
    settings: null, incidentNotes: counts.incidentNotes, lines: counts.lines, header: null, appNotes: counts.appNotes,
  }
  return ids.map(id => countOf[id] === null ? id : `${id} ${countOf[id]}`).join(', ')
}

/**
 * E-222: what a clear removed and what it kept, in plain words for the mission journal (counts
 * only, never contents). e.g. "Cleared: 42 rangers, 118 radio log entries, 7 incident notes.
 * Kept: 4 notes about RangerTrak." Rows with nothing to clear are left out.
 */
export function clearedPlain(context: ClearContext, clear: ReadonlySet<ClearId>, counts: ClearCounts): string {
  const always: ClearId[] = context === 'replace' ? ['roster', 'photos', 'log', 'places', 'settings'] : ['log']
  const chosen = new Set<ClearId>([...always, ...clear])
  const text = (id: ClearId): string => {
    switch (id) {
      case 'roster': return countText(id, counts.rangers)
      case 'photos': return countText(id, counts.photos)
      case 'log': return `${counts.entries} radio log ${counts.entries === 1 ? 'entry' : 'entries'}`
      case 'places': return countText(id, counts.places)
      case 'settings': return 'the mission settings'
      case 'incidentNotes': return `${counts.incidentNotes} incident ${counts.incidentNotes === 1 ? 'note' : 'notes'}`
      case 'lines': return `${counts.lines} ICS-214 ${counts.lines === 1 ? 'line' : 'lines'}`
      case 'header': return 'the ICS-214 header'
      case 'appNotes': return `${counts.appNotes} ${counts.appNotes === 1 ? 'note' : 'notes'} about RangerTrak`
    }
  }
  const empty = (id: ClearId) => (id === 'roster' && !counts.rangers) || (id === 'photos' && !counts.photos)
    || (id === 'places' && !counts.places) || (id === 'incidentNotes' && !counts.incidentNotes)
    || (id === 'lines' && !counts.lines) || (id === 'appNotes' && !counts.appNotes)
  const cleared = [...chosen].filter(id => !empty(id)).map(text)
  const keepable: ClearId[] = ['incidentNotes', 'lines', 'appNotes']
  const kept = keepable.filter(id => !chosen.has(id) && !empty(id)).map(text)
  return `Cleared: ${cleared.join(', ') || 'nothing'}.${kept.length ? ` Kept: ${kept.join(', ')}.` : ''}`
}
