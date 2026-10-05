import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { provideSwUpdateStub } from '../../../testing/sw-update.stub';
import { InstallUpdateComponent } from './install-update.component';
import { UpdateService, UsageStateService } from '../services';

describe('InstallUpdateComponent', () => {
  let component: InstallUpdateComponent;
  let fixture: ComponentFixture<InstallUpdateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InstallUpdateComponent],
      // Injects UpdateService, which needs SwUpdate present even though it stays
      // disabled here (same reasoning as footer.component.spec.ts, which this
      // component's update-ready state used to live in). provideRouter is for the
      // compact pill's routerLink="/help" help zone (E-57(1)).
      providers: [provideHttpClient(), provideSwUpdateStub(), provideRouter([]),
        // UsageStateService.quiet() reads the radio log in localStorage, which other specs leave
        // behind; in a random order it turns 'live' and hides the pill. Pin it not-quiet.
        { provide: UsageStateService, useValue: { quiet: signal(false) } }]
    })
      .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(InstallUpdateComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders nothing when neither installable nor an update is ready', () => {
    expect(component.installable).toBeFalse();
    expect(component.updateReady).toBeFalse();
    expect(fixture.nativeElement.querySelector('.rt-install-update')).toBeNull();
  });

  describe('[stickyBottom]=true (E-57(1), replaces the old top-fixed [fixed])', () => {
    it('renders nothing when neither installable nor an update is ready', () => {
      fixture.componentRef.setInput('stickyBottom', true);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.rt-install-update')).toBeNull();
    });

    it('renders the install pill, floating, when installable', () => {
      fixture.componentRef.setInput('stickyBottom', true);
      spyOnProperty(component, 'installable').and.returnValue(true);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('.rt-install-update');
      expect(el).not.toBeNull();
      expect(el.classList.contains('rt-install-update--install')).toBeTrue();
      expect(el.classList.contains('rt-install-update--sticky-bottom')).toBeTrue();
      // Two click targets sharing one pill: the main action and the help link to Help
      // (E-57(1): "help & details should link to help").
      expect(el.querySelector('.rt-install-update__main')).not.toBeNull();
      const help = el.querySelector('.rt-install-update__help');
      expect(help).not.toBeNull();
      expect(help.getAttribute('href')).toBe('/help');
    });

    it('renders the update pill, taking priority over an install offer, when an update is ready', () => {
      fixture.componentRef.setInput('stickyBottom', true);
      spyOnProperty(component, 'installable').and.returnValue(true);
      TestBed.inject(UpdateService).updateReady.set(true);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('.rt-install-update');
      expect(el).not.toBeNull();
      expect(el.classList.contains('rt-install-update--update')).toBeTrue();
      expect(fixture.nativeElement.querySelector('.rt-install-update--install')).toBeNull();
      // The actual "stays visible regardless of scroll" claim, checked against Angular's
      // real scoped stylesheet (not a synthetic DOM injection, which emulated view
      // encapsulation would silently ignore - see tools/e2e-adjacent verification script's
      // own comment on that trap).
      //
      // 2026-08-21: was `position: fixed` - which floated this over page content in a
      // corner regardless of where the real footer was, the opposite of "fit into the
      // footer" (see footer.component.scss's own history). `sticky` is what actually
      // delivers this component's documented intent: a normal member of the footer's row
      // that only pins to the viewport bottom once scrolling would carry it away.
      const style = getComputedStyle(el);
      expect(style.position).toBe('sticky');
      expect(Number(style.zIndex)).toBeGreaterThan(0); // above ordinary in-flow content
    });
  });

  describe('help link (E-57(1): "help & details should link to help")', () => {
    it('the detailed (Settings) variant has no separate help zone - the paragraph already explains it', () => {
      fixture.componentRef.setInput('detailed', true);
      spyOnProperty(component, 'installable').and.returnValue(true);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.rt-install-update__help')).toBeNull();
      expect(fixture.nativeElement.querySelector('.rt-install-update__text')).not.toBeNull();
    });
  });
});
