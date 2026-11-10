import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { HelpDataComponent } from '../../lazy/help/tabs/help-data.component'
import { ViewService } from '../services/view.service'
import { MoreAboutComponent } from './more-about.component'

// E-207 / ADR D-62 phase 3: Simple view folds the long help text; Full view opens it. Never removed.
describe('MoreAboutComponent', () => {
  beforeEach(async () => {
    localStorage.removeItem('rt-view')
    localStorage.removeItem('rt-view-source')
    await TestBed.configureTestingModule({
      imports: [MoreAboutComponent, HelpDataComponent],
      providers: [provideRouter([])],
    }).compileComponents()
  })

  afterEach(() => {
    localStorage.removeItem('rt-view')
    localStorage.removeItem('rt-view-source')
  })

  function details(view: 'simple' | 'full'): HTMLDetailsElement {
    TestBed.inject(ViewService).setView(view)
    const fixture = TestBed.createComponent(MoreAboutComponent)
    fixture.detectChanges()
    return fixture.nativeElement.querySelector('details')
  }

  it('starts folded in Simple view, with the "More about this" label', () => {
    const d = details('simple')
    expect(d.open).toBe(false)
    expect(d.querySelector('summary')?.textContent).toContain('More about this')
  })

  it('starts open in Full view', () => {
    expect(details('full').open).toBe(true)
  })

  it('follows a change of view while showing', () => {
    const view = TestBed.inject(ViewService)
    view.setView('simple')
    const fixture = TestBed.createComponent(MoreAboutComponent)
    fixture.detectChanges()
    view.setView('full')
    fixture.detectChanges()
    expect(fixture.nativeElement.querySelector('details').open).toBe(true)
  })

  // AAR 2026-10-19 obs 9: "Where do I attach a file?" Help says, in either view.
  it('Help > Data says Attach is in Full view when Simple view hides it', () => {
    TestBed.inject(ViewService).setView('simple')
    const fixture = TestBed.createComponent(HelpDataComponent)
    fixture.detectChanges()
    const line: string = fixture.nativeElement.querySelector(
      '[data-testid="help-where-attach"]'
    ).textContent
    expect(line).toContain('Full view')
    // The long attachments detail is still on the page, folded.
    expect(fixture.nativeElement.textContent).toContain(
      'Originals keep their hidden details'
    )
  })

  it('Help > Data says where Attach is on Entry in Full view', () => {
    TestBed.inject(ViewService).setView('full')
    const fixture = TestBed.createComponent(HelpDataComponent)
    fixture.detectChanges()
    const line: string = fixture.nativeElement.querySelector(
      '[data-testid="help-where-attach"]'
    ).textContent
    expect(line).toContain('under the Notes box')
  })
})
