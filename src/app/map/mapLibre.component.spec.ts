import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MapLibreComponent } from './mapLibre.component';

describe('MapLibreComponent', () => {
  let component: MapLibreComponent;
  let fixture: ComponentFixture<MapLibreComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MapLibreComponent]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(MapLibreComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reads the current radio log entry count on init', () => {
    expect(component.numAllRows()).toBeGreaterThanOrEqual(0);
  });

  it('toggles selected-reports display without throwing', () => {
    expect(() => component.onSwitchSelectedRadioLog()).not.toThrow();
  });
});
