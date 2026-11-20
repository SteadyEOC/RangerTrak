/**
 * E-328: the call sign list inside a Setup file. Pure functions; the zip packing lives in shared/export/mission-zip.ts
 * and the IndexedDB swap in CallsignDirectoryService.replaceAll().
 *
 * The list is public licence data (call sign, name, town, province/state) and rides as its own zip entry,
 * `callsigns.json`, NOT inside mission-zip.json. It is opt-in when a Setup file is made. It is never in a backup,
 * Report Packet or hand-over (E-325), and RangerView still refuses nothing about it except rangers and photos.
 */
import type { DirectoryMeta, DirectoryRow, DirectorySource } from './callsign-directory'

export const CALLSIGN_ENTRY = 'callsigns.json'
export const CALLSIGN_FILE_VERSION = 1

export type CallsignListFile = {
  version: number
  source: DirectorySource
  importedAt: string
  fileName: string
  fileDate?: string
  region: string
  count: number
  rows: DirectoryRow[]
}

/** Only the four public fields of each row, whatever else the caller's objects carry. */
export function buildCallsignFile(meta: DirectoryMeta, rows: readonly DirectoryRow[]): CallsignListFile {
  const clean = rows.map(r => ({ call: r.call, name: r.name, city: r.city, region: r.region }))
  return {
    version: CALLSIGN_FILE_VERSION,
    source: meta.source, importedAt: meta.importedAt, fileName: meta.fileName,
    ...(meta.fileDate ? { fileDate: meta.fileDate } : {}),
    region: meta.region, count: clean.length, rows: clean,
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Reads a parsed `callsigns.json`. Null when it is not a usable list (the rest of the Setup file still applies). */
export function parseCallsignFile(raw: unknown): { meta: DirectoryMeta; rows: DirectoryRow[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o['rows']) || (o['source'] !== 'ised' && o['source'] !== 'fcc')) return null
  const rows: DirectoryRow[] = []
  for (const r of o['rows'] as unknown[]) {
    if (!r || typeof r !== 'object') continue
    const x = r as Record<string, unknown>
    const call = str(x['call']).trim().toUpperCase()
    if (!call) continue
    rows.push({ call, name: str(x['name']), city: str(x['city']), region: str(x['region']) })
  }
  if (!rows.length) return null
  const meta: DirectoryMeta = {
    source: o['source'], importedAt: str(o['importedAt']), fileName: str(o['fileName']),
    ...(str(o['fileDate']) ? { fileDate: str(o['fileDate']) } : {}),
    region: str(o['region']), count: rows.length,
  }
  return { meta, rows }
}

const SOURCE_NAME: Record<DirectorySource, string> = { ised: 'ISED', fcc: 'FCC' }

/** "ISED amateur_delim.txt, imported 2026-11-18": what the list on this device came from. */
export function describeCallsignSource(meta: Pick<DirectoryMeta, 'source' | 'fileName' | 'importedAt'>): string {
  const when = meta.importedAt ? meta.importedAt.slice(0, 10) : ''
  return `${SOURCE_NAME[meta.source]}${meta.fileName ? ` ${meta.fileName}` : ''}${when ? `, imported ${when}` : ''}`
}

/** The checkbox label on the Setup file card. */
export function callsignCheckboxLabel(meta: DirectoryMeta): string {
  const n = meta.count.toLocaleString('en-US')
  return `Include the call sign list (${n} call sign${meta.count === 1 ? '' : 's'}, from ${meta.fileName || SOURCE_NAME[meta.source]}${meta.importedAt ? `, ${meta.importedAt.slice(0, 10)}` : ''})`
}

/** The preview line and the import summary. */
export function describeCallsignReplace(meta: Pick<DirectoryMeta, 'source' | 'fileName' | 'count'>): string {
  return `Call sign list replaced: ${meta.count.toLocaleString('en-US')} call sign${meta.count === 1 ? '' : 's'} from ${meta.fileName || SOURCE_NAME[meta.source]}`
}
