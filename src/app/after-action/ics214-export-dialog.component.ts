import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatRadioModule } from '@angular/material/radio'
import { MatSnackBar } from '@angular/material/snack-bar'

import {
  ActivityLogResource, DEFAULT_ICS_POSITION, ICS214_MAX_RESOURCES, buildActivityRows, hasOpPeriod, selectActivityLines,
  formatActivityTime, suggestActivityFromJournal,
} from '../domain/activity-log'
import { localDateStamp } from '../shared/export/local-date'
import { ActivityLogHeaderService, AarNoteService, LogService, MissionService } from '../shared/services'
import { MissionJournalService } from '../shared/services/mission-journal.service'

type Scope = 'op' | 'all'

/**
 * E-04 / ADR D-63 items 4-6: the Export ICS-214 dialog. The header fields (name, ICS position, home
 * agency, up to 8 Resources Assigned rows) are prefilled from what was saved last time and saved
 * again on export, which is how they are "entered once". Then a choice of which lines go on the
 * form: this operational period (when the mission has one and it holds lines) or all of them.
 *
 * The form is FEMA's own fillable PDF, filled offline (ics214-pdf.ts) and delivered the way the
 * ICS-213 is (printIcs213: the print dialog, else a saved file). pdf-lib and the delivery helper
 * are loaded when Export is pressed, not with this page.
 */
@Component({
  selector: 'rangertrak-ics214-export-dialog',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatRadioModule],
  templateUrl: './ics214-export-dialog.component.html',
  styleUrls: ['./ics214-export-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class Ics214ExportDialogComponent {
  private id = 'ICS-214 export'
  readonly maxResources = ICS214_MAX_RESOURCES

  name = signal('')
  icsPosition = signal('')
  homeAgency = signal('')
  resources = signal<ActivityLogResource[]>([])

  /** Lines in the mission's operational period, and all lines. */
  readonly opCount: number
  readonly allCount: number
  readonly hasPeriod: boolean
  scope = signal<Scope>('all')

  readonly selectedCount = computed(() => this.scope() === 'op' ? this.opCount : this.allCount)

  // E-222 / D-67 item 8: journal entries the scribe may add as lines. Never ticked by default.
  private journal = inject(MissionJournalService)
  /** Seqs of the ticked suggestions. */
  readonly ticked = signal<ReadonlySet<number>>(new Set())
  /** In the chosen scope, worth a line, and not already a line. */
  readonly suggestions = computed(() => suggestActivityFromJournal(
    this.journal.entries(), this.notes.getCurrentNotes(), this.missionService.settings, this.scope() === 'op'))
  /** Ticked AND still offered (changing the scope can hide a ticked one). */
  readonly tickedSuggestions = computed(() => this.suggestions().filter(s => this.ticked().has(s.seq)))
  /** What the form will hold: the lines in the scope plus the ticked suggestions. */
  readonly exportCount = computed(() => this.selectedCount() + this.tickedSuggestions().length)
  busy = signal(false)
  error = signal('')

  constructor(
    private dialogRef: MatDialogRef<Ics214ExportDialogComponent, boolean>,
    private notes: AarNoteService,
    private headerService: ActivityLogHeaderService,
    private missionService: MissionService,
    private snackBar: MatSnackBar,
    private log: LogService,
  ) {
    const h = this.headerService.getCurrentHeader()
    this.name.set(h.name)
    this.icsPosition.set(h.icsPosition || DEFAULT_ICS_POSITION)
    this.homeAgency.set(h.homeAgency)
    this.resources.set(h.resources.map(r => ({ ...r })))

    const mission = this.missionService.settings
    this.hasPeriod = hasOpPeriod(mission)
    this.opCount = selectActivityLines(this.notes.getCurrentNotes(), mission, true).length
    this.allCount = selectActivityLines(this.notes.getCurrentNotes(), mission, false).length
    // D-63 item 6: default to the operational period when the mission has one and it holds lines.
    this.scope.set(this.hasPeriod && this.opCount > 0 ? 'op' : 'all')
  }

  setTicked(seq: number, on: boolean): void {
    this.ticked.update(t => { const next = new Set(t); if (on) next.add(seq); else next.delete(seq); return next })
  }

  /** Time as the form shows it, local: `MM/dd HH:mm`. */
  suggestionTime(iso: string): string {
    return formatActivityTime(iso)
  }

  /**
   * Adds every ticked suggestion as an ordinary 214 line (kind 'activity', timed when the action happened).
   * The lines stay afterwards and can be edited like any other. Returns how many were added.
   */
  addTickedSuggestions(): number {
    const chosen = this.tickedSuggestions()
    for (const s of chosen) this.notes.addNote(s.summary, 'incident', 'Journal', 'activity', s.at)
    this.ticked.set(new Set())
    return chosen.length
  }

  addResource(): void {
    if (this.resources().length >= ICS214_MAX_RESOURCES) return
    this.resources.update(r => [...r, { name: '', icsPosition: '', homeAgency: '' }])
  }

  removeResource(index: number): void {
    this.resources.update(r => r.filter((_, i) => i !== index))
  }

  setResource(index: number, field: keyof ActivityLogResource, value: string): void {
    this.resources.update(r => r.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }

  onCancel(): void {
    this.dialogRef.close(false)
  }

  async onExport(): Promise<void> {
    if (this.busy() || this.exportCount() === 0) return
    this.busy.set(true)
    this.error.set('')
    try {
      // Saved first: whatever happens to the print, the header does not have to be typed again.
      const header = this.headerService.save({
        name: this.name(),
        icsPosition: this.icsPosition().trim() || DEFAULT_ICS_POSITION,
        homeAgency: this.homeAgency(),
        resources: this.resources(),
      })
      const mission = this.missionService.settings
      const fromJournal = this.addTickedSuggestions()   // before the lines are read, so they go on the form
      const lines = selectActivityLines(this.notes.getCurrentNotes(), mission, this.scope() === 'op')
      const rows = buildActivityRows(lines)

      // Lazy, like Entry's auto-print of the 213: pdf-lib stays out of the page's own chunk.
      const [{ fillIcs214Pdf }, { printIcs213 }] = await Promise.all([
        import('../shared/export/ics214-pdf'),
        import('../shared/export/ics213-print'),
      ])
      const res = await fetch('assets/forms/ics-214.pdf')
      if (!res.ok) throw new Error(`Fetching the ICS-214 template failed: ${res.status}`)
      const templateBytes = new Uint8Array(await res.arrayBuffer())

      const filled = await fillIcs214Pdf(templateBytes, header, mission, rows, new Date(), mission.missionMode === 'exercise',
        mission.version)
      const label = (mission.event || mission.mission || 'mission').replace(/[^a-z0-9_-]+/gi, '_')
      const outcome = await printIcs213(filled, `ics-214-${label}-${localDateStamp()}.pdf`, 1, mission, 'ICS-214')
      this.journal.record('export-214', `Exported the ICS-214 (${lines.length} lines${fromJournal ? `, ${fromJournal} added from the journal` : ''}): ${outcome}`)
      this.snackBar.open(outcome === 'printed' ? 'ICS-214 sent to print' : 'ICS-214 saved as a file', undefined, { duration: 4000 })
      this.dialogRef.close(true)
    } catch (e) {
      this.log.error(`ICS-214 export failed: ${e}`, this.id)
      this.error.set('The ICS-214 could not be made. Your lines and the header are saved; try again.')
    } finally {
      this.busy.set(false)
    }
  }
}
