import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { provideSwUpdateStub } from '../../testing/sw-update.stub'
import { MissionComponent } from './mission.component'

describe('MissionComponent', () => {
  let component: MissionComponent
  let fixture: ComponentFixture<MissionComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MissionComponent],
      providers: [
        // E-55: Settings now renders InstallUpdateComponent, which injects UpdateService,
        // which needs SwUpdate present even though it stays disabled here (same reasoning
        // as footer.component.spec.ts).
        provideSwUpdateStub(),
        // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
        // routerLink to /settings - needs a Router in every test that mounts the shared
        // page chrome, not just specs that touch routing directly.
        provideRouter([]),
      ],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(MissionComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  describe('Operational Period clamping (E-71)', () => {
    it('re-derives the end as start + 12h when the start moves past it', () => {
      // Establish a known baseline first - MissionService's real, un-mocked default
      // opPeriodStart is "now", so asserting against a hardcoded end time without first
      // pinning the start left this test dependent on wall-clock time at run time.
      component.onNewTimeEventStart(new Date('2026-08-20T09:00:00'))
      component.onNewTimeEventEnd(new Date('2026-08-20T12:00:00'))

      const laterStart = new Date('2026-08-20T14:00:00')
      component.onNewTimeEventStart(laterStart)

      // Revised 2026-08-31: was `toEqual(laterStart)` - a zero-length op period. Now the
      // same 12 hours a new mission is seeded with, which the operator can then adjust.
      expect(component.opPeriodEnd()).toEqual(new Date('2026-08-21T02:00:00'))
    })

    it('rolls the re-derived end into the next day when start + 12h crosses midnight', () => {
      component.onNewTimeEventStart(new Date('2026-08-20T09:00:00'))
      component.onNewTimeEventEnd(new Date('2026-08-20T12:00:00'))

      component.onNewTimeEventStart(new Date('2026-08-20T20:00:00'))

      const end = component.opPeriodEnd()
      expect(end.getDate()).toBe(21)
      expect(end.getHours()).toBe(8)
    })

    it('never leaves a zero-length period when the start is moved onto the end exactly', () => {
      component.onNewTimeEventStart(new Date('2026-08-20T09:00:00'))
      component.onNewTimeEventEnd(new Date('2026-08-20T12:00:00'))

      // Moving the start exactly ONTO the end is the `>` vs `>=` case from the other
      // direction. Until 2026-08-31 the end stood and the period collapsed to zero length.
      component.onNewTimeEventStart(new Date('2026-08-20T12:00:00'))

      expect(component.opPeriodEnd()).toEqual(new Date('2026-08-21T00:00:00'))
    })

    it('leaves a positive-length period after any single edit, from either picker', () => {
      // The invariant itself, asserted directly rather than via specific times - a future
      // change to the re-derivation rule should keep this green.
      const edits: Array<() => void> = [
        () => component.onNewTimeEventStart(new Date('2026-08-20T09:00:00')),
        () => component.onNewTimeEventEnd(new Date('2026-08-20T09:00:00')), // equal
        () => component.onNewTimeEventEnd(new Date('2026-08-19T09:00:00')), // earlier
        () => component.onNewTimeEventStart(new Date('2026-08-25T09:00:00')), // past the end
        () => component.onNewTimeEventStart(new Date('2026-08-25T09:00:00')), // onto the end
      ]

      for (const edit of edits) {
        edit()
        expect(component.opPeriodEnd().getTime()).toBeGreaterThan(
          component.opPeriodStart().getTime()
        )
      }
    })

    it('re-derives the end as start + 12h when it is set earlier than start', () => {
      const start = new Date('2026-08-20T10:00:00')
      component.onNewTimeEventStart(start)

      component.onNewTimeEventEnd(new Date('2026-08-20T08:00:00'))

      // Was `toEqual(start)` until 2026-08-31 - snapping to the start was itself the
      // zero-length period the invariant now forbids.
      expect(component.opPeriodEnd()).toEqual(new Date('2026-08-20T22:00:00'))
    })

    it('re-derives the end when it is set EXACTLY equal to the start', () => {
      const start = new Date('2026-08-20T10:00:00')
      component.onNewTimeEventStart(start)

      component.onNewTimeEventEnd(new Date('2026-08-20T10:00:00'))

      // The `>` vs `>=` case: equal is a violation, not an acceptable resting state.
      expect(component.opPeriodEnd()).toEqual(new Date('2026-08-20T22:00:00'))
    })

    it('leaves the end time alone when it is already after the new start', () => {
      // Same reasoning as the test above - pin a known start before setting the end, so
      // the end isn't clamped against MissionService's real "now" default first.
      component.onNewTimeEventStart(new Date('2026-08-20T06:00:00'))
      const end = new Date('2026-08-20T12:00:00')
      component.onNewTimeEventEnd(end)

      component.onNewTimeEventStart(new Date('2026-08-20T09:00:00'))

      expect(component.opPeriodEnd()).toEqual(end)
    })

    /**
     * End-to-end regression, 2026-08-31. The three tests above prove this component's OWN
     * clamp logic is correct - and always was; they were green before this session touched
     * anything. What was actually broken, per a live report ("changing the start doesn't
     * clamp the end, and vice versa"), was upstream: TimePickerComponent's arrow-key stepper
     * had a stale-value bug (fixed the same session, time-picker.component.ts's
     * flushTypedValue()) that could emit the WRONG newTime to onNewTimeEventStart/End in the
     * first place - the clamp logic then correctly clamped against bad input, which looks
     * identical to "doesn't clamp" from the outside. This test goes through the REAL
     * `<rangertrak-time-picker>` DOM (not a direct method call, unlike the three tests above)
     * to prove the fix actually closes that loop, not just that each half works in isolation.
     */
    it('a type-then-arrow-key edit on the START picker (the exact live repro) still clamps the end correctly', () => {
      component.onNewTimeEventStart(new Date('2026-08-20T09:00:00'))
      component.onNewTimeEventEnd(new Date('2026-08-20T12:00:00'))
      fixture.detectChanges()

      // Scope to the "Starts" row specifically - both pickers render the same
      // .rt-datetime__seg--hour class. mission-details-section.component.html renders
      // .mission__period Starts first, Ends second.
      const startPeriod = fixture.nativeElement.querySelectorAll('.mission__period')[0]
      const startHour: HTMLInputElement = startPeriod.querySelector(
        '.rt-datetime__seg--hour'
      )
      expect(startHour.value).toBe('09') // sanity check before the edit

      // Type "14" into the start hour segment, then press ArrowUp WITHOUT blurring - the
      // exact sequence the live report described ("setting hour to 23 then pressing +1").
      startHour.value = '14'
      startHour.dispatchEvent(new Event('input'))
      startHour.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
      )
      fixture.detectChanges()

      // 14 + 1 = 15, which is past the 12:00 end - before the fix, the stale-value bug would
      // have stepped from the still-committed 9 (giving 10, itself the reported symptom),
      // which is NOT past end, so the clamp below would never have fired at all.
      expect(startHour.value).toBe('15')
      // 15:00 start, end was 12:00 and therefore in the past, so it is re-derived as
      // 15:00 + 12h = 03:00 the NEXT day (was 15:00 before the 2026-08-31 revision).
      const end = component.opPeriodEnd()
      expect(end.getHours()).toBe(3)
      expect(end.getDate()).toBe(21)
    })
  })
})
