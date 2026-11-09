import { MasonryDirective } from '../shared/layout/masonry.directive'
import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router, RouterLink } from '@angular/router'
import { MatDialog } from '@angular/material/dialog'

import { PageComponent } from '../shared/page/page.component'
import { MissionJournalService } from '../shared/services/mission-journal.service'
import { PrintBrandComponent } from '../shared/print-brand/print-brand.component'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatButtonToggleModule } from '@angular/material/button-toggle'
import { MatCardModule } from '@angular/material/card'
import { MatSelectModule } from '@angular/material/select'
import { activityLines } from '../domain/activity-log'
import { noteTime } from '../domain/aar-note-migration'
import {
  AAR_NOTE_ABOUT_LABELS, AarNoteAbout, AarNoteService, AarNoteType, FieldModeService, LogService, MissionService
} from '../shared/services'
import { AAR_CAPABILITIES, AAR_CAPABILITY_LABELS } from '../shared/services/aar-note.interface'
import { showFirstPrintTip } from '../shared/export/print-tip'
import { armPrintTitle } from '../shared/export/print-title'
import { csvCell, downloadCsv } from '../shared/export/csv'
import { localDateStamp } from '../shared/export/local-date'

type Filter = 'all' | AarNoteAbout

/**
 * E-116: review the After Action notes captured from the header's "AAR note" button - the
 * hotwash half of the feature. Each note is edited in place (text, about, area, recommendation,
 * owner) and saved on change. Output: a printed improvement-plan table of the incident notes,
 * a CSV of everything, and - for notes about RangerTrak itself - a hand-off to Help > Feedback
 * with the text filled in, which the user reviews and sends (never automatic).
 *
 * E-04 / D-63: the same page also holds the ICS-214 activity log (notes of kind `activity`): a
 * list sorted by time, edit time and text, delete, and Export ICS-214. The AAR list, CSV, print
 * and counts show only kind `aar`; a 214 line is never an AAR note.
 *
 * Not behind fieldModeGuard, unlike the other working pages: a field-mode phone can capture
 * notes from the header, so it has to be able to review them too.
 */
