import type { LocationCategoryType, MissionLocationType } from './model/mission-location.interface'
import { LocationMergeResult, mergeLocations } from './location-merge'
import { normalizeHeader, PLACE_TARGET_WORDS } from './roster-sheet'

/**
 * Places files (E-187 Layers, phase B; ADR D-58): turning a spreadsheet, a Google My Maps
 * export (KML/KMZ) or a GeoJSON file into Locations, and Locations back into a table.
 *
 * Everything here is pure (ADR D-57). Input arrives as text or `string[][]`, never a `File`;
 * reading the file (SheetJS for spreadsheets, fflate for a KMZ) lives in `shared/import/` and
 * the components. The XML parser is passed in (`DOMParser` in the browser) so this file stays
 * free of DOM globals.
 *
 * Rules shared by every format:
 * - A place needs a name and usable coordinates. A row without coordinates is SKIPPED with a
 *   row-numbered warning. There is no geocoding (D-10: no key, no service); an address on its
 *   own is kept only as a field.
 * - A place's `type` is its category name. A blank category stays blank here; the planner
 *   (planPlacesImport) decides what a NEW place with no category becomes.
 */

// ── Sheets ──────────────────────────────────────────────────────────────────────────────────

/** What one spreadsheet column is imported as. */
export type PlaceTarget = typeof PLACE_TARGET_WORDS[number]

export const PLACE_TARGETS: readonly PlaceTarget[] = PLACE_TARGET_WORDS

export type PlaceMapping = {
  /** One target per column, in the file's column order. */
  targets: PlaceTarget[]
  /** Columns the guess did not recognise at all. Empty means the whole header row was understood. */
  unrecognised: number[]
}

/** Aliases per field, already normalised (lower-case letters and digits only). */
const ALIASES: Record<Exclude<PlaceTarget, 'ignore'>, string[]> = {
  name: ['name', 'title', 'place', 'location', 'facility', 'placename', 'sitename'],
  category: ['category', 'type', 'layer', 'folder', 'kind'],
  lat: ['latitude', 'lat', 'y'],
  lng: ['longitude', 'long', 'lon', 'lng', 'x'],
  // Google My Maps' CSV export: `POINT (lng lat)`. Note the order.
  wkt: ['wkt'],
  address: ['address', 'streetaddress'],
  note: ['notes', 'note', 'description', 'comments', 'comment'],
  uid: ['uid'],
}

const FIELD_ORDER = ['name', 'category', 'lat', 'lng', 'wkt', 'address', 'note', 'uid'] as const
type PlaceField = typeof FIELD_ORDER[number]

/** Columns the app itself writes or that are known noise: understood, and not imported. */
const IGNORED_ON_THE_WAY_IN = ['change']

/**
 * Guesses what each column is. Case- and punctuation-insensitive. Where two columns want the
 * same field the first wins and the later one is ignored, except notes, where every note
 * column is kept (applyPlaceMapping joins them).
 */
export function guessPlaceMapping(headers: readonly string[]): PlaceMapping {
  const targets: PlaceTarget[] = headers.map(() => 'ignore')
  const decided: boolean[] = headers.map(() => false)
  const claimed = new Set<PlaceField>()
  const seen = new Set<string>()

  const claim = (i: number, field: PlaceField) => {
    if (field !== 'note' && claimed.has(field)) return
    claimed.add(field)
    targets[i] = field
    decided[i] = true
  }

  headers.forEach((h, i) => {
    const n = normalizeHeader(h)
    if (!n || seen.has(n) || IGNORED_ON_THE_WAY_IN.includes(n)) {
      decided[i] = true
      return
    }
    seen.add(n)
  })

  headers.forEach((h, i) => {
    if (decided[i]) return
    const n = normalizeHeader(h)
    const field = FIELD_ORDER.find(f => ALIASES[f].includes(n))
    if (field) claim(i, field)
  })

  // The same, ignoring a bracketed qualifier ("Latitude (deg)"), for fields still unclaimed.
  headers.forEach((h, i) => {
    if (decided[i]) return
    const stripped = normalizeHeader(String(h ?? '').replace(/\([^)]*\)/g, ''))
    if (!stripped) return
    const field = FIELD_ORDER.find(f => ALIASES[f].includes(stripped))
    if (field && !claimed.has(field)) claim(i, field)
  })

  return { targets, unrecognised: headers.map((_h, i) => i).filter(i => !decided[i]) }
}

