import * as L from 'leaflet'

/**
 * The Map page's layers box. Leaflet's own LayersControl with two changes, both for Leaflet 2.0.0-beta.5.
 *
 * Beta.5 made a collapsed layers box build its list only when it expands (#10266: rebuilding on every layer
 * change was O(n²)). Before that the rows were always in the page. Two things relied on that:
 *
 *  - the E-207 / D-62 row hiding (syncLayerExtras() in mapLeaflet.component.ts) styles rows in place. A
 *    rebuild on expand makes new rows and drops that styling, so `onExpand` runs it again after each expand;
 *  - the e2e checks and tools/print-map-sheet.js read and click the rows without opening the box. `onAdd`
 *    therefore expands and collapses once, so the rows exist from the start, as they did before.
 *
 * Only Leaflet's public expand() / collapse() are used. With about a dozen rows the O(n²) cost does not matter.
 */
export class RtLayersControl extends L.LayersControl {
  /** Runs after every expand, once the list has been rebuilt (if it needed it). */
  onExpand?: () => void

  override onAdd(map: L.Map): HTMLElement {
    const container = super.onAdd(map)
    if (this.options.collapsed !== false) {
      // collapse() waits for collapseDelay; build the list with the box open, then close it at once.
      const delay = this.options.collapseDelay
      this.options.collapseDelay = 0
      this.expand()
      this.collapse()
      this.options.collapseDelay = delay
    }
    return container
  }

  override expand(): this {
    super.expand()
    this.onExpand?.()
    return this
  }
}