@Component({
  selector: 'rangertrak-after-action',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageComponent, MatFormFieldModule, MatInputModule, MatIconModule, MatButtonModule, MatButtonToggleModule, MatCardModule, MatSelectModule, MasonryDirective, PrintBrandComponent],
  templateUrl: './after-action.component.html',
  styleUrls: ['./after-action.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class AfterActionComponent {
  private id = 'After Action'
  // 2026-09-27: page title only - the nav item that used to sit next to this on the menu is
  // gone (see navbar.component.html), and "AAR notes" is the one name for this page now,
  // matching the header's own "AAR note" capture button. `id` above is a log label, not
  // user-visible text, so it stays as-is.
  title = 'AAR notes'
  pageDescr = 'Notes to fix or improve later, gathered during the mission for the after-action review.'

  readonly aboutLabels = AAR_NOTE_ABOUT_LABELS
  /** HSEEP's Capability Elements (POETE) for the optional pick-list on each note. */
  readonly capabilities = AAR_CAPABILITIES
  readonly capabilityLabels = AAR_CAPABILITY_LABELS
  filter = signal<Filter>('all')

  /** E-04 / D-63: debrief notes only, in capture order. The ICS-214 lines are `lines()` below. */
  readonly aarNotes = computed(() => this.notes.notes().filter(n => n.kind !== 'activity'))
  /** E-04 / D-63: the ICS-214 lines, oldest first by their own time. */
  readonly lines = computed(() => activityLines(this.notes.notes()))

  /** Newest first. */
  readonly shown = computed(() => {
    const f = this.filter()
    return [...this.aarNotes()].reverse().filter(n => f === 'all' || n.about === f)
  })
  /** Oldest first, the order an improvement plan is read in. */
  readonly incidentNotes = computed(() => this.aarNotes().filter(n => n.about === 'incident'))
  readonly appNotes = computed(() => this.aarNotes().filter(n => n.about === 'app'))

  private journal = inject(MissionJournalService)

  constructor(
    public notes: AarNoteService,
    private mission: MissionService,
    private router: Router,
    private log: LogService,
    private dialog: MatDialog,
    /** E-189: the summary page is a command-post page, so a field-mode phone gets no button to it. */
    public fieldMode: FieldModeService,
  ) { }

  formatTime(iso: string): string {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? '' : d.toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }

  missionName(): string {
    return this.mission.settings?.mission || this.mission.settings?.event || ''
  }

  /** Saves one edited field. A cleared note text is refused by the service, which keeps the old one. */
  onFieldChange(note: AarNoteType, field: 'text' | 'area' | 'recommendation' | 'owner' | 'about' | 'capability', value: string): void {
    this.notes.updateNote({ ...note, [field]: value })
  }

  onDelete(note: AarNoteType): void {
    if (confirm(`Delete this note?\n\n"${note.text}"\n\nThis cannot be undone.`)) {
      this.notes.deleteNote(note.uid)
    }
  }

  /** E-04 / D-63: the line's time as an `<input type="datetime-local">` value, local, to the minute. */
  lineTimeValue(n: AarNoteType): string {
    const d = new Date(noteTime(n))
    if (isNaN(d.getTime())) return ''
    const p = (x: number) => String(x).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  /** An edited time is stored in `at`; a cleared or unreadable one changes nothing (the field snaps back). */
  onLineTimeChange(note: AarNoteType, value: string): void {
    const d = new Date(value)
    if (!value || isNaN(d.getTime())) return
    this.notes.updateNote({ ...note, at: d.toISOString() })
  }

  onLineTextChange(note: AarNoteType, value: string): void {
    this.notes.updateNote({ ...note, text: value })
  }

  onDeleteLine(note: AarNoteType): void {
    if (confirm(`Delete this ICS-214 line?\n\n"${note.text}"\n\nThis cannot be undone.`)) {
      this.notes.deleteNote(note.uid)
    }
  }

  /** Opens the Export ICS-214 dialog (loaded when needed; pdf-lib loads only when Export is pressed inside it). */
  async onExport214(): Promise<void> {
    const { Ics214ExportDialogComponent } = await import('./ics214-export-dialog.component')
    this.dialog.open(Ics214ExportDialogComponent, { maxWidth: '95vw', autoFocus: 'first-tabbable' })
  }

  /** Deletes every `aar` note, both kinds (this incident and about RangerTrak). The 214 lines stay. */
  onDeleteAll(): void {
    const count = this.aarNotes().length
    if (confirm(`Delete all ${count} after-action notes on this device, both about this incident and about RangerTrak? This cannot be undone.\n\n`
      + `Back up the mission first (Mission page) if you may need them. The ICS-214 lines are not deleted.`)) {
      this.notes.deleteAllOfKind('aar')
      this.journal.record('aar-notes-cleared', `Deleted all ${count} after-action notes.`)
    }
  }

  /** E-221: deletes the notes about RangerTrak only, e.g. once a summary has gone to the developers. */
  onDeleteAppNotes(): void {
    const count = this.appNotes().length
    if (confirm(`Delete these ${count} note(s) about RangerTrak? This cannot be undone.\n\n`
      + `Notes about this incident and the ICS-214 lines are not deleted.`)) {
      this.notes.deleteWhere(n => n.kind === 'aar' && n.about === 'app')
      this.journal.record('aar-notes-cleared', `Deleted ${count} after-action notes about RangerTrak.`)
    }
  }

  /** Same body-class technique as Radio Log's ICS-309 print: hides the app chrome on paper. */
  onPrint(): void {
    showFirstPrintTip() // 2026-09-30, John: once per device, see print-tip.ts
    document.body.classList.add('rt-print-aar')
    window.addEventListener('afterprint', () => document.body.classList.remove('rt-print-aar'), { once: true })
    const untitle = armPrintTitle('After Action', this.mission.settings) // E-172, see print-title.ts
    this.journal.record('print-aar', 'Printed the After Action page.')
    window.print()
    untitle()
    document.body.classList.remove('rt-print-aar')
  }

  onExportCsv(): void {
    const header = ['Noted at', 'About', 'Page', 'Observation', 'Area', 'Capability element', 'Recommendation', 'Owner']
    const rows = this.aarNotes().map(n => [
      n.createdAt, this.aboutLabels[n.about], n.page, n.text, n.area,
      n.capability ? this.capabilityLabels[n.capability] : '', n.recommendation, n.owner,
    ].map(csvCell).join(','))
    const csv = [header.map(csvCell).join(','), ...rows].join('\r\n')

    const label = (this.missionName() || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
    const filename = `rangertrak-after-action-${label}-${localDateStamp()}.csv`
    downloadCsv(csv, filename)
    this.journal.record('aar-exported', `Exported ${this.aarNotes().length} after-action notes to ${filename}.`)
  }

  /** Opens Help > Feedback with the RangerTrak notes filled in. Nothing is sent from here. */
  onSendAppNotes(): void {
    const draft = this.appNotes().map(n => `- ${n.text}${n.page ? ` (on ${n.page})` : ''}`).join('\n')
    this.router.navigate(['/help'], {
      queryParams: { tab: 'feedback' },
      state: { feedbackDraft: `Notes about RangerTrak from a mission debrief:\n\n${draft}` },
    })
  }
}