export type PlacesParseResult = {
  places: MissionLocationType[]
  /** Rows / shapes that did not become a place (no coordinates, no name, not a point). */
  skipped: number
  warnings: string[]
}

/**
 * One coordinate from a cell: decimal degrees ("47.41", "-122.46", "47.41 N", "122.46W"), or
 * degrees and minutes / seconds ("47 24.6 N", `47°24'36"N`). A decimal comma ("47,41") is read
 * as a decimal point. Returns null for anything unusable or out of range.
 */
export function parseCoordinateCell(text: string, axis: 'lat' | 'lng'): number | null {
  let s = String(text ?? '').trim()
  if (!s) return null

  let hemisphere = ''
  // Capital letters only: a lower-case "s" after the seconds must not read as South.
  const lead = s.match(/^([NSEW])\s*/)
  const tail = s.match(/\s*([NSEW])$/)
  if (lead) { hemisphere = lead[1]; s = s.slice(lead[0].length) }
  else if (tail) { hemisphere = tail[1]; s = s.slice(0, s.length - tail[0].length) }

  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.')   // decimal comma

  const negative = s.startsWith('-')
  const body = s.replace(/^-/, '')
  const parts = body.match(/\d+(?:\.\d+)?/g)
  if (!parts || parts.length > 3) return null
  // Only digits, a decimal point and the usual degree / minute / second marks may sit between the
  // numbers: a second minus sign or a second decimal point means two values in one cell.
  if (/[^\d.\s°'"′″’”:]/.test(body) || /\d\.\d+\./.test(body)) return null

  const [d, m = '0', sec = '0'] = parts
  let value = Number(d) + Number(m) / 60 + Number(sec) / 3600
  if (negative || hemisphere === 'S' || hemisphere === 'W') value = -value

  if (hemisphere === 'N' || hemisphere === 'S') { if (axis !== 'lat') return null }
  if (hemisphere === 'E' || hemisphere === 'W') { if (axis !== 'lng') return null }

  const limit = axis === 'lat' ? 90 : 180
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null
}

/** `POINT (lng lat)` (Google My Maps' CSV export). Anything else, including a line or area, is null. */
export function parseWktPoint(text: string): { lat: number; lng: number } | null {
  const m = String(text ?? '').match(/^\s*POINT\s*Z?\s*\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)[\s,]+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i)
  if (!m) return null
  const lng = Number(m[1])
  const lat = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/**
 * Turns the data rows (header row first) into places using a column mapping.
 *
 * Every cell is trimmed. Entirely blank rows are dropped without comment (a template
 * pre-formats blank ones). A row with no name, or no usable coordinates, is dropped with a
 * warning that names its row number in the sheet. Latitude / longitude columns win over a WKT
 * column when both are present and usable. Several note columns are joined with "; ".
 */
export function applyPlaceMapping(rows: readonly (readonly string[])[], mapping: PlaceMapping): PlacesParseResult {
  const first = (target: PlaceTarget) => mapping.targets.indexOf(target)
  const cell = (row: readonly string[], i: number) => (i >= 0 ? String(row[i] ?? '').trim() : '')
  const noteCols = mapping.targets.map((t, i) => (t === 'note' ? i : -1)).filter(i => i >= 0)

  const warnings: string[] = []
  const places: MissionLocationType[] = []
  let skipped = 0

  rows.slice(1).forEach((row, n) => {
    const sheetRow = n + 2   // row 1 is the header
    if (row.every(c => String(c ?? '').trim() === '')) return

    const name = cell(row, first('name'))
    const latText = cell(row, first('lat'))
    const lngText = cell(row, first('lng'))
    const wktText = cell(row, first('wkt'))
    const label = name ? `Row ${sheetRow} (${name})` : `Row ${sheetRow}`

    let point: { lat: number; lng: number } | null = null
    let problem = ''
    if (latText || lngText) {
      const lat = parseCoordinateCell(latText, 'lat')
      const lng = parseCoordinateCell(lngText, 'lng')
      if (lat !== null && lng !== null) point = { lat, lng }
      else problem = `its latitude / longitude (${latText || 'blank'}, ${lngText || 'blank'}) cannot be used`
    }
    if (!point && wktText) {
      point = parseWktPoint(wktText)
      if (!point) problem = 'it is not a single point on the map'
    }
    if (!point) {
      skipped++
      warnings.push(`${label} was skipped: ${problem || 'it has no coordinates'}.`)
      return
    }
    if (!name) {
      skipped++
      warnings.push(`${label} was skipped: it has no name.`)
      return
    }

    const place: MissionLocationType = { name, type: cell(row, first('category')), lat: point.lat, lng: point.lng }
    const address = cell(row, first('address'))
    const note = noteCols.map(i => cell(row, i)).filter(Boolean).join('; ')
    const uid = cell(row, first('uid'))
    if (address) place.address = address
    if (note) place.note = note
    if (uid) place.uid = uid
    places.push(place)
  })

  return { places, skipped, warnings }
}

// ── GeoJSON ─────────────────────────────────────────────────────────────────────────────────

const NAME_KEYS = ['name', 'title', 'Name', 'Title']
const CATEGORY_KEYS = ['category', 'type', 'layer', 'folder', 'Category', 'Type', 'Layer', 'Folder']
const NOTE_KEYS = ['description', 'Description', 'note', 'notes', 'Notes']

/** One line for however many lines and areas a file held. */
const notPointsWarning = (n: number) => n === 1
  ? '1 shape that is not a single point (a line or an area) was skipped.'
  : `${n} shapes that are not single points (lines or areas) were skipped.`

const pick = (props: Record<string, unknown> | null | undefined, keys: string[]): string => {
  for (const k of keys) {
    const v = props?.[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return ''
}

/**
 * Places from a GeoJSON file (FeatureCollection or a single Feature). Only `Point` shapes
 * become places; lines and areas are skipped and counted in one warning. Throws a message meant
 * for a person when the text is not GeoJSON at all.
 */
export function parseGeoJsonPlaces(text: string): PlacesParseResult {
  let doc: any
  try {
    doc = JSON.parse(String(text ?? '').replace(/^﻿/, ''))
  } catch {
    throw new Error('This file is not GeoJSON: it could not be read as text data.')
  }

  const features: any[] =
    doc?.type === 'FeatureCollection' && Array.isArray(doc.features) ? doc.features
      : doc?.type === 'Feature' ? [doc]
        : []
  if (!features.length && !(doc?.type === 'FeatureCollection' && Array.isArray(doc.features))) {
    throw new Error('This file is not GeoJSON places: it has no features in it.')
  }

  const places: MissionLocationType[] = []
  const warnings: string[] = []
  let skipped = 0
  let notPoints = 0

  features.forEach((f, i) => {
    const geometry = f?.geometry
    if (!geometry) return
    if (geometry.type !== 'Point') {
      notPoints++
      skipped++
      return
    }
    const [lng, lat] = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
    const props = (f?.properties ?? {}) as Record<string, unknown>
    const name = pick(props, NAME_KEYS)
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      skipped++
      warnings.push(`Place ${i + 1}${name ? ` (${name})` : ''} was skipped: its coordinates cannot be used.`)
      return
    }
    if (!name) {
      skipped++
      warnings.push(`Place ${i + 1} was skipped: it has no name.`)
      return
    }
    const place: MissionLocationType = { name, type: pick(props, CATEGORY_KEYS), lat, lng }
    const note = pick(props, NOTE_KEYS)
    const address = pick(props, ['address', 'Address'])
    if (note) place.note = note
    if (address) place.address = address
    places.push(place)
  })

  if (notPoints) {
    warnings.unshift(notPointsWarning(notPoints))
  }
  return { places, skipped, warnings }
}

// ── KML ─────────────────────────────────────────────────────────────────────────────────────

/** The little of an XML element this file reads; a browser `Element` satisfies it. */
export type XmlElementLike = {
  localName: string
  textContent: string | null
  children: ArrayLike<XmlElementLike>
}
export type XmlDocumentLike = { documentElement: XmlElementLike | null }

const childrenOf = (el: XmlElementLike): XmlElementLike[] => Array.from(el.children)
const childNamed = (el: XmlElementLike, name: string) => childrenOf(el).find(c => c.localName === name)
const childText = (el: XmlElementLike, name: string) => (childNamed(el, name)?.textContent ?? '').trim()

/** A KML description is HTML; keep the words. */
export function htmlToText(html: string): string {
  return String(html ?? '')
    .replace(/<\s*br\s*\/?>|<\/(p|div|li|tr)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Places from KML text (a KMZ's `doc.kml` is the same). The category of a place is the name of
 * the nearest enclosing `Folder`, which is how Google My Maps exports its layers; a placemark
 * outside any folder has none. Non-point placemarks are skipped and counted in one warning.
 *
 * `parseXml` is the caller's XML parser (the components pass a DOMParser wrapper that throws
 * on malformed XML).
 */
export function parseKmlPlaces(xmlText: string, parseXml: (text: string) => XmlDocumentLike): PlacesParseResult {
  let root: XmlElementLike | null
  try {
    root = parseXml(String(xmlText ?? '')).documentElement
  } catch (e: any) {
    throw new Error(`This file could not be read as KML (${e?.message ?? e}).`)
  }
  if (!root || !['kml', 'Document', 'Folder', 'Placemark'].includes(root.localName)) {
    throw new Error('This file is not KML: it has no map data in it.')
  }

  const places: MissionLocationType[] = []
  const warnings: string[] = []
  let skipped = 0
  let notPoints = 0
  let seen = 0

  const placemark = (el: XmlElementLike, folder: string) => {
    seen++
    const name = childText(el, 'name')
    const coordinates = childNamed(el, 'Point') ? childText(childNamed(el, 'Point')!, 'coordinates') : null
    if (coordinates === null) {
      notPoints++
      skipped++
      return
    }
    const [lngText, latText] = coordinates.split(/\s+/)[0].split(',')
    const lng = parseCoordinateCell(lngText ?? '', 'lng')
    const lat = parseCoordinateCell(latText ?? '', 'lat')
    if (lat === null || lng === null) {
      skipped++
      warnings.push(`Placemark ${seen}${name ? ` (${name})` : ''} was skipped: its coordinates cannot be used.`)
      return
    }
    if (!name) {
      skipped++
      warnings.push(`Placemark ${seen} was skipped: it has no name.`)
      return
    }
    const place: MissionLocationType = { name, type: folder, lat, lng }
    const note = htmlToText(childText(el, 'description'))
    if (note) place.note = note
    places.push(place)
  }

  const visit = (el: XmlElementLike, folder: string) => {
    if (el.localName === 'Placemark') {
      placemark(el, folder)
    } else if (el.localName === 'Folder') {
      const here = childText(el, 'name') || folder
      childrenOf(el).forEach(c => visit(c, here))
    } else if (el.localName === 'Document' || el.localName === 'kml') {
      childrenOf(el).forEach(c => visit(c, folder))
    }
  }
  visit(root, '')

  if (notPoints) {
    warnings.unshift(notPointsWarning(notPoints))
  }
  return { places, skipped, warnings }
}

// ── Categories and the import plan ──────────────────────────────────────────────────────────

/** The category a NEW place with no category lands in. Deliberately not the mission's first category: that is usually the Command Post, which the range rings centre on. */
export const FALLBACK_CATEGORY = 'Other'

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Spells every incoming category the way the mission already spells it (matched
 * case-insensitively) and reports which names are new. A blank category is left blank here:
 * a blank cell never erases, so whether it means "keep what the place has" or "use the
 * fallback" depends on the merge (see planPlacesImport).
 */
export function resolveCategories(
  places: readonly MissionLocationType[], existingTypes: readonly string[],
): { places: MissionLocationType[]; newCategories: string[] } {
  const known = [...existingTypes]
  const newCategories: string[] = []
  const resolved = places.map(p => {
    const type = (p.type ?? '').trim()
    if (!type) return { ...p, type: '' }
    let spelling = known.find(k => sameName(k, type))
    if (!spelling) {
      spelling = type
      known.push(type)
      newCategories.push(type)
    }
    return { ...p, type: spelling }
  })
  return { places: resolved, newCategories }
}

/** Default colours for categories an import creates; the mission page edits them later. */
const NEW_CATEGORY_COLOURS = ['#2E7D32', '#AD1457', '#4527A0', '#00695C', '#9E9D24', '#5D4037', '#0277BD', '#EF6C00']

/** Category list entries for names an import introduced: a default colour, the generic pin. */
export function newCategoryEntries(names: readonly string[], existingCount: number): LocationCategoryType[] {
  return names.map((type, i) => ({
    type, color: NEW_CATEGORY_COLOURS[(existingCount + i) % NEW_CATEGORY_COLOURS.length], icon: 'pin' as const,
  }))
}

export type PlacesImportPlan = {
  merge: LocationMergeResult
  /** Category names the mission does not have yet; they are added with a default colour and icon. */
  newCategories: string[]
}

/** Resolve categories, then merge additively into the places already on the device. */
export function planPlacesImport(
  existing: readonly MissionLocationType[], incoming: readonly MissionLocationType[], existingTypes: readonly string[],
): PlacesImportPlan {
  const { places } = resolveCategories(incoming, existingTypes)
  const fallback = existingTypes.find(t => sameName(t, FALLBACK_CATEGORY)) ?? FALLBACK_CATEGORY
  const merge = mergeLocations(existing, places, { defaultType: fallback })

  // New categories = every type this import touched that the mission's list does not have.
  const touched = new Set([...merge.added, ...merge.overwritten, ...merge.unchanged])
  const newCategories: string[] = []
  for (const l of merge.locations) {
    const type = (l.type ?? '').trim()
    if (!type || !touched.has(l.name.trim())) continue
    if (existingTypes.some(t => sameName(t, type)) || newCategories.some(t => sameName(t, type))) continue
    newCategories.push(type)
  }
  return { merge, newCategories }
}

// ── Rows out, and choosing what goes ────────────────────────────────────────────────────────

export const PLACE_HEADERS = ['Name', 'Category', 'Latitude', 'Longitude', 'Address', 'Notes', 'uid'] as const

/**
 * The places as a table: headers, then one row per place, 5 decimals (as the Mission list shows).
 * The headers are the ones guessPlaceMapping() recognises, so the app's own export imports
 * again with no mapping changes.
 */
export function placesToRows(places: readonly MissionLocationType[]): string[][] {
  return [
    [...PLACE_HEADERS],
    ...places.map(p => [
      p.name, p.type, p.lat.toFixed(5), p.lng.toFixed(5), p.address ?? '', p.note ?? '', p.uid ?? '',
    ].map(v => String(v ?? ''))),
  ]
}

export type PlaceBounds = { south: number; west: number; north: number; east: number }

/** Picks places by category (all when `categories` is undefined) and, optionally, by what is inside a view. */
export function selectPlaces(
  places: readonly MissionLocationType[],
  opts: { categories?: readonly string[]; bounds?: PlaceBounds | null } = {},
): MissionLocationType[] {
  const wanted = opts.categories?.map(c => c.trim().toLowerCase())
  const b = opts.bounds
  return places.filter(p => {
    if (wanted && !wanted.includes((p.type ?? '').trim().toLowerCase())) return false
    if (b) {
      if (p.lat < b.south || p.lat > b.north) return false
      // A view that crosses the antimeridian has west > east.
      const inLng = b.west <= b.east ? p.lng >= b.west && p.lng <= b.east : p.lng >= b.west || p.lng <= b.east
      if (!inLng) return false
    }
    return true
  })
}

export type CategoryCount = { name: string; count: number }

/** The mission's categories in order, each with its place count, then any category a place uses that the list lacks. */
export function categoryCounts(places: readonly MissionLocationType[], types: readonly string[]): CategoryCount[] {
  const out: CategoryCount[] = types.map(name => ({ name, count: 0 }))
  for (const p of places) {
    const type = (p.type ?? '').trim()
    const hit = out.find(c => sameName(c.name, type))
    if (hit) hit.count++
    else out.push({ name: type, count: 1 })
  }
  return out
}
