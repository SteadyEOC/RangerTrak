import { FormsModule } from '@angular/forms'
import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { FieldTree } from '@angular/forms/signals'

import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDialog } from '@angular/material/dialog'
import { ExpandableSectionComponent } from '../../../shared/expandable-section/expandable-section.component'
import {
  AarNoteService, BackupService, FieldModeService, LogService, MissionExport, MissionJournalService, MissionLocationService, MissionType,
  RadioLogService, RangerPhotoService, RangerService, StoragePersistenceService
} from '../../../shared/services/'
import { DemoPickerComponent } from '../../../shared/demo-picker/demo-picker.component'
import { SetupFileComponent } from '../setup-file/setup-file.component'
import { ImportSafetyCardComponent } from '../../../shared/import-safety/import-safety-card.component'
import { promptAndBackUpMission } from '../../../shared/export/backup-prompts'
// E-122 Phase 2b: the DI wrapper, not the module-level singleton - see record-store.ts's own
// comment on why this is the one Angular consumer that reaches encryption this way.
import { AttachmentBudgetService } from '../../../shared/attachments/attachment-budget.service'
import { AttachmentStoreService } from '../../../shared/services/attachment-store.service'
import { ImportSafetyService } from '../../../shared/services/import-safety.service'
import { compareForRestore } from '../../../domain/restore-preview'
import type { RestoreSide } from '../../../domain/restore-preview'
import type { RestorePreviewDialogData } from '../restore-preview-dialog/restore-preview-dialog.component'
import type { RadioLogEntryType } from '../../../shared/services/radio-log-entry.interface'
import { RecordStore } from '../../../shared/storage/record-store'
import { ViewService } from '../../../shared/services/view.service'
import { AdvancedDirective } from '../../../shared/view/advanced.directive'

/** Enable requires a backup finished within this long - see BackupService.lastBackupCompletedAt. */
const FRESH_BACKUP_WINDOW_MS = 10 * 60 * 1000

/**
 * Data safety (Storage Protection, Mission Backup) and the page's Danger Zone (reset
 * settings, Mission Restore, load sample data - all of which replace data already on the
 * device).
 *
 * Material-M3 pass 2026-08-25 split those two apart: they were one undifferentiated
 * "Advanced Options" block, so an unrecoverable "replaces everything on this device" import
 * looked exactly like the reversible export beside it. Sprint C split out of the 429-line mission.component template - see
 * mission.component.ts for the rest.
 *
 * The Font Explorium (a dev-time typography-comparison tool, not something a scribe in the
 * field has any reason to see) used to live here too - extracted 2026-08-20 to a standalone
 * font-explorium.html in the parent directory, outside the app entirely.
 *
 * Injects its own services directly (all `providedIn: 'root'`) rather than threading them
 * down as Inputs, since none of this section's actions need to hand anything back to the
 * parent except "reset defaults", which does affect sibling sections' displayed `settings`
 * and stays owned there.
 */
