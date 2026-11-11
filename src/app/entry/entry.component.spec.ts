import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'

import { GEOCODING_PROVIDER, NominatimGeocoder } from '../shared'
import { FieldModeService, RadioLogService } from '../shared/services'
import { EntryComponent } from './entry.component'

describe('EntryComponent', () => {
  let component: EntryComponent
  let fixture: ComponentFixture<EntryComponent>

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EntryComponent],
      providers: [
        { provide: GEOCODING_PROVIDER, useValue: new NominatimGeocoder() },
        // HeaderComponent renders MissionReadinessComponent, whose readiness dot is now a
        // routerLink to /settings - needs a Router in every test that mounts the shared
        // page chrome, not just specs that touch routing directly.
        provideRouter([]),
      ],
    }).compileComponents()
  })

  beforeEach(() => {
    fixture = TestBed.createComponent(EntryComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('should create', () => {
    expect(component).toBeTruthy()
  })

  // E-114 §1a/§2b (2026-08-31): GPS auto-fill and the connectivity indicator are field-mode
  // only - a command-post/scribe laptop's own position/connectivity has never mattered to
  // Entry (see tryGpsAutoFill()'s and isOnline's own doc comments in entry.component.ts).
  describe('field mode', () => {
    afterEach(() => {
      localStorage.removeItem('fieldMode')
    })

    it('does not request a GPS fix on a normal (non-field-mode) device', () => {
      const spy = vi
        .spyOn(navigator.geolocation, 'getCurrentPosition')
        .mockReturnValue(undefined)
      const freshFixture = TestBed.createComponent(EntryComponent)
      freshFixture.detectChanges()
      expect(spy).not.toHaveBeenCalled()
    })

    it('requests a GPS fix once on a field-mode device', () => {
      // FieldModeService is providedIn: 'root' - a singleton within this TestBed module, and
      // the outer beforeEach above already constructed EntryComponent (and so its enabled
      // signal) before this test runs. Setting localStorage directly here would arrive too
      // late for that already-initialized signal to see it - enable() updates the SAME live
      // instance EntryComponent already has injected, not just localStorage.
      TestBed.inject(FieldModeService).enable()
      const spy = vi
        .spyOn(navigator.geolocation, 'getCurrentPosition')
        .mockReturnValue(undefined)
      const freshFixture = TestBed.createComponent(EntryComponent)
      freshFixture.detectChanges()
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('shows the connectivity indicator only on a field-mode device', () => {
      TestBed.inject(FieldModeService).enable()
      const freshFixture = TestBed.createComponent(EntryComponent)
      freshFixture.detectChanges()
      const el: HTMLElement =
        freshFixture.nativeElement.querySelector('.entry-connectivity')
      expect(el).toBeTruthy()
    })

    it('hides the connectivity indicator on a normal device', () => {
      const el: HTMLElement = fixture.nativeElement.querySelector('.entry-connectivity')
      expect(el).toBeFalsy()
    })
  })

  // E-114 Phase 1 (2026-08-31): "send my reports" is the one place a field-mode device can
  // reach the identical hand-off RadioLogComponent's own button offers - its route is hidden
  // from field mode (fieldModeGuard). Packet assembly itself is exercised by
  // RadioLogService.buildReportPacketText()'s own spec - these just confirm this button
  // delegates to it and reacts correctly to both outcomes.
  describe('onBtnSendMyReports', () => {
    it('alerts rather than sharing/downloading when there is nothing to send', async () => {
      const radioLog = TestBed.inject(RadioLogService)
      vi.spyOn(radioLog, 'buildReportPacketText').mockReturnValue(null)
      const alertSpy = vi.spyOn(window, 'alert').mockReturnValue(undefined)

      await component.onBtnSendMyReports()

      expect(alertSpy).toHaveBeenCalled()
    })

    it('falls back to a download when Web Share is unavailable', async () => {
      const radioLog = TestBed.inject(RadioLogService)
      vi.spyOn(radioLog, 'buildReportPacketText').mockReturnValue({
        text: '{"entries":[]}',
        filename: 'rangertrak-report-packet-test.txt',
        count: 1,
        uids: [],
      })
      // Forced false regardless of whether this particular Chrome build actually implements
      // Web Share (headless environments vary) - deterministic either way, and exercises the
      // same "unavailable" branch a real desktop Chrome without the API would take.
      if (typeof navigator.canShare === 'function') {
        vi.spyOn(navigator, 'canShare').mockReturnValue(false)
      }
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockReturnValue(undefined)

      await component.onBtnSendMyReports()

      expect(clickSpy).toHaveBeenCalled()
    })
  })

  // E-251/E-253 (2026-11-11, ADR D-69): send only new reports, and edit a not-sent one in this form.
  describe('field phone: send only new, edit before sending', () => {
    const report = (notes: string) => JSON.stringify({
      id: 0, callsign: 'W7ABC', location: { lat: 47.4, lng: -122.4, address: '', derivedFromAddress: false },
      date: new Date(), status: 'Normal', notes,
    })
    let fm: FieldModeService
    let log: RadioLogService
    let phone: ComponentFixture<EntryComponent>
    let phoneEntry: EntryComponent

    beforeEach(async () => {
      localStorage.removeItem('fieldModeReports')
      fm = TestBed.inject(FieldModeService)
      fm.enable()
      log = TestBed.inject(RadioLogService)
      await log.deleteAllRadioLogEntries()   // the log is stored between specs
      phone = TestBed.createComponent(EntryComponent)
      phoneEntry = phone.componentInstance
      phone.detectChanges()
    })

    afterEach(async () => {
      await log.deleteAllRadioLogEntries()
      localStorage.removeItem('fieldMode')
      localStorage.removeItem('fieldModeReports')
    })

    const sendButton = () => phone.nativeElement.querySelector('[data-testid="send-new-reports"]') as HTMLButtonElement

    it('the Send button counts new reports, and reads Nothing new to send (disabled) with none', async () => {
      expect(sendButton().textContent!.trim()).toBe('Nothing new to send')
      expect(sendButton().disabled).toBe(true)
      const a = log.addRadioLogEntry(report('one'))
      phone.detectChanges()
      await phone.whenStable()
      expect(sendButton().textContent!.trim()).toBe('Send 1 new report')
      log.addRadioLogEntry(report('two'))
      phone.detectChanges()
      await phone.whenStable()
      expect(sendButton().textContent!.trim()).toBe('Send 2 new reports')
      fm.markSent([a.uid!], new Date())
      phone.detectChanges()
      await phone.whenStable()
      expect(sendButton().textContent!.trim()).toBe('Send 1 new report')
      expect(phone.nativeElement.querySelector('[data-testid="send-again"]').textContent).toContain('1 not confirmed')
    })

    it('Send sends only the new reports and marks them sent', async () => {
      const a = log.addRadioLogEntry(report('old'))
      fm.markSent([a.uid!], new Date())
      const b = log.addRadioLogEntry(report('new'))
      const build = vi.spyOn(log, 'buildReportPacketText')
      vi.spyOn(log, 'reportPacketMedia').mockResolvedValue([])
      if (typeof navigator.canShare === 'function') vi.spyOn(navigator, 'canShare').mockReturnValue(false)
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined)
      await phoneEntry.onBtnSendMyReports()
      expect(build.mock.calls[0][1]!.map(e => e.uid)).toEqual([b.uid])
      expect(fm.stateOf(b.uid)).toBe('sent')
    })

    it('Edit loads the report, Save changes replaces it, and the unsent new report comes back', () => {
      const first = log.addRadioLogEntry(report('original'))
      phoneEntry.entryForm.notes().value.set('half-typed new report')
      phoneEntry.onEditReport(first)
      expect(phoneEntry.editing()).toBe(first)
      expect(phoneEntry.entryForm.notes().value()).toBe('original')
      expect(phoneEntry.editingLabel()).toMatch(/^Editing report from \d/)

      phoneEntry.entryForm.notes().value.set('corrected')
      phoneEntry.onFormSubmit()

      const stored = log.getCurrentRadioLog().logEntries
      expect(stored.length).toBe(1)
      expect(stored[0].notes).toBe('corrected')
      expect(stored[0].uid).toBe(first.uid)
      expect(stored[0].revisedAt).toBeUndefined()
      expect(phoneEntry.editing()).toBeNull()
      expect(phoneEntry.entryForm.notes().value()).toBe('half-typed new report')
    })

    it('Cancel leaves the report as it was', () => {
      const first = log.addRadioLogEntry(report('original'))
      phoneEntry.onEditReport(first)
      phoneEntry.entryForm.notes().value.set('changed my mind')
      phoneEntry.onCancelEdit()
      expect(log.getCurrentRadioLog().logEntries[0].notes).toBe('original')
      expect(phoneEntry.editing()).toBeNull()
      expect(phoneEntry.entryForm.notes().value()).toBe('')
    })

    it('refuses to edit a report that has been sent', () => {
      const first = log.addRadioLogEntry(report('original'))
      fm.markSent([first.uid!], new Date())
      const alertSpy = vi.spyOn(window, 'alert').mockReturnValue(undefined)
      phoneEntry.onEditReport(first)
      expect(alertSpy).toHaveBeenCalled()
      expect(phoneEntry.editing()).toBeNull()
    })
  })
})
