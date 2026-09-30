import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'

import { PageComponent } from '../shared/page/page.component'
import { MATERIAL_IMPORTS } from '../material-imports'
import {
  AAR_NOTE_ABOUT_LABELS, AarNoteAbout, AarNoteService, AarNoteType, LogService, MissionService
} from '../shared/services'
import { showFirstPrintTip } from '../shared/export/print-tip'

type Filter = 'all' | AarNoteAbout

/** Quotes one CSV cell (RFC 4180): wrap in quotes, double any quote inside. */
function csvCell(value: string | undefined): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

/**
 * E-116: review the After Action notes captured from the header's "AAR note" button - the
 * hotwash half of the feature. Each note is edited in place (text, about, area, recommendation,
 * owner) and saved on change. Output: a printed improvement-plan table of the incident notes,
 * a CSV of everything, and - for notes about RangerTrak itself - a hand-off to Help > Feedback
 * with the text filled in, which the user reviews and sends (never automatic).
 *
 * Not behind fieldModeGuard, unlike the other working pages: a field-mode phone can capture
 * notes from the header, so it has to be able to review them too.
 */
@Component({
  selector: 'rangertrak-after-action',
  standalone: true,
  imports: [CommonModule, FormsModule, PageComponent, ...MATERIAL_IMPORTS],
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
  filter = signal<Filter>('all')

  /** Newest first. */
  readonly shown = computed(() => {
    const f = this.filter()
    return [...this.notes.notes()].reverse().filter(n => f === 'all' || n.about === f)
  })
  /** Oldest first, the order an improvement plan is read in. */
  readonly incidentNotes = computed(() => this.notes.notes().filter(n => n.about === 'incident'))
  readonly appNotes = computed(() => this.notes.notes().filter(n => n.about === 'app'))

  constructor(
    public notes: AarNoteService,
    private mission: MissionService,
    private router: Router,
    private log: LogService,
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
  onFieldChange(note: AarNoteType, field: 'text' | 'area' | 'recommendation' | 'owner' | 'about', value: string): void {
    this.notes.updateNote({ ...note, [field]: value })
  }

  onDelete(note: AarNoteType): void {
    if (confirm(`Delete this note?\n\n"${note.text}"\n\nThis cannot be undone.`)) {
      this.notes.deleteNote(note.uid)
    }
  }

  onDeleteAll(): void {
    const count = this.notes.notes().length
    if (confirm(`Delete all ${count} after-action notes on this device? This cannot be undone.\n\n`
      + `Back up the mission first (Mission page) if you may need them.`)) {
      this.notes.deleteAllNotes()
      this.log.warn(`Deleted all ${count} after-action notes`, this.id)
    }
  }

  /** Same body-class technique as Radio Log's ICS-309 print: hides the app chrome on paper. */
  onPrint(): void {
    showFirstPrintTip() // 2026-09-30, John: once per device, see print-tip.ts
    document.body.classList.add('rt-print-aar')
    window.addEventListener('afterprint', () => document.body.classList.remove('rt-print-aar'), { once: true })
    window.print()
    document.body.classList.remove('rt-print-aar')
  }

  onExportCsv(): void {
    const header = ['Noted at', 'About', 'Page', 'Observation', 'Area', 'Recommendation', 'Owner']
    const rows = this.notes.notes().map(n => [
      n.createdAt, this.aboutLabels[n.about], n.page, n.text, n.area, n.recommendation, n.owner,
    ].map(csvCell).join(','))
    const csv = [header.map(csvCell).join(','), ...rows].join('\r\n')

    // BOM so Excel opens accented names as UTF-8.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const label = (this.missionName() || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
    const a = document.createElement('a')
    a.href = url
    a.download = `rangertrak-after-action-${label}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
