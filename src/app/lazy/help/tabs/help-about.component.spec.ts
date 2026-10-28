import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HelpAboutComponent } from './help-about.component';

describe('HelpAboutComponent', () => {
  let component: HelpAboutComponent;
  let fixture: ComponentFixture<HelpAboutComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpAboutComponent],
    })
      .compileComponents();

    fixture = TestBed.createComponent(HelpAboutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // D-d (2026-08-29): the feedback form (and with it, the Log link) moved on from here to
  // the new Feedback tab - see help-feedback.component.spec.ts. This tab keeps only the
  // About/How-it's-built content F29-25 (0.78.0) consolidated here.
  it('carries the How it is built section, and points to the Contact us tab', () => {
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('How it is built');
    expect(text).toContain('Contact us');
  });
});
