import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { RadioLogComponent } from './radio-log.component';

describe('RadioLogComponent', () => {
  let component: RadioLogComponent;
  let fixture: ComponentFixture<RadioLogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ RadioLogComponent ],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /settings - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [ provideRouter([]) ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(RadioLogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * 2026-09-28, John (item 8a): "Print 309 Log" is a single click regardless of scope, but
   * the default scope used to be 'visible' (whatever the grid's current filter/sort
   * happened to show) rather than the common case the task describes - "everything since
   * the last print, or all." Defaults to 'sincePrint' now; see printScope's own comment in
   * radio-log.component.ts for why that one value covers both cases.
   */
  it('defaults the Print 309 scope to "since the last print" (or all, if never printed)', () => {
    expect(component.printScope()).toBe('sincePrint');
  });
});
