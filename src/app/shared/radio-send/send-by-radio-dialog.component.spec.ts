import { provideHttpClient } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog'
import { provideRouter } from '@angular/router'

import { ics213Payload } from '../export/radio-send/mapping'
import { recordStore } from '../storage/record-store'
import { DevicePrefsService } from '../services/device-prefs.service'
import type { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'
import type { MissionType } from '../../domain/model/mission.interface'
import { addressHints, SendByRadioDialogComponent, splitAddresses } from './send-by-radio-dialog.component'

const report = (message: string): RadioLogEntryType => ({
  id: 7, callsign: 'K7ABC', tacticalCall: 'CERT Team 1', location: { lat: 0, lng: 0, address: '', derivedFromAddress: true },
  date: new Date(2026, 10, 12, 9, 5), status: 'Normal', notes: '', generates213: true,
  subject213: 'Trail status', message213: message, recipients213: ['IC'], operator: 'Pat Q',
}) as RadioLogEntryType

describe('SendByRadioDialogComponent (E-307)', () => {
  let fixture: ComponentFixture<SendByRadioDialogComponent>
  let el: HTMLElement
  let entry: RadioLogEntryType
  let downloads: string[]

  async function open(message = 'Trail is clear.') {
    entry = report(message)
    const data = { payload: ics213Payload(entry, { event: 'Drill', mission: 'M' } as MissionType), report: entry }
    TestBed.configureTestingModule({
      imports: [SendByRadioDialogComponent],
      providers: [provideHttpClient(), provideRouter([]), { provide: MatDialogRef, useValue: { close: () => undefined } }, { provide: MAT_DIALOG_DATA, useValue: data }],
    })
    fixture = TestBed.createComponent(SendByRadioDialogComponent)
    el = fixture.nativeElement
    fixture.detectChanges()
    await vi.waitFor(() => expect(fixture.componentInstance.forms()).not.toBeNull())
    fixture.detectChanges()
  }

  const q = (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)

  beforeEach(async () => {
    localStorage.clear()
    await recordStore.resetForTests()
    downloads = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    localStorage.clear()
    await recordStore.resetForTests()
  })

  it('shows the warning, the exact text, its size and the buttons, Load Data first', async () => {
    await open()
    expect(q('radio-warning')!.textContent).toContain('Goes out by radio, unencrypted: no patient names, medical details or personal numbers.')
    expect(q('radio-preview')!.textContent).toContain('Trail is clear.')
    expect(q('radio-size')!.textContent).toMatch(/\d+ bytes: about \d+ seconds? on a slow HF link \(300 bytes a second\), a rough guide/)
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.rt-radio__buttons button')].map(b => b.textContent!.trim())
    expect(buttons[0]).toBe('Save for a Winlink form (Load Data)')
    expect(buttons).toContain('Copy text')
    expect(buttons).toContain('Save for Pat outbox')
    expect(buttons).toContain('Save for FLMSG')
    expect(q('radio-folded')).toBeNull()
  })

  it('says when characters were changed to plain letters', async () => {
    await open('Caf\u00e9 \u2014 done')
    expect(q('radio-folded')!.textContent).toContain('changed to plain letters')
  })

  it('asks for the Winlink callsign once, keeps it on the device, and Pat needs it', async () => {
    await open()
    expect(q('radio-call-prompt')).not.toBeNull()
    expect(q('radio-pat')!.disabled).toBe(true)
    fixture.componentInstance.callDraft.set('k7abc')
    fixture.componentInstance.saveCall()
    fixture.detectChanges()
    expect(new DevicePrefsService().getWinlinkCall()).toBe('K7ABC')
    expect(q('radio-call-prompt')).toBeNull()
    expect(q('radio-pat')!.disabled).toBe(false)
  })

  it('saving the Load Data file stamps "Saved for radio" and says what to do next', async () => {
    await open()
    expect(entry.radioSavedAt).toBeUndefined()
    q('radio-loaddata')!.click()
    fixture.detectChanges()
    expect(downloads).toEqual(['ics213-K7ABC-7.txt'])
    expect(entry.radioSavedAt instanceof Date).toBe(true)
    expect(q('radio-next')!.textContent).toBe('Open the ICS-213 form in Winlink Express or Pat, click Load Data, pick this file, check it, Submit.')
  })

  it('saves an FLMSG file with a note that it is not yet tested', async () => {
    await open()
    q('radio-flmsg')!.click()
    fixture.detectChanges()
    expect(downloads).toEqual(['ics213-K7ABC-7.213'])
    expect(q('radio-flmsg-note')!.textContent).toContain('not yet tested with FLMSG itself')
  })

  it('without the File System Access API a Pat message downloads as a .b2f', async () => {
    await open()
    fixture.componentInstance.callDraft.set('K7ABC')
    fixture.componentInstance.saveCall()
    fixture.componentInstance.to.set('W7EOC')
    await fixture.componentInstance.saveForPat()
    fixture.detectChanges()
    expect(downloads.length).toBe(1)
    expect(downloads[0]).toMatch(/^[A-Z0-9]{12}\.b2f$/)
    expect(q('radio-next')!.textContent).toContain('Pat sends it at its next connect')
  })

  it('hints, never blocks, on address syntax', () => {
    expect(addressHints('W7EOC, bob@example.org')).toEqual(['bob@example.org: an Internet address starts with SMTP: (SMTP:bob@example.org).'])
    expect(addressHints('SMTP:bob@example.org TACT1')).toEqual([])
    expect(splitAddresses('A, B;C  D')).toEqual(['A', 'B', 'C', 'D'])
  })
})
