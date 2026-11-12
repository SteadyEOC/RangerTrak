import { Subscription } from 'rxjs'

import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'

import { PageComponent } from '../shared/page/page.component'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatButtonModule } from '@angular/material/button'
import { MatCardModule } from '@angular/material/card'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { formatReportTime } from '../shared'
import { fillIcs213Pdf, ics213FieldsFromReport } from '../shared/export/ics213-pdf'
import { formatStation } from '../domain/station-label'
import { rr213LineText, rr213PriorityLabel } from '../domain/rr213'
import { formatMsgNoFull, formatMsgNoShort, HANDLED_MARK_GLYPH, HANDLED_MARK_LABEL } from '../domain/msg-no'
// 2026-09-28, John (item 8b): "one click to the print dialog" - the same iframe/print()
// machinery entry.component.ts's auto-print-on-submit already uses (D1, 2026-09-22). Static
// import, not the dynamic one entry.component.ts uses: /messages is already its own lazy
// route (app.routes.ts), so there is no eager-bundle cost to guard against here the way
// there is on Entry.
import { printIcs213 } from '../shared/export/ics213-print'
import { PrintCopiesService } from '../shared/services/print-copies.service'
import { AttachmentChipComponent } from '../shared/attachments/attachment-chip.component'
import { ics213AttachmentsFor } from '../shared/attachments/attachment-print'
import { AttachmentStoreService } from '../shared/services/attachment-store.service'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { AttachmentViewerService } from '../shared/attachments/attachment-viewer.service'
import {
  RadioLogService, RadioLogEntryType, LogService, MissionService, MissionType
} from '../shared/services'
import type { Rr213LineType } from '../shared/services/radio-log-entry.interface'

export type MessageFilter = 'all' | '213' | 'rr'
export type MessageForm = '213' | 'rr'
export type MessageRow = { key: string, report: RadioLogEntryType, form: MessageForm }

