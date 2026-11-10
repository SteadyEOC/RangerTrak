import { ComponentFixture, TestBed } from '@angular/core/testing'

import { MiniMapLeafletComponent } from './mini-mapLeaflet.component'

describe('MiniMapLeafletComponent', () => {
  let component: MiniMapLeafletComponent
  let fixture: ComponentFixture<MiniMapLeafletComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MiniMapLeafletComponent],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(MiniMapLeafletComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  // E-64 blocker: same gap as LmapComponent (see its spec) - declared OnDestroy, never
  // defined it, so the map was never torn down leaving Entry. Entry is the most-visited
  // page, so this leak fired on every visit.
  it('removes the Leaflet instance on destroy (E-64 teardown fix)', () => {
    const lMap = (
      component as unknown as {
        lMap: {
          remove: () => void
        }
      }
    ).lMap
    expect(lMap).toBeTruthy()

    const removeSpy = vi.spyOn(lMap, 'remove')

    fixture.destroy()

    expect(removeSpy).toHaveBeenCalledTimes(1)
  })
})
