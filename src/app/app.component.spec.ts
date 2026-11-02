import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { provideSwUpdateStub } from '../testing/sw-update.stub';
import { AppComponent } from './app.component';

/**
 * These three specs all failed with NG0201 (no provider for SwUpdate) before
 * reaching their assertions - see src/testing/sw-update.stub.ts for why the
 * stub is shaped the way it is (PRIVATE-Roadmap.md Section 18/D).
 */
describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        AppComponent
      ],
      providers: [
        provideHttpClient(),
        provideSwUpdateStub()
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have as title 'RangerTrak'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('RangerTrak');
  });

  it('renders the navbar and footer chrome around the router outlet', () => {
    // Replaces a check for "rangertrak app is running!" - the Angular CLI's
    // starter template text, which this app has not rendered in years.
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('rangertrak-navbar')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();

    // E-272: the footer waits for the first routed page, so it never paints under an empty outlet.
    expect(compiled.querySelector('rangertrak-footer')).toBeNull();
    fixture.componentInstance.onRouteActivated();
    fixture.detectChanges();
    expect(compiled.querySelector('rangertrak-footer')).toBeTruthy();
  });
});
