import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MapPageComponent } from './map-page.component';
import { MapLibreComponent } from '../mapLibre.component';

// The 300ms sleeps that used to pad every mount/destroy here are gone as of 2026-08-31.
// They were compensating for Leaflet's uncancelled 250ms zoom-transition timer throwing
// after teardown - an uncaught async error that failed whichever spec was mid-flight, so
// it showed up as an unrelated, intermittent, CI-only failure. Fixed at the root in
// shared/mapping/leaflet-teardown.ts; if these sleeps ever look tempting again, that
// helper has stopped being called somewhere.
describe('MapPageComponent', () => {
  let component: MapPageComponent;
  let fixture: ComponentFixture<MapPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapPageComponent],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /mission - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [provideRouter([])]
    })
      .compileComponents();
  });

  beforeEach(async () => {
    fixture = TestBed.createComponent(MapPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // E-64: Leaflet is the hardcoded default - no auto-detection, no readiness signals.
  it('mounts Leaflet by default, not MapLibre', async () => {
    expect(component.engine()).toBe('leaflet');
    expect(fixture.nativeElement.querySelector('.mapLeaflet-container')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.map-container')).toBeFalsy();
  });

  // The entire reason MapPageComponent exists as a route-level shell rather than a
  // statically-importing component: MapLibre must stay behind a real dynamic import() so a
  // visitor who never flips the switch never fetches its chunk.
  it('dynamically imports and mounts MapLibre only when the switch is flipped', async () => {
    expect(component.maplibreComponentType()).toBeNull();

    const fakeEvent = { checked: true };
    await component.onEngineSwitchChanged(fakeEvent);
    fixture.detectChanges();

    expect(component.engine()).toBe('maplibre');
    expect(component.maplibreComponentType()).toBe(MapLibreComponent);

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.map-container')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.mapLeaflet-container')).toBeFalsy();
  });

  it('flipping back to Leaflet unmounts MapLibre and remounts Leaflet', async () => {
    const toMaplibre = { checked: true };
    await component.onEngineSwitchChanged(toMaplibre);
    fixture.detectChanges();

    const toLeaflet = { checked: false };
    await component.onEngineSwitchChanged(toLeaflet);
    fixture.detectChanges();

    expect(component.engine()).toBe('leaflet');
    expect(fixture.nativeElement.querySelector('.mapLeaflet-container')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.map-container')).toBeFalsy();
  });
});