/**
 * ICS-213 general messages - radio log entries with "Also generate an ICS-213" checked
 * (`generates213`), scoped 2026-08-27 as part of the ICS-309/213 IA restructuring (see the
 * roadmap's own scoping note for the full reasoning).
 *
 * Deliberately NOT a second AG Grid clone of Radio Log/radio-log.component.ts: a message
 * is opt-in per report, so this list is expected to stay short, and the useful unit here is
 * one whole message read at a time, not a row scanned across columns. List + expanded-detail
 * instead, with "Print"/"Save PDF" buttons wired to `fillIcs213Pdf()` (`0.57.0`, E-31/E-41
 * phase 3) - built the same day as the log-shaping half of that work, but never wired to any
 * UI until now. 2026-09-28: split from one combined "Print as ICS-213" (download-only)
 * button into Print (primary, opens the print dialog - ics213-print.ts) and Save PDF
 * (secondary, the original download) - see printAsIcs213()/saveIcs213Pdf() below.
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
  imports: [CommonModule, FormsModule, PageComponent, AttachmentChipComponent, MatFormFieldModule, MatInputModule, MatButtonModule, MatCardModule, MatCheckboxModule],
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MessagesComponent implements OnInit, OnDestroy {
  private id = 'Messages'
  private attachmentViewer = inject(AttachmentViewerService)
  private attachmentStore = inject(AttachmentStoreService)
  private journal = inject(MissionJournalService)
  title = 'Messages'
  pageDescr = 'ICS-213 general messages and ICS-213RR resource requests generated from radio log entries.'

  messages = signal<RadioLogEntryType[]>([])
  /** E-283: which kind of message to list. */
  filter = signal<MessageFilter>('all')
  /** One row per form: an entry with both a 213 and a 213RR is listed under both. */
  rows = computed<MessageRow[]>(() => {
    const f = this.filter()
    return this.messages().flatMap((report): MessageRow[] => [
      ...(report.generates213 && f !== 'rr' ? [{ key: `${report.id}:213`, report, form: '213' as const }] : []),
      ...(report.rr213 && f !== '213' ? [{ key: `${report.id}:rr`, report, form: 'rr' as const }] : []),
    ])
  })
  selectedKey = signal<string | null>(null)
  printing = signal(false)
  // E-150: copies for the manual Print, pre-filled from the Mission page's extra copies
  // (1 + extra); changing it here never changes the Mission value. Not persisted.
  printCopies = signal(1)

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
    private printCopiesService: PrintCopiesService,
  ) { }

  ngOnInit(): void {
    this.printCopies.set(this.printCopiesService.totalCopies())
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => { this.settings = newMission },
      error: (e) => this.log.error('Mission subscription got: ' + e, this.id),
    })

    this.radioLogSubscription = this.radioLogService.getRadioLogObserver().subscribe({
      next: (reports) => {
        const filtered = (reports.logEntries ?? [])
          .filter(r => r.generates213 || r.rr213)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        this.messages.set(filtered)
        this.ensureSelection()
      },
      error: (e) => this.log.error('Radio log entries subscription got: ' + e, this.id),
    })
  }

  ngOnDestroy(): void {
    this.missionSubscription?.unsubscribe()
    this.radioLogSubscription?.unsubscribe()
  }

  /** Keep the current selection if it still exists (a live-updating report); otherwise the newest row. */
  private ensureSelection(): void {
    const rows = this.rows()
    if (!rows.some(r => r.key === this.selectedKey())) {
      this.selectedKey.set(rows[0]?.key ?? null)
    }
  }

  setFilter(f: MessageFilter): void {
    this.filter.set(f)
    this.editing.set(false)
    this.ensureSelection()
  }

  get selectedRow(): MessageRow | undefined {
    return this.rows().find(r => r.key === this.selectedKey())
  }

  get selected(): RadioLogEntryType | undefined {
    return this.selectedRow?.report
  }

  /** Which form the selected row is: the 213 general message or the 213RR resource request. */
  get selectedForm(): MessageForm {
    return this.selectedRow?.form ?? '213'
  }

  /** E-283: "Urgent: 2 x radio battery +1 more", the list's one-line preview of a request. */
  rrPreview(report: RadioLogEntryType): string {
    const rr = report.rr213
    if (!rr) return ''
    const more = rr.lines.length > 1 ? ` +${rr.lines.length - 1} more` : ''
    return `${rr213PriorityLabel(rr.priority)}: ${rr.lines[0] ? rr213LineText(rr.lines[0]) : ''}${more}`
  }

  rrPriority(report: RadioLogEntryType): string {
    return rr213PriorityLabel(report.rr213?.priority)
  }

  rrLineText(l: Rr213LineType): string {
    return rr213LineText(l)
  }

  onPrintCopiesChanged(value: string | number): void {
    const n = Math.floor(Number(value))
    this.printCopies.set(Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1)
  }

  select(row: MessageRow): void {
    this.selectedKey.set(row.key)
    this.editing.set(false)
  }

  formatTime(date: Date | string): string {
    return formatReportTime(date)
  }

  /** E-220 / D-68: 'A007', beside the time; blank for an entry with no number. */
  msgNoShort(report: RadioLogEntryType): string {
    return formatMsgNoShort(report.msgNo)
  }

  msgNoFull(report: RadioLogEntryType): string {
    return formatMsgNoFull(report.msgNo)
  }

  /** E-218: the status mark's glyph and words; blank when unset. */
  markGlyph(report: RadioLogEntryType): string {
    return report.handled ? HANDLED_MARK_GLYPH[report.handled.mark] : ''
  }

  markLabel(report: RadioLogEntryType): string {
    return report.handled ? HANDLED_MARK_LABEL[report.handled.mark] : ''
  }

  /** E-218: one step round blank, handled, passed on, needs action, blank; saved at once. */
  cycleMark(report: RadioLogEntryType): void {
    this.radioLogService.cycleHandledMark(report)
  }

  /** E-165: From / To station in the shared "CERT Team 1 (K7ABC)" format; blank when none recorded. */
  stationFrom(report: RadioLogEntryType): string {
    return formatStation(report.tacticalCall, report.callsign)
  }

  stationTo(report: RadioLogEntryType): string {
    return formatStation(report.toTactical, report.toCallsign)
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

  /** E-194: opens the attachment viewer for this message's entry (its Add attaches more). */
  onOpenAttachments(report: RadioLogEntryType): void {
    void this.attachmentViewer.open(report.uid)
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

  /**
   * Builds the filled ICS-213 PDF bytes for `report` - the one piece shared by both
   * "Print" and "Save PDF" below. Same eight-field mapping entry.component.ts's
   * auto-print-on-submit uses (ics213FieldsFromReport()), for the reason its own comment
   * gives: a second hand-written copy is exactly how F29-47 (blank Subject/Approved-by-Name
   * for weeks) happened in the first place.
   */
  private async buildIcs213Pdf(report: RadioLogEntryType): Promise<Uint8Array> {
    const res = await fetch('assets/forms/ics-213.pdf')
    if (!res.ok) {
      throw new Error(`Fetching the ICS-213 template failed: ${res.status}`)
    }
    const templateBytes = new Uint8Array(await res.arrayBuffer())
    return fillIcs213Pdf(templateBytes, ics213FieldsFromReport(report, this.settings), true, this.settings?.missionMode === 'exercise',
      await ics213AttachmentsFor(report, this.attachmentStore), report.msgNo, this.settings?.version)
  }

  /**
   * First use only (Print OR Save PDF, whichever happens first) - see printedAt's own doc
   * comment (radio-log-entry.interface.ts): it "answers 'has this gone out at all,' not
   * 'when was it last printed'" - a plain download is just as much "gone out" as an actual
   * print job, so both stamp it, matching the single combined button's behaviour before this
   * split. A reprint/re-save never moves it.
   */
  private markPrintedOnce(report: RadioLogEntryType): void {
    if (report.printedAt) return
    report.printedAt = new Date()
    this.radioLogService.saveEditedRadioLog()
  }

  /**
   * 2026-09-28, John (item 8b): "Print" is now the primary action - one click straight to
   * the print dialog (a hidden iframe + contentWindow.print(), same as entry.component.ts's
   * auto-print - see ics213-print.ts's own doc comment for the Chrome/Firefox fallback it
   * already handles). Was previously the ONLY action, and only ever downloaded a file the
   * scribe then had to find and open themselves before they could actually print it.
   */
  async printAsIcs213(): Promise<void> {
    if (this.selectedForm === 'rr') return this.printAsIcs213Rr()
    const report = this.selected
    if (!report || this.printing()) {
      return
    }

    this.printing.set(true)
    try {
      const filled = await this.buildIcs213Pdf(report)
      const outcome = await printIcs213(filled, `ics-213-${report.callsign || 'message'}-${report.id}.pdf`, this.printCopies(), this.settings)
      this.markPrintedOnce(report)
      this.journal.record('print-213', `ICS-213 for report ${report.id}: ${outcome}.`)
    } catch (e) {
      this.log.error(`Failed to fill ICS-213 for report ${report.id}: ${e}`, this.id)
    } finally {
      this.printing.set(false)
    }
  }

  /**
   * 2026-09-28, John (item 8b): "Save PDF" - secondary action, the exact download-only
   * behaviour "Print as ICS-213" used to be the only option for. Kept for anyone who wants
   * the file itself (attaching it to an email, archiving it) rather than a printer.
   */
  async saveIcs213Pdf(): Promise<void> {
    if (this.selectedForm === 'rr') return this.saveIcs213RrPdf()
    const report = this.selected
    if (!report || this.printing()) {
      return
    }

    this.printing.set(true)
    try {
      const filled = await this.buildIcs213Pdf(report)
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

      this.markPrintedOnce(report)
      this.journal.record('pdf-213-saved', `Saved the ICS-213 PDF for report ${report.id}.`)
    } catch (e) {
      this.log.error(`Failed to fill ICS-213 for report ${report.id}: ${e}`, this.id)
    } finally {
      this.printing.set(false)
    }
  }

  // E-283: ICS-213RR resource requests

  /** The filled 213RR bytes, and the file name (it carries the message number: the request's handle). */
  private async buildIcs213Rr(report: RadioLogEntryType): Promise<{ bytes: Uint8Array, filename: string }> {
    const [{ fillIcs213RrPdf, rr213FieldsFromReport }, res] = await Promise.all([
      import('../shared/export/ics213rr-pdf'),
      fetch('assets/forms/ics-213rr.pdf'),
    ])
    if (!res.ok) {
      throw new Error(`Fetching the ICS-213RR template failed: ${res.status}`)
    }
    const templateBytes = new Uint8Array(await res.arrayBuffer())
    const bytes = await fillIcs213RrPdf(templateBytes, rr213FieldsFromReport(report, this.settings),
      this.settings?.missionMode === 'exercise', await ics213AttachmentsFor(report, this.attachmentStore), report.msgNo, this.settings?.version)
    return { bytes, filename: `ics-213rr-${rr213FileStem(report)}.pdf` }
  }

  async printAsIcs213Rr(): Promise<void> {
    const report = this.selected
    if (!report || this.printing()) return
    this.printing.set(true)
    try {
      const { bytes, filename } = await this.buildIcs213Rr(report)
      const outcome = await printIcs213(bytes, filename, this.printCopies(), this.settings, 'ICS-213RR')
      this.markPrintedOnce(report)
      this.journal.record('print-213', `ICS-213RR for report ${report.id}: ${outcome}.`)
    } catch (e) {
      this.log.error(`Failed to fill ICS-213RR for report ${report.id}: ${e}`, this.id)
    } finally {
      this.printing.set(false)
    }
  }

  async saveIcs213RrPdf(): Promise<void> {
    const report = this.selected
    if (!report || this.printing()) return
    this.printing.set(true)
    try {
      const { bytes, filename } = await this.buildIcs213Rr(report)
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      this.markPrintedOnce(report)
      this.journal.record('pdf-213-saved', `Saved the ICS-213RR PDF for report ${report.id}.`)
    } catch (e) {
      this.log.error(`Failed to fill ICS-213RR for report ${report.id}: ${e}`, this.id)
    } finally {
      this.printing.set(false)
    }
  }
}

/** The file name stem: the message number when there is one (26-0142 / OP 2 / A007 becomes 26-0142-OP-2-A007), else the report id. */
export function rr213FileStem(report: Pick<RadioLogEntryType, 'msgNo' | 'id' | 'callsign'>): string {
  const no = formatMsgNoFull(report.msgNo)
  const raw = no || `${report.callsign || 'request'}-${report.id}`
  return raw.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}
