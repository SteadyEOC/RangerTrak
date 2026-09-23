import { BoundsType } from '../services/radio-log-entry.interface'

/**
 * "Zoom to Extent" (maintainer ask, 2026-09-22): unlike the init-time fit in
 * `recalcRadioLogBounds()` (radio-log.service.ts), which always covers the WHOLE log, this is
 * a re-runnable fit over whatever is actually drawn right now - the displayed field reports
 * (honoring the All/selected switch), their evidence markers, and mission Location pins. Both
 * map engines call this with their own current point set; see `onBtnZoomToExtent()` in
 * mapLeaflet.component.ts and mapLibre.component.ts.
 *
 * Pure - no Angular, no DI, no logging - same "pure module" split ics213-pdf.ts and
 * ranger-migration.ts already follow.
 */
export type ExtentPoint = { lat: number, lng: number }

/**
 * Returns a BoundsType covering every finite point, or undefined if there are none (an empty
 * mission, or a set that filtered down to nothing - the caller should leave the camera alone
 * rather than snap to a default).
 */
export function computeExtent(points: readonly ExtentPoint[], marginDeg = 0.0025): BoundsType | undefined {
  let north: number | undefined
  let south: number | undefined
  let east: number | undefined
  let west: number | undefined

  for (const p of points) {
    // radio-log.service.ts's recalcRadioLogBounds() documents a NaN coordinate poisoning
    // every later bounds comparison against it - same trap here, so skip anything not finite
    // rather than let one bad point wreck the whole fit.
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue

    if (north === undefined) {
      north = south = p.lat
      east = west = p.lng
    } else {
      if (p.lat > north!) north = p.lat
      if (p.lat < south!) south = p.lat
      if (p.lng > east!) east = p.lng
      if (p.lng < west!) west = p.lng
    }
  }

  if (north === undefined) return undefined

  // Same degenerate-case broadening recalcRadioLogBounds() uses: a single-report mission (or
  // several reports stacked at one point) must not fit to a zero-area box.
  if (east! - west! < 2 * marginDeg) {
    east! += marginDeg
    west! -= marginDeg
  }
  if (north! - south! < 2 * marginDeg) {
    north! += marginDeg
    south! -= marginDeg
  }

  return { north: north!, south: south!, east: east!, west: west! }
}
