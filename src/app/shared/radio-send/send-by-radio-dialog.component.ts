import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'

import { resolveWinlinkStation } from '../../domain/winlink-station'
import { buildB2f, buildFlmsg, buildSaveData, buildText, transferEstimate, type Forms } from '../export/radio-send/outputs'
import { radioFileStem, type RadioPayload } from '../export/radio-send/mapping'
import { canPickFolder, loadPatFolder, patFolderReady, pickPatFolder, writeIntoFolder, type DirHandle } from '../export/radio-send/pat-folder'
import { DevicePrefsService } from '../services/device-prefs.service'
import { LogService } from '../services/log.service'
import { MissionJournalService } from '../services/mission-journal.service'
import { MissionService } from '../services/mission.service'
import { RadioLogService } from '../services/radio-log.service'
import type { RadioLogEntryType } from '../services/radio-log-entry.interface'

export interface SendByRadioData {
  payload: RadioPayload
  /** The 213 or 213RR's radio log entry: it gets "Saved for radio" stamped. Absent for the 309 and 214. */
  report?: RadioLogEntryType
}

type Route = 'copy' | 'loaddata' | 'pat' | 'flmsg'

/** Light syntax help only; never blocks. Internet addresses need the SMTP: prefix in Winlink. */
export function addressHints(list: string): string[] {
  const hints: string[] = []
  for (const token of list.split(/[,;\s]+/).filter(Boolean)) {
    if (token.includes('@') && !/^SMTP:/i.test(token)) hints.push(`${token}: an Internet address starts with SMTP: (SMTP:${token}).`)
  }
  return hints
}

/** Splits a typed To or Cc box into addresses. */
export function splitAddresses(list: string): string[] {
  return list.split(/[,;\s]+/).filter(Boolean)
}

/**
 * E-307: Send by radio. Shows exactly what will go out, its size, and the ways to get it onto a radio
 * route: Copy text, a Save Data file for a Winlink form's Load Data button, a Pat outbox message, or an
 * FLMSG file. Nothing is sent from here; the app never touches a radio.
 */
