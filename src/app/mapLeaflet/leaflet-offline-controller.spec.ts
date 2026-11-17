import * as L from 'leaflet'
import { LeafletOfflineController } from './leaflet-offline-controller'

// 2026-10-19, John (AAR): "Zoom to offline tiles" in the Montecito demo flew to the Grand
// Canyon tiles saved for an earlier demo. It now picks the saved area nearest the map.
describe('LeafletOfflineController.nearestSavedArea', () => {
  const tile = (south: number, west: number, size = 0.01) =>
    new L.Rectangle([
      [south, west],
      [south + size, west + size],
    ])

  it('groups touching tiles into one area and picks the area nearest the map', () => {
    const layer = new L.FeatureGroup([
      // Grand Canyon: two touching tiles
      tile(36.05, -112.15),
      tile(36.05, -112.14),
      // Montecito: three touching tiles in a row
      tile(34.42, -119.65),
      tile(34.42, -119.64),
      tile(34.42, -119.63),
    ])
    const area = LeafletOfflineController.nearestSavedArea(
      layer,
      new L.LatLng(34.43, -119.63)
    )
    expect(area.getWest()).toBeCloseTo(-119.65, 5)
    expect(area.getEast()).toBeCloseTo(-119.62, 5)
    expect(area.getSouth()).toBeCloseTo(34.42, 5)

    const gc = LeafletOfflineController.nearestSavedArea(
      layer,
      new L.LatLng(36.1, -112.1)
    )
    expect(gc.getWest()).toBeCloseTo(-112.15, 5)
    expect(gc.getEast()).toBeCloseTo(-112.13, 5)
  })

  it('joins two groups when a later tile bridges them', () => {
    const layer = new L.FeatureGroup([tile(10, 10), tile(10, 10.02), tile(10, 10.01)])
    const area = LeafletOfflineController.nearestSavedArea(layer, new L.LatLng(0, 0))
    expect(area.getWest()).toBeCloseTo(10, 5)
    expect(area.getEast()).toBeCloseTo(10.03, 5)
  })

  // E-308 (11-14 drill): coarse saved tiles (z4) span hundreds of km and used to merge far-apart areas.
  const zTile = (south: number, west: number, size: number, z: number) => {
    const r = new L.Rectangle([[south, west], [south + size, west + size]]) as unknown as { feature?: unknown } & L.Rectangle
    ;(r as { feature?: unknown }).feature = { type: 'Feature', properties: { z } }
    return r
  }

  it('finds areas from the most detailed saved tiles, so one coarse tile cannot merge them', () => {
    const layer = new L.FeatureGroup([
      zTile(30, -125, 20, 4), // one huge z4 tile over both places
      zTile(36.05, -112.15, 0.01, 16),
      zTile(47.40, -122.46, 0.01, 16),
    ])
    const vashon = LeafletOfflineController.nearestSavedArea(layer, new L.LatLng(47.4, -122.4))
    expect(vashon.getSouth()).toBeCloseTo(47.40, 5)
    expect(vashon.getNorth()).toBeCloseTo(47.41, 5)
  })

  it('lists the zooms saved over an area, coarsest first', () => {
    const layer = new L.FeatureGroup([zTile(30, -125, 20, 4), zTile(47.40, -122.46, 0.01, 16), zTile(47.40, -122.46, 0.02, 15)])
    expect(LeafletOfflineController.savedZoomsIn(layer, new L.LatLngBounds([47.40, -122.46], [47.41, -122.45]))).toEqual([4, 15, 16])
  })
})
