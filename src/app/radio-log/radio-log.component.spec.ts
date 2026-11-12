import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { RadioLogComponent } from './radio-log.component'

describe('RadioLogComponent', () => {
  let component: RadioLogComponent
  let fixture: ComponentFixture<RadioLogComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RadioLogComponent],
      // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
      // routerLink to /settings - needs a Router in every test that mounts the shared
      // page chrome, not just specs that touch routing directly.
      providers: [provideRouter([])],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(RadioLogComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  /**
   * 2026-09-28, John (item 8a): "Print 309 Log" is a single click regardless of scope, but
   * the default scope used to be 'visible' (whatever the grid's current filter/sort
   * happened to show) rather than the common case the task describes - "everything since
   * the last print, or all." Defaults to 'sincePrint' now; see printScope's own comment in
   * radio-log.component.ts for why that one value covers both cases.
   */
  it('defaults the Print 309 scope to "since the last print" (or all, if never printed)', () => {
    expect(component.printScope()).toBe('sincePrint')
  })

  // 2026-10-21, John: newest entry at the top by default, sorted on the real time - the cell
  // text "9-30 ..." would sort after "10-01 ..." as a string.
  it('sorts Reported newest first by default, by time rather than by its text', () => {
    const reported = (component.columnDefs as any[]).find(
      (c) => c.headerName === 'Reported'
    )
    expect(reported.sort).toBe('desc')
    const node = (iso: string) => ({ data: { date: new Date(iso) } })
    expect(
      reported.comparator(
        null,
        null,
        node('2026-09-30T17:16:05'),
        node('2026-10-01T08:00:00')
      )
    ).toBeLessThan(0)
  })

  // 2026-11-12, John: the phone's cards were in stored order (oldest first) while the grid was
  // newest first.
  it('lists the phone cards newest first, without reordering the stored entries', () => {
    const entry = (id: number, iso: string) => ({ id, date: new Date(iso) }) as any
    const stored = [
      entry(1, '2026-09-30T17:16:05'),
      entry(2, '2026-10-01T08:00:00'),
      entry(3, '2026-09-30T09:00:00'),
    ]
    component.radioLogEntries.set(stored)
    expect(component.cardEntries().map((e) => e.id)).toEqual([2, 1, 3])
    expect(stored.map((e) => e.id)).toEqual([1, 2, 3])
  })
})
