/**
 * E-190 (Map half): which radio log entries the Leaflet map draws, which statuses count as
 * "needs attention" (a preset of the Statuses list), and the plain-language chips that say the map is filtered.
 *
 * Framework-free (D-57): only type-only imports from the shared interfaces.
 */
import type { RadioLogEntryType, RadioLogStatusType } from '../shared/services/radio-log-entry.interface'
import type { FilterChip } from './grid-filter-chips'

/**
 * The "Show" filters under the map (2026-11-04, John: was one All / Latest / Needs attention
 * choice). `statuses` empty means every status; `latestOnly` keeps each ranger's newest entry.
 */
export type MapShowState = {
  statuses: readonly string[]
  latestOnly: boolean
}

export const SHOW_EVERYTHING: MapShowState = { statuses: [], latestOnly: false }

/**
 * The key a ranger's marker and trail are grouped by in the map (same as drawTrails()):
 * the surrogate `rangerUid`, else the call sign. Empty when the entry has neither.
 */
function rangerKey(e: RadioLogEntryType): string {
  return e.rangerUid || e.callsign || ''
}

function time(e: RadioLogEntryType): number {
  const t = new Date(e.date).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * The entries to draw for the Show filters. Output keeps the input order.
 * - `latestOnly`: the newest entry per ranger (by the entry's own `date`, the field trails sort by).
 *   An entry with NO ranger key at all (no rangerUid and no call sign) cannot be matched to
 *   anyone, so each is kept rather than collapsing every such entry into one "latest" (the
 *   shared-empty-key trap noted in E-184 section 3.4).
 * - `statuses`: then only entries with one of these statuses. Latest is taken first, so both
 *   together read "rangers whose latest report is one of these", not an old report of that status.
 */
export function selectMapEntries(entries: readonly RadioLogEntryType[], show: MapShowState): RadioLogEntryType[] {
  let out = [...entries]
  if (show.latestOnly) {
    const newest = new Map<string, RadioLogEntryType>()
    for (const e of out) {
      const key = rangerKey(e)
      if (!key) continue
      const cur = newest.get(key)
      if (!cur || time(e) >= time(cur)) newest.set(key, e)
    }
    out = out.filter(e => {
      const key = rangerKey(e)
      return !key || newest.get(key) === e
    })
  }
  if (show.statuses.length) {
    const wanted = new Set(show.statuses)
    out = out.filter(e => wanted.has(e.status))
  }
  return out
}

/** Semantic colour keys flagged by default. */
const DEFAULT_FLAGGED_KEYS = ['urgent', 'need-rest-food', 'evidence-report']
/** Semantic colour keys NOT flagged by default. Any other (custom) colour is flagged. */
const DEFAULT_UNFLAGGED_KEYS = ['normal', 'location-report', 'incident-check-in', 'incident-check-out']

/**
 * Whether a status is flagged for the map's "Needs attention" preset (the Statuses list). An explicit
 * `flagOnMap` wins; when it is undefined the default is derived from the status colour key,
 * so old missions need no migration or backfill.
 */
export function isStatusFlagged(s: Pick<RadioLogStatusType, 'color' | 'flagOnMap'>): boolean {
  if (typeof s.flagOnMap === 'boolean') return s.flagOnMap
  if (DEFAULT_UNFLAGGED_KEYS.includes(s.color)) return false
  if (DEFAULT_FLAGGED_KEYS.includes(s.color)) return true
  return true
}

/** The names of the flagged statuses. */
export function flaggedStatuses(statuses: readonly RadioLogStatusType[]): Set<string> {
  return new Set(statuses.filter(isStatusFlagged).map(s => s.status))
}

export type MapFilterState = {
  locationsHidden: boolean
  entriesHidden: boolean
  pathsHidden: boolean
  show: MapShowState
  selectedOnly: boolean
}

/** "Need rest/food, Evidence report", or "4 statuses" once the list would be long. */
function statusesLabel(statuses: readonly string[]): string {
  return statuses.length > 3 ? `${statuses.length} statuses` : statuses.join(', ')
}

/** One chip per active map filter; [] when the map shows everything. */
export function mapFilterChips(s: MapFilterState): FilterChip[] {
  const chips: FilterChip[] = []
  if (s.locationsHidden) chips.push({ key: 'locations', label: 'Places hidden' })
  if (s.entriesHidden) chips.push({ key: 'entries', label: 'Radio log entries hidden' })
  if (s.pathsHidden) chips.push({ key: 'paths', label: 'Ranger paths hidden' })
  if (s.selectedOnly) chips.push({ key: 'selected', label: 'Showing: selected on Radio Log' })
  if (s.show.statuses.length) chips.push({ key: 'statuses', label: `Showing: ${statusesLabel(s.show.statuses)}` })
  if (s.show.latestOnly) chips.push({ key: 'latest', label: 'Showing: latest per ranger' })
  return chips
}
