import { layerFor, MISSION_ZIP_SCHEMA_VERSION, buildMissionZipBytes, type MissionZipManifest } from './mission-zip'
import type { MissionType } from '../../domain/model/mission.interface'
import type { MissionLocationType } from '../../domain/model/mission-location.interface'
import type { RangerType } from '../../domain/model/ranger.interface'

/**
 * The manifest of a Setup file, built from whichever parts the caller passes. Shared by Mission's Setup file
 * card (any mix of settings, rangers and places) and the RangerView copy (E-287: never rangers, never photos).
 * Pure: the caller supplies the time and the app version, so the same input always gives the same manifest.
 */
export type SetupFileParts = {
  settings?: MissionType
  rangers?: RangerType[]
  locations?: MissionLocationType[]
  /** An optional name for the file; blank = no layer block. */
  layerName?: string
  suggestedView?: '' | 'simple' | 'full'
  appVersion: string
  exportedAt: string
}

export function buildSetupManifest(parts: SetupFileParts): MissionZipManifest {
  const contents = {
    // D-61 item 8: the RangerView password travels only in an encrypted backup, never in a Setup file.
    ...(parts.settings ? { settings: { ...parts.settings, boardPassword: '' } } : {}),
    ...(parts.rangers ? { rangers: parts.rangers } : {}),
    ...(parts.locations ? { locations: parts.locations } : {}),
  }
  const layer = (parts.layerName ?? '').trim()
  return {
    schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
    exportedAt: parts.exportedAt,
    appVersion: parts.appVersion,
    ...contents,
    ...(parts.suggestedView ? { suggestedView: parts.suggestedView } : {}),
    ...(layer ? { layer: layerFor(contents, layer, parts.exportedAt.slice(0, 10)) } : {}),
  }
}

/**
 * E-287 (John, Q115, 11-18): the settings a phone gets from RangerView. RangerView is read from an open Wi-Fi, so
 * nothing private or machine-specific goes: no agency geocoding key, no RangerView password, and publishing is
 * switched off (a phone that loaded the file must not start publishing to, or claim, this RangerView).
 */
export function rangerViewSetupSettings(settings: MissionType): MissionType {
  return {
    ...settings,
    googleGeocodingApiKey: '',
    boardPassword: '',
    commandPostEnabled: false,
    commandPostServerUrl: '',
    boardOfferSetup: false,
  }
}

export type RangerViewSetupFile = { bytes: Uint8Array, sha256: string, name: string }

/**
 * The Setup file the scribe offers to phones through RangerView: mission settings (op period included) and
 * places. NEVER the roster and never photos (CLAUDE.md rule 5): this function has no way to include them.
 * Loads on a phone through the same Setup file import as any other file.
 */
export async function buildRangerViewSetupFile(input: {
  settings: MissionType, locations: MissionLocationType[], appVersion: string, exportedAt: string,
}): Promise<RangerViewSetupFile> {
  const manifest = buildSetupManifest({
    settings: rangerViewSetupSettings(input.settings),
    locations: input.locations,
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
  })
  const bytes = await buildMissionZipBytes(manifest, [])
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const sha256 = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const label = (input.settings.mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
  return { bytes, sha256, name: `${label}-setup.zip` }
}

/**
 * The settings a Setup file import saves. The file's settings replace this device's, except that a value the file
 * leaves blank never erases this device's own (Q118, John 11-18):
 * - the RangerView viewer password (a Setup file never carries one, D-61);
 * - the Google address-lookup key (the RangerView copy strips it, E-287, and a shared file may too).
 * Pure: returns a new object.
 */
export function settingsForImport(incoming: MissionType, current: MissionType | undefined): MissionType {
  const out = { ...incoming }
  if (!out.boardPassword?.trim() && current?.boardPassword) out.boardPassword = current.boardPassword
  if (!out.googleGeocodingApiKey?.trim() && current?.googleGeocodingApiKey) out.googleGeocodingApiKey = current.googleGeocodingApiKey
  return out
}
