import { bearingAndDistance } from './coordinate'

/**
 * E-300 (John 11-14): warn on Entry when a report's position is far from the rest of the mission, to catch a
 * typo, a wrong sign or hemisphere, or an old mission's location carried over (E-296). A warning only: the
 * scribe can always save.
 *
 * John's rule: once there are more than about 5 reports, warn when the new point would grow their spread by
 * more than about 50%. Until then, compare with the mission's default location.
 */

export interface LatLng { lat: number, lng: number }

export interface FarResult {
  /** Distance to the nearest earlier report, or to the default location, in km. */
  km: number
  against: 'reports' | 'default'
}

/** "More than about 5 reports". */
export const FAR_MIN_REPORTS = 6
/** "Grows their spread by more than about 50%". */
export const FAR_SPREAD_GROWTH = 1.5
/** Reports at one spot have no spread; treat anything tighter than this radius as this radius. */
export const FAR_MIN_SPREAD_KM = 1
/** With few reports: how far from the mission default location counts as far. A judgment call (Q102). */
export const FAR_FROM_DEFAULT_KM = 30

/** A real position: finite, in range, and not the app's "no location" (-1, -1) or a blank 0, 0. */
export function isUsablePoint(p: Partial<LatLng> | null | undefined): p is LatLng {
  if (!p || typeof p.lat !== 'number' || typeof p.lng !== 'number') return false
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false
  if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return false
  if (p.lat === -1 && p.lng === -1) return false
  if (p.lat === 0 && p.lng === 0) return false
  return true
}

function km(a: LatLng, b: LatLng): number {
  return bearingAndDistance(a.lat, a.lng, b.lat, b.lng).distanceMeters / 1000
}

/**
 * Null when the point looks fine (or can't be judged); otherwise how far off it is. `others` are the
 * mission's earlier report positions; unusable ones are skipped.
 */
export function farLocation(point: Partial<LatLng> | null | undefined, others: readonly (Partial<LatLng> | null | undefined)[],
  defaultLocation: Partial<LatLng> | null | undefined): FarResult | null {
  if (!isUsablePoint(point)) return null
  const pts = others.filter(isUsablePoint)

  if (pts.length >= FAR_MIN_REPORTS) {
    // The spread: the radius around the reports' centre that holds them all.
    const centre = {
      lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
      lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
    }
    const radius = Math.max(FAR_MIN_SPREAD_KM, ...pts.map(p => km(centre, p)))
    if (km(centre, point) <= radius * FAR_SPREAD_GROWTH) return null
    return { km: Math.min(...pts.map(p => km(point, p))), against: 'reports' }
  }

  if (!isUsablePoint(defaultLocation)) return null
  const d = km(point, defaultLocation)
  return d > FAR_FROM_DEFAULT_KM ? { km: d, against: 'default' } : null
}

/** The note Entry shows under Where. */
export function farLocationText(r: FarResult): string {
  const dist = r.km >= 100 ? `${Math.round(r.km).toLocaleString('en-US')} km` : `${r.km.toFixed(r.km < 10 ? 1 : 0)} km`
  const from = r.against === 'reports' ? 'the nearest other report' : 'the mission\'s default location'
  return `This position is about ${dist} from ${from}. Check the numbers (a digit, a minus sign, an old mission's location) before saving. You can still save it.`
}
