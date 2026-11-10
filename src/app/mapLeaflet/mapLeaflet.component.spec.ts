import { ComponentFixture, TestBed } from '@angular/core/testing'

import { LmapComponent } from './mapLeaflet.component'

describe('LmapComponent', () => {
  let component: LmapComponent
  let fixture: ComponentFixture<LmapComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LmapComponent],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(LmapComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  // E-64 blocker: LmapComponent declared `implements OnDestroy` but never defined one, so
  // neither Leaflet instance was ever torn down on navigation away - invisible until a
  // repeated engine-switch toggle turns the latent leak into a real one. Real L.Map
  // instances (Karma runs in an actual browser via ChromeHeadless, not jsdom), so spying on
  // their own .remove() proves the fix's actual mechanism, not just that a method exists.
  it('removes both Leaflet instances on destroy (E-64 teardown fix)', () => {
    const lMap = (
      component as unknown as {
        lMap: {
          remove: () => void
        }
      }
    ).lMap
    const overviewMapLeaflet = (
      component as unknown as {
        overviewMapLeaflet: {
          remove: () => void
        }
      }
    ).overviewMapLeaflet
    expect(lMap).toBeTruthy()
    expect(overviewMapLeaflet).toBeTruthy()

    const lMapRemoveSpy = vi.spyOn(lMap, 'remove')
    const overviewRemoveSpy = vi.spyOn(overviewMapLeaflet, 'remove')

    fixture.destroy()

    expect(lMapRemoveSpy).toHaveBeenCalledTimes(1)
    expect(overviewRemoveSpy).toHaveBeenCalledTimes(1)
  })

  // 2026-10-18: printing swaps the cluster for plain markers; that must not raise the
  // "Filtered: Radio log entries hidden" chip, but a real hide must still raise it.
  it('does not count the print marker swap as hiding radio log entries', () => {
    const c = component as unknown as {
      lMap: {
        removeLayer: (l: unknown) => void
        addLayer: (l: unknown) => void
      }
      myMarkerCluster: unknown
      print: {
        setPrintMarkers: (p: boolean) => void
      }
    }
    expect(component.entriesOn()).toBe(true)
    c.print.setPrintMarkers(true)
    expect(component.entriesOn()).toBe(true)
    // The print rings go on right after the swap, while the cluster is off the map (0.99.58 bug).
    const rings = (
      component as unknown as {
        rangeRingsLayer: unknown
      }
    ).rangeRingsLayer
    c.lMap.addLayer(rings)
    expect(component.entriesOn()).toBe(true)
    c.lMap.removeLayer(rings)
    c.print.setPrintMarkers(false)
    expect(component.entriesOn()).toBe(true)
    c.lMap.removeLayer(c.myMarkerCluster)
    expect(component.entriesOn()).toBe(false)
  })
})
