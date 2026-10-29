import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewService } from '../../../shared/services/view.service';
import { HelpFeedbackComponent } from './help-feedback.component';

describe('HelpFeedbackComponent', () => {
  let component: HelpFeedbackComponent;
  let fixture: ComponentFixture<HelpFeedbackComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // provideHttpClient(+Testing) for the embedded feedback form; provideRouter for the
      // routerLink="/log" link inside the folded-in Log section.
      imports: [HelpFeedbackComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    })
      .compileComponents();

    // E-207: Simple view hides the Log link, so the tests that need it ask for Full view first.
    localStorage.removeItem('rt-view');
    localStorage.removeItem('rt-view-source');
    fixture = TestBed.createComponent(HelpFeedbackComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('rt-view');
    localStorage.removeItem('rt-view-source');
  });

  function useView(view: 'simple' | 'full'): void {
    TestBed.inject(ViewService).setView(view);
    fixture.detectChanges();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // D-d, F29-26 (2026-08-29): this tab took over both the feedback form (moved on again from
  // About, which briefly carried it after F29-25/0.78.0) and the Log tab it replaced.
  it('carries the feedback form and, in Full view, a link to the Log page', () => {
    useView('full');
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain("What's on your mind?");
    const link: HTMLAnchorElement | null =
      fixture.nativeElement.querySelector('a[href="/log"]');
    expect(link).not.toBeNull();
  });

  // E-207 / D-62 left the Log link out of Simple view while it hung off Debug mode. E-258
  // (2026-10-28) retired Debug mode and made the Diagnostic log section always shown.
  it('keeps the feedback form and the Log link in Simple view too', () => {
    useView('simple');
    expect(fixture.nativeElement.textContent).toContain("What's on your mind?");
    expect(fixture.nativeElement.querySelector('a[href="/log"]')).not.toBeNull();
  });
});
