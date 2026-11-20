import { decryptBytes, encryptBytes } from '../crypto/encrypted-file'
import { HANDOVER_KIND, readEnvelope } from './handover-kind'
export * from './handover-kind'
import type { AttachmentFile } from './attachments-zip'
import { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'
import { MissionLocationType } from '../../domain/model/mission-location.interface'
import { RangerType } from '../../domain/model/ranger.interface'
import {
  buildMissionZipBytes, extractMissionZip, handoverFilename, layerFor, MISSION_ZIP_SCHEMA_VERSION,
  MissionZipAttachment, MissionZipManifest, MissionZipPhoto,
} from './mission-zip'

/**
 * E-188 scribe hand-over (ADR D-59): building and opening the one file. A hand-over is a Setup
 * file (manifest v3) with `layer.kind: "handover"` and an `entries` category, optionally wrapped
 * in the encrypted-file envelope (`shared/crypto/encrypted-file.ts`, the same container the
 * mission backup uses, here around the zip's bytes).
 *
 * Settings are NOT carried. The sending device's mission / event / op period travel as
 * `context`, advisory only.
 */

export type HandoverBuildInput = {
  mission: string
  event: string
  opPeriod: string
  appVersion: string
  rangers: readonly RangerType[]
  locations: readonly MissionLocationType[]
  entries: readonly RadioLogEntryType[]
  photos: readonly { stem: string, blob: Blob }[]
  /** E-194: the bytes of every live attachment this device holds (removed ones are not sent). */
  attachments?: readonly AttachmentFile[]
  /** Blank or missing writes the file unencrypted (like Mission -> Back up). */
  passphrase?: string
  now?: Date
}

export type HandoverFile = {
  /** What to write to disk: the zip, or the encrypted envelope's JSON text as bytes. */
  bytes: Uint8Array
  filename: string
  mime: string
  encrypted: boolean
  manifest: MissionZipManifest
}

export async function buildHandoverFile(input: HandoverBuildInput): Promise<HandoverFile> {
  const now = input.now ?? new Date()
  const exportedAt = now.toISOString()
  const contents = {
    rangers: [...input.rangers],
    locations: [...input.locations],
    entries: [...input.entries],
  }
  const name = `Hand-over, ${input.mission || 'mission'}, ${exportedAt.slice(0, 16).replace('T', ' ')}`
  const manifest: MissionZipManifest = {
    schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
    exportedAt,
    appVersion: input.appVersion,
    ...contents,
    context: { mission: input.mission, event: input.event, opPeriod: input.opPeriod },
    layer: layerFor(contents, name, exportedAt.slice(0, 10), 'handover'),
  }

  const zip = await buildMissionZipBytes(manifest, input.photos, input.attachments ?? [])
  const passphrase = input.passphrase ?? ''
  if (!passphrase) {
    return {
      bytes: zip, filename: handoverFilename(input.mission, exportedAt, false),
      mime: 'application/zip', encrypted: false, manifest,
    }
  }

  const envelope = await encryptBytes(zip as Uint8Array<ArrayBuffer>, passphrase, { exportedAt, appVersion: input.appVersion, kind: HANDOVER_KIND })
  return {
    bytes: new TextEncoder().encode(JSON.stringify(envelope, null, 2)),
    filename: handoverFilename(input.mission, exportedAt, true),
    mime: 'application/json', encrypted: true, manifest,
  }
}

/**
 * Opens a hand-over (or any Setup file). An encrypted file needs `passphrase`; a wrong one
 * throws DecryptionFailedError and changes nothing. A plain zip ignores it.
 */
export async function openHandoverFile(
  bytes: Uint8Array, passphrase?: string,
): Promise<{ manifest: MissionZipManifest, photos: MissionZipPhoto[], attachments: MissionZipAttachment[] }> {
  const envelope = readEnvelope(bytes)
  if (!envelope) {
    return extractMissionZip(bytes)
  }
  if (!passphrase) {
    throw new Error('This file is encrypted. Enter its passphrase to open it.')
  }
  return extractMissionZip(await decryptBytes(envelope, passphrase))
}
