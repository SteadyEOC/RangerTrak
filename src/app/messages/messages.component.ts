import { Subscription } from 'rxjs'

import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'

import { PageComponent } from '../shared/page/page.component'
import { MATERIAL_IMPORTS } from '../material-imports'
import { formatReportTime } from '../shared'
import { fillIcs213Pdf, ics213FieldsFromReport } from '../shared/export/ics213-pdf'
import {
  RadioLogService, RadioLogEntryType, LogService, MissionService, MissionType
} from '../shared/services'

/**
 * ICS-213 general messages - field reports with "Also generate an ICS-213" checked
 * (`generates213`), scoped 2026-08-27 as part of the ICS-309/213 IA restructuring (see the
 * roadmap's own scoping note for the full reasoning).
 *
 * Deliberately NOT a second AG Grid clone of Radio Log/radio-log.component.ts: a message
 * is opt-in per report, so this list is expected to stay short, and the useful unit here is
 * one whole message read at a time, not a row scanned across columns. List + expanded-detail
 * instead, with a "Print as ICS-213" button wired directly to `fillIcs213Pdf()` (`0.57.0`,
 * E-31/E-41 phase 3) - built the same day as the log-shaping half of that work, but never
 * wired to any UI until now.
 *
 * `RadioLogEntryType` has no Approved-by-Name field today, so that one of the form's eight
 * fillable fields is left blank on the printed PDF rather than invented - `fillIcs213Pdf()`'s
 * own doc comment already states this principle for the Reply block, and it applies just as
 * much to data nobody has actually collected. Subject is filled (report.subject213).
 *
 * Raised live 2026-08-30: this page showed neither Subject nor Operator, and had no way to
 * edit a message at all (the Radio Log grid was the only edit path, for every field except
 * these 213-specific ones - Radio Log has no columns for them). Now shows both, and adds its
 * own edit form (message/subject/recipients/reply-requested) - see onEdit()/onSaveEdit()
 * below for the D-47 tie-in (editable indefinitely, warn once printed, don't touch the
 * original report time).
 */
