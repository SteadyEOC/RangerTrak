import * as L from 'leaflet'

/**
 * Removes a Leaflet map without letting a zoom animation throw after it is gone.
 *
 * Leaflet 1.9.4 starts a zoom animation by setting `_animatingZoom = true` and scheduling
 * `setTimeout(this._onZoomTransitionEnd, 250)` as a fallback for browsers that never fire
 * `transitionend` (leaflet-src.js:4802 and :4827). **That timer is never cancelled** — not
 * by `map.remove()`, not by `map.stop()`, which only cancel pan/flyTo animation frames.
 *
 * `map.remove()` ends with `delete this._mapPane` (leaflet-src.js, `remove:`). So if a map
 * is destroyed mid-zoom, the orphaned timer fires up to 250ms later and runs
 * `_onZoomTransitionEnd` against a half-dismantled map:
 *
 *   - its own `if (!this._animatingZoom) return` guard passes, because nothing cleared it
 *   - Leaflet's `if (this._mapPane)` guard correctly skips the class removal
 *   - it then calls `this._move(...)` *unconditionally*, which reaches
 *     `_getMapPanePos()` -> `getPosition(undefined)` -> reads `undefined._leaflet_pos`
 *
 * and throws `TypeError: Cannot read properties of undefined (reading '_leaflet_pos')` from
 * a bare timer callback, with no stack pointing at any of our code.
 *
 * In the app this is uncaught console noise when someone navigates away from a map while it
 * is still zooming. Under the unit tests it is worse: an uncaught async error fails whichever spec
 * happens to be running when the timer lands, so it surfaces as a *different, innocent*
 * test failing, intermittently, only on slower machines. It is why
 * map-page.component.spec.ts used to sleep 300ms (> Leaflet's 250) after every mount.
 *
 * Clearing the flag first makes the orphan timer hit Leaflet's own early return and do
 * nothing. `_animatingZoom` is private, hence the cast — there is no public API for this
 * ("stop the zoom animation" is not exposed), and the alternative is patching Leaflet.
 */
export function removeLeafletMap(map: L.Map | null | undefined): void {
  if (!map) { return }
  (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false
  map.remove()
}
