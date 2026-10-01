import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GEOCODING_PROVIDER, NominatimGeocoder } from '../shared';
import { LocationComponent } from './location.component';

describe('LocationComponent', () => {
  let component: LocationComponent;
  let fixture: ComponentFixture<LocationComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ LocationComponent ],
      providers: [
        { provide: GEOCODING_PROVIDER, useValue: new NominatimGeocoder() }
      ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(LocationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // 2026-10-01, blog session's BREAKING BUG: 36.0524 showed as "36 . 524" and any DD edit
  // rebuilt it as 36.524 (~55 km away). The parts are digit strings now.
  describe('decimal degrees boxes keep leading zeros and the sign', () => {
    it('splits a value into whole degrees and fraction digits, leading zeros kept', () => {
      expect(LocationComponent.degreesToDdParts(36.0524)).toEqual({ i: '36', f: '0524' });
      expect(LocationComponent.degreesToDdParts(-112.0437)).toEqual({ i: '-112', f: '0437' });
      expect(LocationComponent.degreesToDdParts(-0.12)).toEqual({ i: '-0', f: '12' });
      expect(LocationComponent.degreesToDdParts(47)).toEqual({ i: '47', f: '0' });
      expect(LocationComponent.degreesToDdParts(36.999999)).toEqual({ i: '37', f: '0' });
    });

    it('rebuilds the value from the boxes, including a typed "05" and a "-0"', () => {
      expect(LocationComponent.ddPartsToDegrees('36', '0524')).toBeCloseTo(36.0524, 9);
      expect(LocationComponent.ddPartsToDegrees('36', '05')).toBeCloseTo(36.05, 9);
      expect(LocationComponent.ddPartsToDegrees('-112', '0437')).toBeCloseTo(-112.0437, 9);
      expect(LocationComponent.ddPartsToDegrees('-0', '12')).toBeCloseTo(-0.12, 9);
    });

    it('editing only the longitude leaves a latitude like 36.0524 where it was', () => {
      const c = component as any;
      c.canonical.set({ lat: 36.0524, lng: -112.0437 });
      let emitted: { lat: number, lng: number } | undefined;
      spyOn(c, 'newLocationToFormAndEmit').and.callFake((loc: { lat: number, lng: number }) => { emitted = loc; });
      component.ddModel.update(m => ({ ...m, lngF: '0500' }));
      component.onDdChg();
      expect(emitted!.lat).toBeCloseTo(36.0524, 9);
      expect(emitted!.lng).toBeCloseTo(-112.05, 9);
    });
  });

  // E-114 §1a (2026-08-31): "the ranger will almost always use the same coordinate system,
  // so initially we offer ALL OPTIONS, then just default to that."
  describe('remembered coordinate format', () => {
    afterEach(() => {
      localStorage.removeItem('lastCoordinateFormat');
    });

    it('setActiveSystem persists the choice for next time', () => {
      component.setActiveSystem('UTM');
      expect(localStorage.getItem('lastCoordinateFormat')).toBe('UTM');
    });

    it('a fresh component opens on the remembered format, outranking the mission default', () => {
      localStorage.setItem('lastCoordinateFormat', 'MGRS');

      const freshFixture = TestBed.createComponent(LocationComponent);
      freshFixture.detectChanges();

      expect(freshFixture.componentInstance.activeSystem()).toBe('MGRS');
    });

    it('ignores a garbage stored value rather than crashing', () => {
      localStorage.setItem('lastCoordinateFormat', 'not-a-real-format');

      const freshFixture = TestBed.createComponent(LocationComponent);
      expect(() => freshFixture.detectChanges()).not.toThrow();
      expect(freshFixture.componentInstance.activeSystem()).toBe('DD');
    });
  });
});
