import type { MissionModeType } from '../shared/services/mission.interface'

/**
 * E-168 (2026-10-01, John): "is this device being used for something real?" decided in ONE
 * place. Pure rules - no Angular, Leaflet, DOM or storage imports (src/app/domain/ is for
 * exactly that) - so the table-driven spec can run every case without a browser. The service
 * (shared/services/usage-state.service.ts) only gathers the inputs.
 *
 * States, from least to most "stay out of the way":
 *   empty  - nothing on the device
 *   demo   - only demo data
 *   setup  - a real mission is being prepared, nothing logged for real yet
 *   live   - real use now or imminently: be quiet
 * `live` beats everything: the safe mistake is being quiet.
 */
export type UsageState = 'empty' | 'demo' | 'setup' | 'live'

/**
 * John, 2026-10-01: 12 hours as written in the scoping. A real entry in the last 12 h, or an
 * operating period running or starting within 12 h, means someone is (about to be) working.
 * 12 h is also the default op-period length, so "starts within 12 h" means "this shift or the
 * next one".
 */
export const LIVE_WINDOW_HOURS = 12
const LIVE_WINDOW_MS = LIVE_WINDOW_HOURS * 60 * 60 * 1000

/** What the demo loader recorded when it loaded a demo (see shared/mapping/demo-map.ts). */
export type DemoInputs = {
  /** ms since 1970 the demo was loaded, or NaN when unknown (old plain-string marker). */
  loadedAt: number,
  rangerUids: readonly string[],
  reportIds: readonly string[],
}

export type UsageInputs = {
  /** The operator's choice (MissionType.missionMode); undefined = not chosen. */
  explicitMode?: MissionModeType,
  /** Roster rows, by RangerType.uid. */
  rangerUids: readonly string[],
  /** Radio log entries: `id` as a string, `date` as ms since 1970. */
  reports: readonly { id: string, date: number }[],
  missionName: string,
  opPeriodStart: number,
  opPeriodEnd: number,
  /** null when no demo is loaded. */
  demo: DemoInputs | null,
  /** Field-phone mode: a ranger's own phone is by definition live. */
  fieldMode: boolean,
}

/** A report counts as real unless the demo loader made it. A demo report's id is in the
 *  record; but if the log was cleared and restarted, new ids repeat the old ones, so anything
 *  dated after the demo was loaded is real too (demo reports are all dated in the past). */
function isRealReport(r: { id: string, date: number }, demo: DemoInputs | null): boolean {
  if (!demo) return true
  // Old marker with no lists: nothing can be told apart, so all of it is treated as demo.
  if (demo.reportIds.length === 0) return false
  if (!demo.reportIds.includes(r.id)) return true
  return !Number.isNaN(demo.loadedAt) && r.date > demo.loadedAt
}

function isRealRanger(uid: string, demo: DemoInputs | null): boolean {
  if (!demo) return true
  // Same as reports: an old marker has no list to compare with.
  if (demo.rangerUids.length === 0) return false
  return !demo.rangerUids.includes(uid)
}

export function deriveUsageState(i: UsageInputs, now: number): UsageState {
  const realRangers = i.rangerUids.filter(u => isRealRanger(u, i.demo)).length
  const realReports = i.reports.filter(r => isRealReport(r, i.demo))
  // The mission name is only evidence of real work when no demo is loaded: the demo names the
  // mission itself.
  const realName = !i.demo && i.missionName.trim() !== ''
  const hasRealData = realName || realRangers > 0 || realReports.length > 0

  const recentRealReport = realReports.some(r => r.date >= now - LIVE_WINDOW_MS && r.date <= now + LIVE_WINDOW_MS)
  // A fresh install seeds an op period that is "running now", so the op period only counts
  // once something real exists beside it.
  const opPeriodNear = hasRealData && i.opPeriodEnd >= now && i.opPeriodStart <= now + LIVE_WINDOW_MS

  if (i.fieldMode || recentRealReport || opPeriodNear) return 'live'
  // The operator said so: an exercise or a real incident is quiet whenever there is anything
  // on the device, whatever the clock says.
  if ((i.explicitMode === 'exercise' || i.explicitMode === 'incident')
    && (hasRealData || i.demo !== null || i.rangerUids.length > 0 || i.reports.length > 0)) return 'live'
  if (i.explicitMode === 'demo') return 'demo'
  if (hasRealData) return 'setup'
  if (i.demo) return 'demo'
  return 'empty'
}

/** The mode in effect: the operator's choice, else 'demo' when a demo is loaded, else
 *  'incident'. 2026-10-05, John: one mode is always active - "not chosen" left the pill with no
 *  icon and the buttons with nothing pressed. Incident is the safe default: quiet, and no
 *  EXERCISE stamp on anything printed. Derived only - nothing new is stored. */
export function effectiveMode(i: Pick<UsageInputs, 'explicitMode' | 'demo'>): MissionModeType {
  return i.explicitMode ?? (i.demo ? 'demo' : 'incident')
}
