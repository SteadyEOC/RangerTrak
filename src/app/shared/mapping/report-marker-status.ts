import { RadioLogStatusType, LocationCategoryType, statusColorValue } from '../services'

/**
 * Resolves a radio log entry's configured status color for use as a marker "shadow" (a
 * colored halo behind the ranger's own shape+color marker, so a scribe can read urgency
 * at a glance without opening the popup) - raised live, 2026-08-26. Reuses the same
 * `statusColorValue()` indirection the Entry radios and the grids already use, so a marker's
 * halo and the Mission page's own status color swatch are always the same color, never a
 * second palette to keep in sync.
 */
export function radioLogStatusColor(
  status: string,
  radioLogStatuses: RadioLogStatusType[]
): string | undefined {
  const entry = radioLogStatuses.find(s => s.status === status)
  return entry ? statusColorValue(entry.color) : undefined
}

/**
 * ADR D-49: resolves a Location's configured category color against the mission's own
 * `locationTypes` list - same indirection as radioLogStatusColor() above, for the same
 * reason (a mission can rename/recolor "Command Post" without this lookup changing). Unlike
 * that function, `LocationCategoryType.color` is always a literal hex (mission-migration.ts's
 * own comment on DEFAULT_LOCATION_TYPES explains why it deliberately skips the
 * `--rt-status-*` semantic-token indirection `statusColorValue()` resolves) - so no
 * `statusColorValue()` call is needed here, and the fallback is a neutral grey for a
 * category name the mission's list no longer has (renamed/deleted after the location was
 * placed), same "never silently invisible" reasoning as radioLogStatusColor's callers.
 */
export function locationCategoryColor(
  type: string,
  locationTypes: LocationCategoryType[]
): string {
  return locationTypes.find(t => t.type === type)?.color ?? '#616161'
}

/**
 * MapLibre's paint expressions are evaluated by its own WebGL renderer, not the DOM/CSSOM -
 * a `var(--rt-status-urgent)` string that resolves fine inside a Leaflet `L.divIcon`'s real
 * DOM/SVG (ranger-icon.ts) is meaningless there. A raw color (a user-picked custom status
 * color) passes through untouched, same tolerance `statusColorValue()` itself documents.
 *
 * **Not just `getComputedStyle(document.documentElement).getPropertyValue(...)` - tried
 * first and confirmed wrong.** `--rt-status-*` (`_tokens.scss`) is declared with
 * `light-dark(#hexLight, #hexDark)` as its value, and `getPropertyValue()` on a custom
 * property returns that raw, UNEVALUATED source text verbatim (custom properties are
 * untyped - the browser has no reason to resolve a color function inside one). Confirmed
 * live: `getPropertyValue('--rt-status-urgent')` literally returns
 * `"light-dark(#B3261E, #FF6B5E)"`, which MapLibre's own color parser cannot parse.
 * `getComputedStyle(el).color`, by contrast, is always resolved by the spec - the browser
 * has to serialise `color` as a concrete `rgb()` no matter what produced it. So: apply the
 * candidate value as `color` on a real (connected, so it inherits the page's actual
 * `color-scheme`) element, read the resolved `color` back, discard the element. Not reactive
 * to a live light/dark toggle - resolved once when the GeoJSON is (re)built, same refresh
 * cadence every other marker property already has.
 */
export function resolveCssColorForCanvas(cssColor: string): string {
  if (!cssColor.startsWith('var(')) {
    return cssColor
  }
  // NOT display:none - some engines skip full style resolution for a display:none subtree.
  // Positioned off-screen and non-interactive instead, so it never paints or is reachable,
  // but the browser still resolves `color` on it exactly as it would for any real element.
  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.left = '-9999px'
  probe.style.pointerEvents = 'none'
  probe.style.color = cssColor
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved || '#888888'
}