@Component({
  selector: 'rangertrak-mission-advanced-options',
  standalone: true,
  imports: [CommonModule, FormsModule, DemoPickerComponent, SetupFileComponent, ImportSafetyCardComponent, ExpandableSectionComponent, MatIconModule, MatButtonModule, MatCardModule, MatCheckboxModule, AdvancedDirective],
  templateUrl: './mission-advanced-options.component.html',
  styleUrls: ['./mission-advanced-options.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionAdvancedOptionsComponent {
  private id = 'Mission Advanced Options Component'

  // E-168 follow-up (2026-10-05, John): the Mode card's and header panel's "Demo" choice now
  // brings the scribe here (/mission#demo) instead of only explaining the way. Opens the Danger
  // zone and puts focus on the demo picker; the picker's own confirm still guards the load.
  // Also fires when already on /mission (the Mode card's own Demo button): same component,
  // new fragment.
  private host = inject(ElementRef<HTMLElement>)
  readonly openForDemo = signal(false)
  /** E-207 / D-62: /prep and #setup-file links show the Setup file even in Simple view. */
  readonly setupFileAsked = signal(false)
  private fragmentSub = inject(ActivatedRoute).fragment
    .pipe(takeUntilDestroyed())
    .subscribe(f => {
      if (f === 'setup-file') this.setupFileAsked.set(true)
      if (f !== 'demo') return
      this.openForDemo.set(true)
      // After the expansion panel has opened, so the picker has a size to scroll to.
      setTimeout(() => {
        const picker = this.host.nativeElement.querySelector('rangertrak-demo-picker') as HTMLElement | null
        picker?.scrollIntoView({ block: 'center' })
        ;(picker?.querySelector('mat-select') as HTMLElement | null)?.focus()
      }, 300)
    })

  // E-258 (2026-10-28): the Debug mode checkbox is gone; `form` stays for the other blocks.
  // 2026-09-28, John: the "Debug mode" checkbox moved here from mission.component.html (see
  // this component's own doc comment on the new Advanced card) - it needs the same settings
  // FieldTree every other section already takes as `[form]`, for the exact same reason
  // mission.component.html's own comment on the checkbox gives: Signal Forms' [formField]
  // cannot drive a Material checkbox (angular/components#32072), so this reads/writes the
  // field's WritableSignal directly instead.
  @Input({ required: true }) form!: FieldTree<MissionType>

  @Output() resetDefaults = new EventEmitter<void>()

  constructor(
    private backupService: BackupService,
    public storagePersistence: StoragePersistenceService,
    public view: ViewService,
    private recordStore: RecordStore,
    private rangerPhotoService: RangerPhotoService,
    private attachmentStore: AttachmentStoreService,
    public attachmentBudget: AttachmentBudgetService,
    private rangerService: RangerService,
    private radioLogService: RadioLogService,
    private fieldMode: FieldModeService,
    private importSafety: ImportSafetyService,
    private locationService: MissionLocationService,
    private aarNoteService: AarNoteService,
    private journal: MissionJournalService,
    private dialog: MatDialog,
    private log: LogService) { }

  // ── E-114 §1a: field phone, from a laptop/desktop ──────────────────────
  // 2026-09-29, John: the Entry welcome panel now asks "Is this a ranger's own field phone?"
  // only on touch-first devices (pointer: coarse) - a laptop has no real GPS and no phone
  // share sheet, so the question just invites a wrong answer there. This keeps the
  // capability reachable anyway (e.g. to try field mode at a desk before a drill).

  /**
   * Same "genuinely untouched install" test as EntryComponent.canLoadDemoData(): field mode
   * hides the roster, map and Mission pages, so it is only offered where there is nothing to
   * hide - never on a working command post. (The exit, since E-142, is Help >
   * HelpStartComponent.onTurnOffFieldMode().)
   */
  isBrandNewDevice(): boolean {
    return this.rangerService.rangers.length === 0
      && this.radioLogService.getCurrentRadioLog().numReport === 0
      && !this.form.mission().value().trim()
  }

  onBtnUseAsFieldPhone(): void {
    if (!this.isBrandNewDevice()) return
    if (!confirm(`Use this device as a ranger's field phone?\n\n`
      + `Only Radio Log Entry and Help stay on the menu. The roster, map, radio log and this `
      + `Mission page are hidden.\n\n`
      + `To turn it off again, use "Turn off field mode" in Help.`)) {
      this.log.verbose('onBtnUseAsFieldPhone: user cancelled.', this.id)
      return
    }
    this.fieldMode.enable()
    // Reloads for the same reason EntryComponent.onEnableFieldMode() does - see its comment.
    window.location.reload()
  }

  /** E-194: the mission's attachment budget, in MB. Saved with the mission settings. */
  setAttachmentBudget(value: number | string): void {
    const mb = Math.round(Number(value))
    if (Number.isFinite(mb) && mb >= 1) this.form.attachmentBudgetMB().value.set(Math.min(mb, 1_000_000))
  }

  onBtnRequestPersistence() {
    this.log.info('Asked the browser again to keep this device\'s data (persistent storage).', this.id)
    this.storagePersistence.requestPersistence()
  }

  // ── E-122 Phase 2b: device encryption ──────────────────────────────────

  /** Whether this device currently encrypts the roster and radio log entries at rest. */
  encryptionEnabled(): boolean {
    return this.recordStore.isEncryptionEnabled()
  }

  /**
   * Whether "Enable encryption" is allowed to run right now: a backup (plain or
   * passphrase-protected - either counts, per the maintainer's 2026-09-26 decision) must have
   * finished in THIS session within the last ~10 minutes. Enabling without one risks a typo'd
   * passphrase destroying the only copy of the mission with nothing to fall back to.
   */
  hasFreshBackup(): boolean {
    const at = this.backupService.lastBackupCompletedAt()
    return at !== null && (Date.now() - at) <= FRESH_BACKUP_WINDOW_MS
  }

  /**
   * Mission > Data safety's "Enable device encryption". Gates on a fresh backup, then asks for
   * the passphrase twice with a plain-words warning that losing it loses the data for good -
   * same pattern as onBtnExportMission()'s passphrase prompt, for the same reason: a typo here
   * is not discovered until the day someone needs the data back.
   */
  async onBtnEnableEncryption(): Promise<void> {
    if (this.encryptionEnabled()) return

    if (!this.hasFreshBackup()) {
      alert(`Back up this mission first.\n\n`
        + `Enabling encryption needs a backup finished in the last 10 minutes (plain or `
        + `passphrase-protected, either works) - otherwise a mistyped passphrase could `
        + `destroy the only copy of this mission with nothing to restore from.\n\n`
        + `Use "Back up mission" above, then try this again.`)
      this.log.verbose('onBtnEnableEncryption: no fresh backup this session.', this.id)
      return
    }

    if (!confirm(`Turn on device encryption?\n\n`
      + `This encrypts the roster, radio log entries, after-action notes and ranger photos stored on THIS device. `
      + `You will set a passphrase next.\n\n`
      + `If you forget it, this data is gone for good - there is no reset, no support `
      + `address, and no way to recover it. It only protects a lost or stolen device or a `
      + `shared browser; it does nothing while the app is open and unlocked, same as any lock `
      + `screen.`)) {
      this.log.verbose('onBtnEnableEncryption: user cancelled.', this.id)
      return
    }

    const passphrase = prompt('Choose a passphrase for this device.\n\n'
      + 'Write it down somewhere safe outside this app - there is no hint and no recovery.')
    if (!passphrase) {
      this.log.verbose('onBtnEnableEncryption: cancelled at the passphrase prompt.', this.id)
      return
    }
    if (prompt('Type the same passphrase again to confirm it.') !== passphrase) {
      alert('Those did not match. Encryption was not turned on - start again.')
      this.log.warn('Encryption was not turned on: the two passphrases did not match.', this.id)
      return
    }

    // A record that failed to re-encrypt can still leave encryption ON (the marker is down
    // first), so collect errors and carry on to the photos rather than skipping them; only a
    // failure that left encryption OFF means nothing happened.
    const errors: string[] = []
    try {
      await this.recordStore.enableEncryption(passphrase)
    } catch (error: any) {
      if (!this.encryptionEnabled()) {
        this.log.error(`onBtnEnableEncryption: failed: ${error.message}`, this.id)
        alert(`Could not turn on encryption: ${error.message}`)
        return
      }
      errors.push(error.message)
    }
    try {
      const key = this.recordStore.getEncryptionKey()
      if (key) await this.rangerPhotoService.encryptAll(key)
    } catch (error: any) {
      errors.push(error.message)
    }
    // E-194: attachments are the third encrypted store, after the photos.
    try {
      const key = this.recordStore.getEncryptionKey()
      if (key) await this.attachmentStore.encryptAll(key)
    } catch (error: any) {
      errors.push(error.message)
    }

    if (errors.length) {
      this.log.error(`onBtnEnableEncryption: on, with errors: ${errors.join(' | ')}`, this.id)
      alert(`Device encryption is on, but not everything was encrypted yet:\n\n${errors.join('\n\n')}`)
      return
    }
    this.journal.record('encryption-on', 'Turned device encryption on: roster, radio log entries, photos and attachments are now encrypted at rest.')
    alert('Device encryption is on. You will be asked for this passphrase on your next visit '
      + 'and after every app update.')
  }

  /**
   * Mission > Data safety's "Disable device encryption". Asks for the passphrase to verify it
   * (rather than trusting the already-unlocked session key), matching the spirit of every
   * other destructive/security-sensitive action on this page confirming explicitly first.
   */
  async onBtnDisableEncryption(): Promise<void> {
    if (!this.encryptionEnabled()) return

    if (!confirm(`Turn off device encryption?\n\n`
      + `The roster, radio log entries, after-action notes, ranger photos and attachments on this device go back to being stored `
      + `unencrypted, exactly as before.`)) {
      this.log.verbose('onBtnDisableEncryption: user cancelled.', this.id)
      return
    }

    const passphrase = prompt('Enter this device\'s passphrase to confirm.')
    if (passphrase === null) {
      this.log.verbose('onBtnDisableEncryption: cancelled at the passphrase prompt.', this.id)
      return
    }

    const key = await this.recordStore.verifyPassphrase(passphrase)
    if (!key) {
      alert('Wrong passphrase. Encryption was not turned off.')
      this.log.warn('Encryption was not turned off: wrong passphrase.', this.id)
      return
    }

    try {
      // Photos first: decryptAll() needs to read their still-encrypted bytes back out of
      // IndexedDB, which only works while RecordStore still reports a key - see
      // RangerPhotoService.decryptAll()'s own comment on why the order matters here.
      await this.rangerPhotoService.decryptAll(key)
      // E-194: attachments the same way, for the same reason, before the key is cleared.
      await this.attachmentStore.decryptAll(key)
      await this.recordStore.disableEncryption()
      this.journal.record('encryption-off', 'Turned device encryption off: roster, radio log entries, photos and attachments are stored unencrypted again.')
      alert('Device encryption is off.')
    } catch (error: any) {
      this.log.error(`onBtnDisableEncryption: failed: ${error.message}`, this.id)
      alert(`Could not turn off encryption: ${error.message}`)
    }
  }

  /**
   * Downloads the current mission (settings + rangers + radio log entries) as a
   * single JSON file. See PRIVATE-Roadmap.md Section 8/R3.
   */
  onBtnExportMission() {
    // The questions (roster warning, optional passphrase typed twice) are shared with the Undo
    // card's "Back up first": see promptAndBackUpMission().
    void promptAndBackUpMission(this.backupService, this.log, this.id)
  }

  /** The Restore preview dialog (E-198): true only when the person chose Restore. */
  private async confirmRestore(fileName: string, payload: MissionExport, attachmentNote: string): Promise<boolean> {
    const device: RestoreSide = {
      mission: this.form.mission().value(),
      exportedAt: '',
      appVersion: this.backupService.appVersion(),
      entries: this.radioLogService.getCurrentRadioLog().logEntries,
      rangers: this.rangerService.rangers.length,
      places: this.locationService.getCurrentLocations().length,
      // E-04 / D-63: debrief notes and 214 lines are counted apart; a 214 line is never an AAR note.
      aarNotes: this.aarNoteService.getCurrentNotes().filter(n => n.kind !== 'activity').length,
      activityLines: this.aarNoteService.getCurrentNotes().filter(n => n.kind === 'activity').length,
      photos: this.rangerPhotoService.count(),
      journal: this.journal.entries().length,
    }
    const file: RestoreSide = {
      mission: payload.settings.mission,
      exportedAt: payload.exportedAt,
      appVersion: payload.appVersion,
      entries: payload.radioLog.logEntries,
      rangers: payload.rangers.length,
      places: (payload.locations ?? []).length,
      aarNotes: (payload.aarNotes ?? []).filter(n => n?.kind !== 'activity').length,
      activityLines: (payload.aarNotes ?? []).filter(n => n?.kind === 'activity').length,
      photos: payload.photos ? payload.photos.length : null,
      journal: payload.journal ? payload.journal.count : null,
    }
    const preview = compareForRestore(device, file, device.appVersion)
    const { RestorePreviewDialogComponent } = await import('../restore-preview-dialog/restore-preview-dialog.component')
    const ref = this.dialog.open(RestorePreviewDialogComponent, {
      width: '44rem', maxWidth: '95vw',
      data: { fileName, preview, attachmentNote } satisfies RestorePreviewDialogData,
    })
    return (await new Promise<boolean | undefined>(resolve => ref.afterClosed().subscribe(r => resolve(r)))) === true
  }

  /**
   * Handles a file picked via the "Restore mission" <input type="file">.
   * Destructive - replaces current settings/rangers/radio log entries entirely -
   * so this confirms with the user before applying.
   */
  async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = '' // allow re-selecting the same file later

    if (!files.length) {
      return
    }

    // E-194 / D-60 item 6: one picker takes the backup JSON, its attachments companion zip, or
    // both. The zip alone adds bytes for references already on this device.
    let backupFile: File | undefined
    let attachmentsFile: File | undefined
    try {
      for (const f of files) {
        if (await this.backupService.classifyRestoreFile(f) === 'attachments') attachmentsFile ??= f
        else backupFile ??= f
      }
    } catch (error: any) {
      alert(`Could not read the files you picked: ${error.message}`)
      return
    }

    // One passphrase covers both files: whatever was typed for the backup is offered to the zip.
    let typedPassphrase: string | null = null
    const askFor = (file: File, what: string) => (hint?: { exportedAt?: string, appVersion?: string }) => {
      if (typedPassphrase !== null) return typedPassphrase
      const answer = prompt(
        `"${file.name}" is encrypted.\n\n`
        + (hint?.exportedAt ? `Backed up ${hint.exportedAt}` : 'Backed up on an unknown date')
        + (hint?.appVersion ? ` by RangerTrak ${hint.appVersion}` : '') + `.\n\n`
        + `Enter its passphrase to restore ${what}.`)
      if (answer !== null) typedPassphrase = answer
      return answer
    }

    try {
      let restoredMission = false
      let safetyCopy: 'kept' | 'skipped' | 'cancelled' = 'skipped'
      if (backupFile) {
        const payload = await this.backupService.readFileAsMissionExport(backupFile, askFor(backupFile, 'it'))
        const attachmentNote = await this.attachmentStore.deletionNotice(
          payload.radioLog.logEntries as RadioLogEntryType[], { keptForSafetyCopy: true })
        // E-198: the device and the file side by side, before anything is replaced. Cancel is the default.
        if (!(await this.confirmRestore(backupFile.name, payload, attachmentNote))) {
          this.log.verbose('onImportFileSelected: user cancelled restore.', this.id)
          return
        }

        // E-198: the device as it is now, kept for 24 hours, before anything is replaced.
        safetyCopy = await this.importSafety.ensureBeforeImport('restore', backupFile.name)
        if (safetyCopy === 'cancelled') {
          this.log.verbose('onImportFileSelected: no safety copy and the user chose not to continue.', this.id)
          return
        }

        // E-122 Phase 2a: awaited now - importMission() only resolves once rangers/radioLog/
        // locations have actually committed to IndexedDB (RecordStore.flush()), which the
        // reload() right below depends on. See importMission()'s own doc comment.
        await this.backupService.importMission(payload)
        if (safetyCopy === 'kept') await this.importSafety.markImportDone()
        this.journal.record('mission-restored',
          `Restored the mission from ${backupFile.name}. The backup's journal: ${this.backupService.describeBackupJournal(payload)}.`)
        await this.recordStore.flush() // stored before the reload below
        restoredMission = true
      }

      // After the entries are in, so the bytes find the references they belong to.
      let attachmentsLine = ''
      if (attachmentsFile) {
        const result = await this.backupService.restoreAttachmentsFile(attachmentsFile, askFor(attachmentsFile, 'its attachments'))
        attachmentsLine = this.backupService.describeAttachmentsRestore(result)
      } else if (restoredMission) {
        // A backup alone: say how many references are still waiting for their bytes.
        attachmentsLine = this.backupService.describeAttachmentsRestore(await this.backupService.attachmentsStatus())
      }

      if (restoredMission) {
        alert(`Mission restored.${attachmentsLine ? ' ' + attachmentsLine : ''}`
          + `${safetyCopy === 'kept' ? ' Undo is in Mission > Data safety for 24 hours.' : ''} `
          + `Reloading to refresh every screen with the new data...`)
        window.location.reload()
      } else {
        alert(attachmentsLine || 'Nothing in that file belongs to an attachment on this device.')
      }
    } catch (error: any) {
      const name = (backupFile ?? attachmentsFile)?.name ?? ''
      this.log.error(`onImportFileSelected: failed to restore: ${error.message}`, this.id)
      alert(`Could not restore "${name}": ${error.message}`)
    }
  }
}
