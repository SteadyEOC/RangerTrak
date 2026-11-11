import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { map } from 'rxjs'
import { MatButtonModule } from '@angular/material/button'

import { clock, reportFirstLine, reportFullText, stateChip } from '../../domain/field-report-view'
import { FieldModeService } from '../../shared/services/field-mode.service'
import { RadioLogEntryType } from '../../shared/services/radio-log-entry.interface'
import { RadioLogService } from '../../shared/services/radio-log.service'
import { MissionJournalService } from '../../shared/services/mission-journal.service'

/**
 * E-251/E-253 (2026-11-11, ADR D-69): "My reports" on a field phone's Entry page. Every report on this
 * phone, newest first, with its state (Not sent / Sent / Received). A tap opens the full text,
 * read-only. A not-sent report can be edited (Entry loads it into its own form) or deleted; a sent
 * one cannot, because the command post may already hold a copy (radio a correction instead).
 *
 * Loaded with @defer (on viewport) from Entry, so it stays out of Entry's first load (E-269/E-271).
 * The text is shown here only: never written to the Log page, the journal or storage (rule 5).
 */
@Component({
  selector: 'rangertrak-my-reports',
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @if (rows().length) {
      <section class="mr" data-testid="my-reports" aria-label="My reports">
        <h3 class="mr__head">My reports</h3>
        <ul class="mr__list">
          @for (r of rows(); track r.uid ?? r.id) {
            <li class="mr__item" data-testid="my-report-row">
              <button type="button" class="mr__row" [attr.aria-expanded]="open() === r.uid"
                (click)="toggle(r.uid)">
                <span class="mr__time">{{ r.time }}</span>
                <span class="mr__line">{{ r.line }}</span>
                <span class="mr__chip" [class.mr__chip--new]="r.state === 'not-sent'"
                  [class.mr__chip--received]="r.state === 'received'" data-testid="my-report-chip">{{ r.chip }}</span>
              </button>
              @if (open() === r.uid) {
                <p class="mr__text" data-testid="my-report-text">{{ r.text }}</p>
              }
              @if (r.state === 'not-sent') {
                <div class="mr__actions">
                  <button matButton="outlined" type="button" data-testid="my-report-edit"
                    (click)="edit.emit(r.entry)">Edit</button>
                  <button matButton type="button" data-testid="my-report-delete"
                    (click)="onDelete(r)">Delete</button>
                </div>
              }
            </li>
          }
        </ul>
        @if (sentCount() || receivedCount()) {
          <div class="mr__bulk">
            @if (sentCount()) {
              <button matButton type="button" data-testid="mark-received" (click)="onMarkReceived()">Mark {{ sentCount() }} sent report{{ sentCount() === 1 ? '' : 's' }} received</button>
            }
            @if (receivedCount()) {
              <button matButton type="button" data-testid="clear-received" (click)="onClearReceived()">Clear {{ receivedCount() }} received report{{ receivedCount() === 1 ? '' : 's' }}</button>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [`
    .mr { margin: 1rem 0; }
    .mr__head { margin: 0 0 0.25rem; font-size: 1rem; }
    .mr__list { list-style: none; margin: 0; padding: 0; }
    .mr__item { border-top: 1px solid var(--rt-line); padding: 0.25rem 0; }
    .mr__row {
      display: flex; align-items: center; gap: 0.75rem; width: 100%; min-height: 44px;
      padding: 0.25rem 0; border: 0; background: transparent; color: inherit; font: inherit;
      text-align: start; cursor: pointer;
    }
    .mr__time { flex: none; font-variant-numeric: tabular-nums; color: var(--rt-ink-2); }
    .mr__line { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mr__chip {
      flex: none; padding: 0.1em 0.6em; border: 1px solid var(--rt-line-strong);
      border-radius: 999px; font-size: 0.85em; color: var(--rt-ink-2);
    }
    .mr__chip--new { color: var(--rt-ink); border-color: var(--rt-ink); }
    .mr__chip--received { background: var(--rt-surface-2); }
    .mr__text { margin: 0.25rem 0 0.5rem; white-space: pre-wrap; overflow-wrap: anywhere; }
    .mr__actions { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-bottom: 0.25rem; }
    .mr__actions button, .mr__bulk button { min-height: 44px; }
    .mr__bulk { display: flex; flex-wrap: wrap; gap: 0.5rem; padding-top: 0.5rem; }
  `],
})
export class MyReportsComponent {
  private readonly radioLog = toSignal(inject(RadioLogService).getRadioLogObserver().pipe(map(l => ({ ...l }))))   // a copy per emission: the service mutates one object in place
  private readonly service = inject(RadioLogService)
  private readonly fieldMode = inject(FieldModeService)
  private readonly journal = inject(MissionJournalService)

  /** Asks Entry to load this not-sent report into its own form. */
  readonly edit = output<RadioLogEntryType>()

  /** The uid of the row that is open (full text showing), if any. */
  readonly open = signal<string | undefined>(undefined)

  readonly rows = computed(() => {
    const reports = this.fieldMode.reports()
    const entries = [...(this.radioLog()?.logEntries ?? [])]
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id)
    return entries.map(entry => ({
      entry,
      uid: entry.uid,
      id: entry.id,
      time: clock(entry.date),
      line: reportFirstLine(entry),
      text: reportFullText(entry),
      state: this.fieldMode.stateOf(entry.uid),
      chip: stateChip(entry.uid ? reports[entry.uid] : undefined),
    }))
  })

  readonly sentCount = computed(() => this.rows().filter(r => r.state === 'sent').length)
  readonly receivedCount = computed(() => this.rows().filter(r => r.state === 'received').length)

  /** E-260 (D-69): for when the command post confirmed the reports by radio and no receipt came. */
  onMarkReceived(): void {
    const uids = this.rows().filter(r => r.state === 'sent' && r.uid).map(r => r.uid as string)
    if (!uids.length) return
    if (!confirm(`Mark the ${uids.length} sent report${uids.length === 1 ? '' : 's'} as received? `
      + 'Use this when the command post has confirmed them by radio.')) return
    const changed = this.fieldMode.markReceived(uids)
    this.journal.record('reports-marked-received', `Marked ${changed} sent report${changed === 1 ? '' : 's'} as received by hand.`)
  }

  /** E-260 (D-69): never automatic. Deletes the received reports from this phone, one save, one photo sweep. */
  async onClearReceived(): Promise<void> {
    const uids = this.rows().filter(r => r.state === 'received' && r.uid).map(r => r.uid as string)
    if (!uids.length) return
    if (!confirm(`Clear the ${uids.length} received report${uids.length === 1 ? '' : 's'} from this phone?

`
      + 'The command post has them. This cannot be undone on this phone.')) return
    await this.service.deleteEntries(uids, 'reports-cleared')
    this.fieldMode.forget(uids)
  }

  toggle(uid: string | undefined): void {
    this.open.update(cur => (cur === uid ? undefined : uid))
  }

  async onDelete(row: { uid?: string, time: string, line: string }): Promise<void> {
    if (!row.uid) return
    if (!confirm(`Delete the report from ${row.time}?\n\n"${row.line}"\n\nIt has not been sent, and this cannot be undone.`)) return
    await this.service.deleteEntry(row.uid)
  }
}
