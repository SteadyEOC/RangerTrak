import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StaleOriginNoticeComponent } from './stale-origin-notice.component';
import { UsageStateService } from '../services';

describe('StaleOriginNoticeComponent', () => {
  let component: StaleOriginNoticeComponent;
  let fixture: ComponentFixture<StaleOriginNoticeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ StaleOriginNoticeComponent ],
      // UsageStateService.quiet() reads the radio log in localStorage, which other specs leave
      // behind; in a random order it turns 'live' and hides this component. Pin it not-quiet.
      providers: [{ provide: UsageStateService, useValue: { quiet: signal(false) } }]
    })
    .compileComponents();
  });

  it('should create', () => {
    fixture = TestBed.createComponent(StaleOriginNoticeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('stays hidden on the canonical host (Karma runs on localhost, not www.rangertrak.org)', () => {
    fixture = TestBed.createComponent(StaleOriginNoticeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    expect(component.isStaleOrigin).toBeFalse();
    expect(component.visible).toBeFalse();
    expect(fixture.nativeElement.querySelector('.stale-origin-notice')).toBeNull();
  });

  it('would show on the stale www. origin, and points at the canonical URL', () => {
    // Karma's test host is never actually www.rangertrak.org, so exercise the visibility
    // logic directly rather than trying to spoof window.location.hostname. Spy applied
    // BEFORE the first detectChanges() - applying it after would make isStaleOrigin's
    // return value change between the first and second check-cycle, which is exactly what
    // NG0100 exists to catch, correctly, on a getter this component's own @if reads live.
    fixture = TestBed.createComponent(StaleOriginNoticeComponent);
    component = fixture.componentInstance;
    spyOnProperty(component, 'isStaleOrigin', 'get').and.returnValue(true);
    fixture.detectChanges();
    expect(component.visible).toBeTrue();
    expect(component.canonicalUrl).toBe('https://rangertrak.org');
  });

  it('dismiss() hides it for the rest of the session', () => {
    fixture = TestBed.createComponent(StaleOriginNoticeComponent);
    component = fixture.componentInstance;
    spyOnProperty(component, 'isStaleOrigin', 'get').and.returnValue(true);
    fixture.detectChanges();
    expect(component.visible).toBeTrue();
    component.dismiss();
    fixture.detectChanges();
    expect(component.visible).toBeFalse();
  });
});
