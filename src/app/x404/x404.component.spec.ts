import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { X404Component } from './x404.component';

describe('X404Component', () => {
  let component: X404Component;
  let fixture: ComponentFixture<X404Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ X404Component ],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /settings - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [ provideRouter([]) ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(X404Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('tells crawlers not to index the page, and stops when it goes', () => {
    const tag = () => document.head.querySelector('meta[name="robots"]');
    expect(tag()?.getAttribute('content')).toBe('noindex');
    fixture.destroy();
    expect(tag()).toBeNull();
  });
});
