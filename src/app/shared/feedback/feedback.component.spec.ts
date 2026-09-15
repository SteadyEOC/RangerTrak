import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FeedbackComponent } from './feedback.component';

describe('FeedbackComponent', () => {
  let component: FeedbackComponent;
  let fixture: ComponentFixture<FeedbackComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeedbackComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(FeedbackComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('cannot submit an empty or whitespace-only message', () => {
    component.message = '   ';
    expect(component.canSubmit).toBe(false);
  });

  it('can submit once a message is typed', () => {
    component.message = 'The map looks great';
    expect(component.canSubmit).toBe(true);
  });

  it('posts to /api/feedback, never including mission data, and shows the created issue on success', async () => {
    component.message = 'Found a bug in Entry';
    component.contact = 'scribe@example.com';

    const submitPromise = component.onSubmit();
    const req = httpMock.expectOne('/api/feedback');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ message: 'Found a bug in Entry', contact: 'scribe@example.com' });
    // Explicit E-15/D-15 privacy check: only these two hand-typed fields are ever sent.
    expect(Object.keys(req.request.body)).toEqual(['message', 'contact']);

    req.flush({ url: 'https://github.com/SteadyEOC/RangerTrak/issues/7' });
    await submitPromise;

    expect(component.status()).toBe('success');
    expect(component.successUrl()).toBe('https://github.com/SteadyEOC/RangerTrak/issues/7');
  });

  it('falls back to a direct GitHub link on failure, carrying the typed message over', async () => {
    component.message = 'Reset button is too small';

    const submitPromise = component.onSubmit();
    const req = httpMock.expectOne('/api/feedback');
    req.flush({ error: 'could not submit feedback' }, { status: 502, statusText: 'Bad Gateway' });
    await submitPromise;

    expect(component.status()).toBe('error');
    const [base, query] = component.fallbackUrl.split('?');
    expect(base).toBe('https://github.com/SteadyEOC/RangerTrak/issues/new');
    expect(new URLSearchParams(query).get('body')).toBe('Reset button is too small');
  });

  it('reset() clears the form back to a blank, idle state', async () => {
    component.message = 'Something';
    component.contact = 'me@example.com';

    const submitPromise = component.onSubmit();
    httpMock.expectOne('/api/feedback').flush({ url: 'https://github.com/SteadyEOC/RangerTrak/issues/1' });
    await submitPromise;

    component.reset();

    expect(component.message).toBe('');
    expect(component.contact).toBe('');
    expect(component.status()).toBe('idle');
    expect(component.successUrl()).toBe('');
  });
});