@Component({
  selector: 'rangertrak-messages',
  standalone: true,
  imports: [CommonModule, FormsModule, PageComponent, ...MATERIAL_IMPORTS],
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MessagesComponent implements OnInit, OnDestroy {
  private id = 'Messages'
  title = 'Messages — ICS-213s'
  pageDescr = 'ICS-213 general messages generated from field reports.'

  messages = signal<RadioLogEntryType[]>([])
  selectedId = signal<number | null>(null)
  printing = signal(false)

  // Edit mode for the currently selected message. Plain signals holding a working copy of
  // the editable fields, not a direct binding to the report - so Cancel can discard without
  // needing to snapshot/restore the original object. Deliberately NOT editable here: `date`
  // (D-47's "no time lock" is a general policy, but the ORIGINAL report time specifically
  // stays out of this form - see onSaveEdit()'s own comment) and recipients213's own
  // checklist UI (Entry's chip-listbox) - a plain comma-separated field mirrors Entry's own
  // "Additional recipients" fallback input rather than rebuilding that listbox here.
  editing = signal(false)
  editMessage = signal('')
  editSubject = signal('')
  editRecipients = signal('')
  editReplyRequested = signal(false)

  private settings: MissionType | undefined
  private missionSubscription!: Subscription
  private radioLogSubscription!: Subscription

  constructor(
    private radioLogService: RadioLogService,
    private missionService: MissionService,
    private log: LogService,
  ) { }

  ngOnInit(): void {
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => { this.settings = newMission },
      error: (e) => this.log.error('Mission subscription got: ' + e, this.id),
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (reports) => {
        const filtered = (reports.logEntries ?? [])
          .filter(r => r.generates213)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        this.messages.set(filtered)
        // Keep the current selection if it still exists (e.g. a live-updating report);
        // otherwise default to the newest message rather than leaving the pane empty.
        if (!filtered.some(r => r.id === this.selectedId())) {
          this.selectedId.set(filtered[0]?.id ?? null)
        }
        this.log.verbose(`Received ${filtered.length} ICS-213 message(s) of ${reports.logEntries?.length ?? 0} reports.`, this.id)
      },
      error: (e) => this.log.error('Field reports subscription got: ' + e, this.id),
    })
  }

  ngOnDestroy(): void {
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
  }

  get selected(): RadioLogEntryType | undefined {
    return this.messages().find(r => r.id === this.selectedId())
  }

  select(report: RadioLogEntryType): void {
    this.selectedId.set(report.id)
    this.editing.set(false)
  }

  formatTime(date: Date | string): string {
    return formatReportTime(date)
  }

  onEdit(): void {
    const report = this.selected
    if (!report) {
      return
    }
    this.editMessage.set(report.message213 ?? '')
    this.editSubject.set(report.subject213 ?? '')
    this.editRecipients.set((report.recipients213 ?? []).join(', '))
    this.editReplyRequested.set(!!report.replyRequested213)
    this.editing.set(true)
  }

  onCancelEdit(): void {
    this.editing.set(false)
  }

  /**
   * D-47 applied directly: no time lock, edits stay possible indefinitely - but a message
   * already printed may already be out the door, so this warns (confirm(), not a block)
   * rather than silently letting a scribe "fix" something that already went out with no
   * record it changed. `revisedAt` is that record - the ADR's own anticipated "visibly
   * edited" half. The report's own `date` (when it was first filed) is never touched here -
   * only the *213 fields this form actually exposes are written.
   */
  onSaveEdit(): void {
    const report = this.selected
    if (!report) {
      return
    }

    if (report.printedAt && !confirm(
      `This message was already printed as an ICS-213 on ${formatReportTime(report.printedAt)}. `
      + `Editing it now will NOT update any copy already printed or sent out. Save the edit anyway?`
    )) {
      return
    }

    report.message213 = this.editMessage().trim()
    report.subject213 = this.editSubject().trim()
    report.recipients213 = this.editRecipients().split(',').map(s => s.trim()).filter(s => s)
    report.replyRequested213 = this.editReplyRequested()
    report.revisedAt = new Date()

    this.radioLogService.saveEditedRadioLog()
    this.log.info(`Edited ICS-213 message on report ${report.id}`, this.id)
    this.editing.set(false)
  }

  async printAsIcs213(): Promise<void> {
    const report = this.selected
    if (!report || this.printing()) {
      return
    }

    this.printing.set(true)
    try {
      const res = await fetch('assets/forms/ics-213.pdf')
      if (!res.ok) {
        throw new Error(`Fetching the ICS-213 template failed: ${res.status}`)
      }
      const templateBytes = new Uint8Array(await res.arrayBuffer())

      // 2026-09-22: the field mapping itself moved to ics213-pdf.ts's own
      // ics213FieldsFromReport() once entry.component.ts's auto-print-on-submit needed the
      // exact same eight fields - see that function's own comment for why a second
      // hand-written copy is exactly how F29-47 (blank Subject/Approved-by-Name for weeks)
      // happened in the first place.
      const filled = await fillIcs213Pdf(templateBytes, ics213FieldsFromReport(report, this.settings))

      // TS's DOM lib types Uint8Array's `.buffer` as ArrayBufferLike (which could in theory
      // be a SharedArrayBuffer), stricter than BlobPart's ArrayBuffer requirement - a real
      // Uint8Array from pdf-lib's own save() is always backed by a plain ArrayBuffer at
      // runtime, so this is a type-only mismatch between library versions, not a real risk.
      const blob = new Blob([filled as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ics-213-${report.callsign || 'message'}-${report.id}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      // First print only - see printedAt's own doc comment (radio-log-entry.interface.ts) for
      // why a reprint doesn't move it.
      if (!report.printedAt) {
        report.printedAt = new Date()
        this.radioLogService.saveEditedRadioLog()
      }
      this.log.info(`Printed ICS-213 for report ${report.id}`, this.id)
    } catch (e) {
      this.log.error(`Failed to fill ICS-213 for report ${report.id}: ${e}`, this.id)
    } finally {
      this.printing.set(false)
    }
  }
}
