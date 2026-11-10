import { TestBed } from '@angular/core/testing'

import { MapEngineService } from './map-engine.service'

describe('MapEngineService', () => {
  let service: MapEngineService

  beforeEach(() => {
    TestBed.configureTestingModule({})
    service = TestBed.inject(MapEngineService)
  })

  it('defaults to leaflet', () => {
    expect(service.engine()).toBe('leaflet')
  })

  it('setEngine updates the signal', () => {
    service.setEngine('maplibre')
    expect(service.engine()).toBe('maplibre')
    service.setEngine('leaflet')
    expect(service.engine()).toBe('leaflet')
  })

  // E-64 decision: the switch is session-only, never persisted - a full reload always
  // returns to the Leaflet default, which is what keeps this pass schema-free.
  it('never touches localStorage', () => {
    vi.spyOn(localStorage, 'setItem').mockReturnValue(undefined)
    service.setEngine('maplibre')
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})
