import { ComponentFixture, TestBed } from '@angular/core/testing'

import { TimePickerComponent } from './time-picker.component'

describe('TimePickerComponent', () => {
  let component: TimePickerComponent
  let fixture: ComponentFixture<TimePickerComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimePickerComponent],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(TimePickerComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  it('E-71: updates its displayed time when [initialDate] changes after init, not just on first bind', () => {
    const later = new Date('2026-08-20T14:30:00')
    component.initialDate = later
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: later,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    const hourInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--hour'
    )
    const minuteInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--minute'
    )
    // 24-hour display (2026-08-30): 14:30, not 2:30 PM - no AM/PM segment any more.
    expect(hourInput.value).toBe('14')
    expect(minuteInput.value).toBe('30')
  })

  it('segment-aware ▲/▼: steps whichever segment last had focus, not always minutes', () => {
    // 14:30 -> hour segment focused -> step up -> 15:30
    component.initialDate = new Date('2026-08-20T14:30:00')
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    component.onSegmentFocus('hour')
    component.adjustTime(1)
    fixture.detectChanges()

    const hourInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--hour'
    )
    const minuteInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--minute'
    )
    expect(hourInput.value).toBe('15')
    expect(minuteInput.value).toBe('30')
  })

  it('segment-aware ▲/▼: falls back to minute when nothing has been focused yet', () => {
    component.initialDate = new Date('2026-08-20T14:30:00')
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    component.adjustTime(1)
    fixture.detectChanges()

    const minuteInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--minute'
    )
    expect(minuteInput.value).toBe('31')
  })

  it('bug fix 2026-08-31: stepping up through midnight advances the calendar day, not just the displayed time', () => {
    component.initialDate = new Date('2026-08-20T23:30:00')
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    const emitted: Date[] = []
    component.newTimeEvent.subscribe((d) => emitted.push(d))

    component.onSegmentFocus('hour')
    component.adjustTime(1) // 23:30 + 1 hour -> 00:30 the NEXT day, not the same day
    fixture.detectChanges()

    const hourInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--hour'
    )
    expect(hourInput.value).toBe('00')
    expect(emitted[0].getDate()).toBe(21) // was the 20th
  })

  it('bug fix 2026-08-31: stepping down through midnight retreats the calendar day', () => {
    component.initialDate = new Date('2026-08-20T00:15:00')
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    const emitted: Date[] = []
    component.newTimeEvent.subscribe((d) => emitted.push(d))

    component.onSegmentFocus('hour')
    component.adjustTime(-1) // 00:15 - 1 hour -> 23:15 the PREVIOUS day
    fixture.detectChanges()

    const hourInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--hour'
    )
    expect(hourInput.value).toBe('23')
    expect(emitted[0].getDate()).toBe(19) // was the 20th
  })

  it('bug fix 2026-08-31: an arrow-key step after typing (without tabbing away) uses the typed value, not the stale committed one', () => {
    // Reproduces the live report exactly: committed hour was 9; scribe types "23" into the
    // hour segment, then presses ArrowUp WITHOUT blurring first (no (change) ever fires) -
    // must step from 23, not from the still-committed 9 (which gave the reported buggy "10").
    component.initialDate = new Date('2026-08-20T09:00:00')
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    const hourInput: HTMLInputElement = fixture.nativeElement.querySelector(
      '.rt-datetime__seg--hour'
    )
    hourInput.value = '23' // simulates mid-keystroke DOM state - no (change)/(blur) fired
    const event = { target: hourInput, preventDefault: () => {} } as unknown as Event

    component.onSegmentKeyStep(event, 'hour', 1) // ArrowUp
    fixture.detectChanges()

    expect(hourInput.value).toBe('00') // 23 + 1 -> 00 (next day), NOT 9 + 1 -> 10
  })

  it('feature added 2026-08-31: dayOfWeek reflects the current date and updates when it changes', () => {
    component.initialDate = new Date('2026-08-25T09:00:00') // a Tuesday
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    expect(component.dayOfWeek()).toBe('Tues')

    component.initialDate = new Date('2026-08-28T09:00:00') // a Friday
    component.ngOnChanges({
      initialDate: {
        firstChange: false,
        currentValue: component.initialDate,
        previousValue: null,
        isFirstChange: () => false,
      },
    })
    fixture.detectChanges()

    expect(component.dayOfWeek()).toBe('Fri')
  })

  it('does not reapply on the first change - ngOnInit already handled it', () => {
    const initial = component.initialDate
    vi.spyOn(component as any, 'applyInitialDate').mockReturnValue(undefined)
    component.ngOnChanges({
      initialDate: {
        firstChange: true,
        currentValue: initial,
        previousValue: undefined,
        isFirstChange: () => true,
      },
    })

    expect((component as any).applyInitialDate).not.toHaveBeenCalled()
  })
})
