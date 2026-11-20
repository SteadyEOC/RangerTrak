/**
 * P1: the one place a radio log entry's station / team / operator block and the quick layouts' whole entry are
 * assembled. The full Entry form (mergedFormValue() in EntryComponent) and the simpler layouts
 * (EntryQuickSaveService) both build through here, so they cannot disagree about which keys are present.
 *
 * Framework-free (D-57): the one value that lives outside domain/ (`undefinedLocation`) is passed in.
 */
import type { LocationType } from './model/location.interface'
import type { RangerType } from './model/ranger.interface'
import { bandField } from './band'
import { teamAtSave } from './entry-team'
import { resolveStationText } from './ranger-match'

export type TacticalCallLike = { name: string; rangerUid?: string }

export type StationContext = {
  tacticalCalls: ReadonlyArray<TacticalCallLike>
  rangers: readonly RangerType[]
}

/** The station fields recorded on an entry. Optional keys are absent (not blank) when empty. */
export type StationFields = {
  rangerUid: string
  callsign: string
  tacticalCall?: string
  team?: string
  toTactical?: string
  toCallsign?: string
  toRangerUid?: string
}

/** From / To text resolved to the fields recorded on an entry (E-165, E-337). */
export function stationFields(fromText: string, toText: string, ctx: StationContext): StationFields {
  const from = resolveStationText(fromText, ctx.tacticalCalls, ctx.rangers)
  const to = resolveStationText(toText, ctx.tacticalCalls, ctx.rangers)
  const team = teamAtSave(from.rangerUid, ctx.rangers)
  return {
    rangerUid: from.rangerUid,
    callsign: from.callsign,
    ...(from.tactical ? { tacticalCall: from.tactical } : {}),
    ...(team ? { team } : {}),
    ...(to.tactical ? { toTactical: to.tactical } : {}),
    ...(to.callsign ? { toCallsign: to.callsign } : {}),
    ...(to.rangerUid ? { toRangerUid: to.rangerUid } : {}),
  }
}

/** The slice of a mission the builders read. */
export type MissionDefaults = {
  tacticalCalls?: ReadonlyArray<TacticalCallLike>
  radioLogStatuses?: ReadonlyArray<{ status: string }>
  defRadioLogStatus?: number
  defLat?: number
  defLng?: number
}

/** The mission's default radio log status text; blank when the index is out of range or there is no mission. */
export function defaultStatus(mission: MissionDefaults | null | undefined): string {
  const statuses = mission?.radioLogStatuses ?? []
  return statuses[mission?.defRadioLogStatus ?? 0]?.status ?? ''
}

/** The mission's default position (defLat/defLng) over a fallback location; each missing value keeps the fallback's. */
export function missionDefaultLocation(mission: MissionDefaults | null | undefined, fallback: LocationType): LocationType {
  return { ...fallback, lat: mission?.defLat ?? fallback.lat, lng: mission?.defLng ?? fallback.lng }
}

export type QuickEntryInput = {
  from: string
  to: string
  message: string
  date?: Date
  location?: LocationType
  status?: string
  /** E-327: the band picked on the layout; blank or absent leaves the entry without one. */
  band?: string
}

export type QuickEntryContext = {
  rangers: readonly RangerType[]
  mission: MissionDefaults | null | undefined
  operator: string
  /** What an entry with no location carries (the app's `undefinedLocation`). */
  noLocation: LocationType
  /** Clock override for tests. */
  now?: () => Date
}

/** The entry the quick layouts save; RadioLogService stamps id, uid, loggedAt and message number. */
export function buildRadioLogEntry(input: QuickEntryInput, ctx: QuickEntryContext) {
  return {
    id: -1,
    location: input.location ?? ctx.noLocation,
    date: input.date ?? (ctx.now ? ctx.now() : new Date()),
    notes: input.message,
    source: 'Voice' as const,
    ...bandField(input.band),
    generates213: false, replyRequested213: false, message213: '', recipients213: [] as string[], subject213: '',
    ...stationFields(input.from, input.to, { tacticalCalls: ctx.mission?.tacticalCalls ?? [], rangers: ctx.rangers }),
    status: input.status ?? defaultStatus(ctx.mission),
    operator: ctx.operator.trim(),
    evidenceLocation: null,
    evidenceDirection: null,
  }
}
