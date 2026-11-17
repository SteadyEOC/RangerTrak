import { activeDemoDetailMap } from '../mapping/demo-map'
import type { StoredPmtilesFile } from './custom-pmtiles.service'

/**
 * E-293 phase B: the one map file the scribe's RangerTrak sends RangerView, so viewers see street detail
 * offline. The scribe's own custom `.pmtiles` when one is loaded, else the loaded demo's street-detail file,
 * else nothing (viewers keep the world base the RangerView folder carries).
 *
 * Fingerprinted once per file (SHA-256, as attachments are) and cached here, so a publish never re-reads it.
 */
export type AreaMap = {
  sha256: string
  bytes: number
  name: string
  /** [west, south, east, north], or null when the file does not say. */
  bbox: [number, number, number, number] | null
  blob: Blob
}

/** What the snapshot's `maps` carries (no bytes: those go up once, on `POST /api/map/<sha>`). */
export type AreaMapRef = Omit<AreaMap, 'blob'>

export function areaMapRef(a: AreaMap): AreaMapRef {
  return { sha256: a.sha256, bytes: a.bytes, name: a.name, bbox: a.bbox }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

let cached: { id: string, map: AreaMap } | null = null

/** Test only. */
export function resetAreaMapCacheForTests(): void { cached = null }

/**
 * The area map to send right now, or null. `custom` is CustomPmtilesService.active(). Never throws: a file that
 * can't be read means no area map, and viewers keep the world base.
 */
export async function currentAreaMap(custom: StoredPmtilesFile | null): Promise<AreaMap | null> {
  try {
    if (custom) {
      const id = `custom:${custom.name}:${custom.blob.size}`
      if (cached?.id === id) return cached.map
      const bbox = await bboxOf(new File([custom.blob], custom.name))
      const map = { sha256: await sha256Hex(await custom.blob.arrayBuffer()), bytes: custom.blob.size, name: custom.name, bbox, blob: custom.blob }
      cached = { id, map }
      return map
    }
    const detail = activeDemoDetailMap()
    if (!detail) return null
    const id = `demo:${detail.url}`
    if (cached?.id === id) return cached.map
    const res = (typeof caches !== 'undefined' ? await caches.match(detail.url) : undefined) ?? await fetch(detail.url)
    if (!res.ok) return null
    const blob = await res.blob()
    const name = detail.url.split('/').pop() ?? 'area.pmtiles'
    const map = { sha256: await sha256Hex(await blob.arrayBuffer()), bytes: blob.size, name, bbox: detail.bbox, blob }
    cached = { id, map }
    return map
  } catch {
    return null
  }
}

/** A PMTiles header's bounds. pmtiles is loaded only here, so it stays out of the start-up bundle. */
async function bboxOf(file: File): Promise<[number, number, number, number] | null> {
  try {
    const { PMTiles, FileSource } = await import('pmtiles')
    const h = await new PMTiles(new FileSource(file)).getHeader()
    const b: [number, number, number, number] = [h.minLon, h.minLat, h.maxLon, h.maxLat]
    return b.every(Number.isFinite) && (b[0] !== 0 || b[2] !== 0) ? b : null
  } catch {
    return null
  }
}
