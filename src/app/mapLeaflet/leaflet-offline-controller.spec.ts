import * as L from 'leaflet'
import { LeafletOfflineController } from './leaflet-offline-controller'

// 2026-10-19, John (AAR): "Zoom to offline tiles" in the Montecito demo flew to the Grand
// Canyon tiles saved for an earlier demo. It now picks the saved area nearest the map.
describe('LeafletOfflineController.nearestSavedArea', () => {
  const tile = (south: number, west: number, size = 0.01) =>
    new L.Rectangle([[south, west], [south + size, west + size]])

  it('groups touching tiles into one area and picks the area nearest the map', () => {
    const layer = new L.FeatureGroup([
      // Grand Canyon: two touching tiles
      tile(36.05, -112.15), tile(36.05, -112.14),
      // Montecito: three touching tiles in a row
      tile(34.42, -119.65), tile(34.42, -119.64), tile(34.42, -119.63),
    ])
    const area = LeafletOfflineController.nearestSavedArea(layer, new L.LatLng(34.43, -119.63))
    expect(area.getWest()).toBeCloseTo(-119.65, 5)
    expect(area.getEast()).toBeCloseTo(-119.62, 5)
    expect(area.getSouth()).toBeCloseTo(34.42, 5)

    const gc = LeafletOfflineController.nearestSavedArea(layer, new L.LatLng(36.1, -112.1))
    expect(gc.getWest()).toBeCloseTo(-112.15, 5)
    expect(gc.getEast()).toBeCloseTo(-112.13, 5)
  })

  it('joins two groups when a later tile bridges them', () => {
    const layer = new L.FeatureGroup([tile(10, 10), tile(10, 10.02), tile(10, 10.01)])
    const area = LeafletOfflineController.nearestSavedArea(layer, new L.LatLng(0, 0))
    expect(area.getWest()).toBeCloseTo(10, 5)
    expect(area.getEast()).toBeCloseTo(10.03, 5)
  })
})
