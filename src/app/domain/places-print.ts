import { formatLatLng, type CoordinateFormat } from './coordinate'
import type { MissionLocationType } from './model/mission-location.interface'

/**
 * The Print card's places list on the Map page (E-187 Layers phase D, ADR D-58): the places
 * grouped by category, in the mission's own category order, like an ICS-205A-style list.
 * Pure (ADR D-57); the page only draws what this returns.
 */
export type PlacesPrintRow = {
  name: string
  address: string
  /** In the format asked for (DD, DDM or USNG), the same text the map's readout shows. */
  coordinates: string
  note: string
}

export type PlacesPrintGroup = {
  /** The category as the mission spells it, or '' for places with none. */
  category: string
  /** What the sheet's heading says. */
  label: string
  rows: PlacesPrintRow[]
}

export const NO_CATEGORY_LABEL = '(no category)'

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * Groups the places by category. `categoryOrder` is the mission's category list: those come
 * first, in that order, and a category with no places in it is left out. A category a place
 * uses that the list lacks follows, in the order first met; places with none come last.
 * Within a category the places are A to Z by name. Categories match ignoring case and spacing.
 */
export function buildPlacesPrint(
  places: readonly MissionLocationType[],
  categoryOrder: readonly string[],
  format: CoordinateFormat,
): PlacesPrintGroup[] {
  const key = (s: string | undefined) => (s ?? '').trim().toLowerCase()
  const groups = new Map<string, PlacesPrintGroup>()
  for (const c of categoryOrder) {
    if (key(c) && !groups.has(key(c))) {
      groups.set(key(c), { category: c.trim(), label: c.trim(), rows: [] })
    }
  }
  const unlisted: string[] = []
  for (const p of places) {
    const k = key(p.type)
    let group = groups.get(k)
    if (!group) {
      group = { category: (p.type ?? '').trim(), label: (p.type ?? '').trim() || NO_CATEGORY_LABEL, rows: [] }
      groups.set(k, group)
      unlisted.push(k)
    }
    group.rows.push({
      name: (p.name ?? '').trim(),
      address: (p.address ?? '').trim(),
      coordinates: formatLatLng(p.lat, p.lng, format),
      note: (p.note ?? '').trim(),
    })
  }
  // "No category" always last, whatever order it was met in.
  const ordered = [
    ...categoryOrder.map(key).filter((k, i, all) => k && all.indexOf(k) === i),
    ...unlisted.filter(k => k),
    ...unlisted.filter(k => !k),
  ]
  return ordered
    .map(k => groups.get(k)!)
    .filter(g => g.rows.length > 0)
    .map(g => ({ ...g, rows: [...g.rows].sort((a, b) => collator.compare(a.name, b.name)) }))
}