@Component({
  selector: 'rangertrak-send-by-radio-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  templateUrl: './send-by-radio-dialog.component.html',
  styleUrls: ['./send-by-radio-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SendByRadioDialogComponent {
  private readonly id = 'Send by radio'
  readonly data = inject<SendByRadioData>(MAT_DIALOG_DATA)
  private readonly dialogRef = inject<MatDialogRef<SendByRadioDialogComponent>>(MatDialogRef)
  private readonly prefs = inject(DevicePrefsService)
  private readonly missionService = inject(MissionService)
  private readonly radioLog = inject(RadioLogService)
  private readonly journal = inject(MissionJournalService)
  private readonly log = inject(LogService)

  readonly payload = this.data.payload
  readonly canPickFolder = canPickFolder()

  private readonly station = resolveWinlinkStation(this.missionService.settings,
    { call: this.prefs.getWinlinkCall(), addresses: this.prefs.getWinlinkAddresses() })
  readonly saved = this.station.addresses
  call = signal(this.station.call)
  callDraft = signal('')
  to = signal('')
  cc = signal('')
  subject = signal(this.payload.subject)

  /** The emcomm-forms writers, loaded when the dialog opens (never in the eager bundle). */
  readonly forms = signal<Forms | null>(null)
  readonly error = signal('')
  /** The short next-steps line shown after a save. */
  readonly nextSteps = signal('')
  readonly patFolder = signal<DirHandle | null>(null)
  readonly patReady = signal(false)
  readonly busy = signal(false)

  private readonly built = computed(() => {
    const forms = this.forms()
    if (!forms) return { out: null, problem: '' }
    try { return { out: buildText(forms, this.payload), problem: '' } } catch (e) { return { out: null, problem: `Could not lay the text out: ${e}` } }
  })
  readonly out = computed(() => this.built().out)
  readonly problem = computed(() => this.error() || this.built().problem)
  readonly text = computed(() => this.out()?.text ?? '')
  readonly sizeLine = computed(() => {
    const o = this.out()
    return o ? `${o.bytes} bytes: ${transferEstimate(o.bytes)} on a slow HF link (300 bytes a second), a rough guide.` : ''
  })
  readonly toHints = computed(() => addressHints(this.to()))
  readonly ccHints = computed(() => addressHints(this.cc()))
  /** Only the 309 and the Winlink/FLMSG choices for it differ; this is the plain-words FLMSG choice. */
  readonly flmsgNote = this.payload.flmsg.note
  readonly hasLoadData = !!this.payload.saveData

  constructor() {
    void import('emcomm-forms').then(f => this.forms.set(f as Forms), e => {
      this.log.error(`Loading the radio writers failed: ${e}`, this.id)
      this.error.set('The radio file writers could not be loaded. Copy text is not available either; try again.')
    })
    void loadPatFolder().then(async h => {
      this.patFolder.set(h)
      this.patReady.set(!!h && await patFolderReady(h, false))
    })
  }

  addSaved(target: 'to' | 'cc', address: string): void {
    if (!address) return
    const sig = target === 'to' ? this.to : this.cc
    const have = splitAddresses(sig())
    if (!have.includes(address)) sig.set([...have, address].join(', '))
  }

  /** Remembers the typed To and Cc addresses on this device, to pick next time. */
  rememberAddresses(): void {
    const known = new Set(this.prefs.getWinlinkAddresses().map(a => a.address))
    const fresh = [...splitAddresses(this.to()), ...splitAddresses(this.cc())].filter(a => !known.has(a))
    if (!fresh.length) return
    this.prefs.setWinlinkAddresses([...this.prefs.getWinlinkAddresses(), ...fresh.map(address => ({ label: address, address }))])
  }

  saveCall(): void {
    const call = this.callDraft().trim().toUpperCase()
    if (!call) return
    this.prefs.setWinlinkCall(call)
    this.call.set(call)
  }

  async pickFolder(): Promise<void> {
    const h = await pickPatFolder()
    if (!h) return
    this.patFolder.set(h)
    this.patReady.set(await patFolderReady(h, true))
  }

  /** One click to allow the remembered folder again (the browser forgets permission between visits). */
  async rearmFolder(): Promise<void> {
    const h = this.patFolder()
    if (h) this.patReady.set(await patFolderReady(h, true))
  }

  private download(name: string, bytes: Uint8Array | string, mime: string): void {
    const blob = new Blob([bytes as BlobPart], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  private stem(): string {
    const r = this.data.report
    return radioFileStem(this.payload, r ? `${r.callsign || ''}-${r.id}` : '')
  }

  /** 213 and 213RR get "Saved for radio" stamped; the 309 and 214 are not stored entries. */
  private markSaved(route: Route): void {
    const r = this.data.report
    if (r) {
      r.radioSavedAt = new Date()
      this.radioLog.saveEditedRadioLog()
    }
    this.journal.record('radio-saved', `${this.payload.formLabel}${r ? ` for report ${r.id}` : ''} prepared for radio (${route}).`)
  }

  async copyText(): Promise<void> {
    this.error.set('')
    try {
      await navigator.clipboard.writeText(this.text())
      this.nextSteps.set('Copied. Paste it into the message in your radio program.')
      this.markSaved('copy')
    } catch {
      this.error.set('The browser would not copy. Select the text above and copy it by hand.')
    }
  }

  saveLoadData(): void {
    this.error.set('')
    const forms = this.forms()
    if (!forms) return
    try {
      const sd = buildSaveData(forms, this.payload)
      if (!sd) return
      this.download(`${this.stem()}.txt`, sd.bytes, 'text/plain')
      this.nextSteps.set(`Open the ${this.payload.formLabel} form in Winlink Express or Pat, click Load Data, pick this file, check it, Submit.`)
      this.markSaved('loaddata')
    } catch (e) {
      this.log.error(`Save Data failed: ${e}`, this.id)
      this.error.set(`The file could not be made: ${e instanceof Error ? e.message : e}`)
    }
  }

  async saveForPat(): Promise<void> {
    this.error.set('')
    const forms = this.forms()
    if (!forms) return
    if (!this.call()) { this.error.set('Set your Winlink callsign first (above).'); return }
    this.busy.set(true)
    try {
      this.rememberAddresses()
      const to = splitAddresses(this.to())
      if (!to.length) { this.error.set('Add at least one To address.'); return }
      const msg = buildB2f(forms, this.payload, { call: this.call(), to, cc: splitAddresses(this.cc()), subject: this.subject(), at: new Date() })
      const folder = this.patFolder()
      if (this.canPickFolder && folder && await patFolderReady(folder, true)) {
        await writeIntoFolder(folder, msg.name, msg.bytes)
        this.patReady.set(true)
        this.nextSteps.set('Saved in your Pat outbox. Pat sends it at its next connect.')
      } else {
        this.download(msg.name, msg.bytes, 'application/octet-stream')
        this.nextSteps.set(this.canPickFolder
          ? 'Downloaded. Choose the Pat outbox folder (button above) and the next one goes straight in. Pat sends it at its next connect.'
          : 'Downloaded. Put the file in the Pat outbox folder. Pat sends it at its next connect.')
      }
      this.markSaved('pat')
    } catch (e) {
      this.log.error(`Pat outbox save failed: ${e}`, this.id)
      this.error.set(`The message could not be saved: ${e instanceof Error ? e.message : e}`)
    } finally {
      this.busy.set(false)
    }
  }

  saveFlmsg(): void {
    this.error.set('')
    const forms = this.forms()
    if (!forms) return
    try {
      const f = buildFlmsg(forms, this.payload, this.call(), new Date())
      this.download(`${this.stem()}${f.ext}`, f.text, 'text/plain;charset=utf-8')
      this.nextSteps.set(`Open FLMSG, use File > Open data file, and pick this ${f.ext} file. These files are new and not yet tested with FLMSG itself.`)
      this.markSaved('flmsg')
    } catch (e) {
      this.log.error(`FLMSG save failed: ${e}`, this.id)
      this.error.set(`The file could not be made: ${e instanceof Error ? e.message : e}`)
    }
  }

  close(): void {
    this.dialogRef.close()
  }
}
