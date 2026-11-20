import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { RouterLink } from '@angular/router'
import { entryFromTo } from '../../domain/entry-layout'
import { clock } from '../../domain/field-report-view'
import type { RadioLogEntryType } from '../../shared/services/'

/**
 * E-332: the plain list under the basic and net layouts: the entries given, in the order given (newestFirst: by time), with From and To
 * as their own columns (never only In/Out). A plain table, not the Radio Log's grid: AG Grid stays out of Entry.
 */
@Component({
  selector: 'rangertrak-entry-recent-list',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<p class="recent__link"><a routerLink="/radio-log" data-testid="entry-open-radio-log">Open the Radio Log</a></p>
@if (entries().length === 0) {
<p class="recent__empty" data-testid="entry-recent-empty">Nothing logged yet.</p>
} @else {
<div class="recent__scroll">
  <table class="recent__table" data-testid="entry-recent-list">
    <colgroup><col class="recent__col-time"><col class="recent__col-call"><col class="recent__col-call"><col></colgroup>
    <thead><tr><th scope="col">Time</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Message</th></tr></thead>
    <tbody>
      @for (e of entries(); track e.uid ?? e.id) {
      <tr data-testid="entry-recent-row">
        <td>{{ time(e) }}</td>
        <td>{{ parties(e).from }}</td>
        <td>{{ parties(e).to }}</td>
        <td class="recent__msg">{{ e.notes }}</td>
      </tr>
      }
    </tbody>
  </table>
</div>
}`,
  styles: [`
    :host { display: block; }
    .recent__link { margin: 8px 0; }
    .recent__empty { color: var(--rt-ink-2); }
    .recent__scroll { max-height: 60vh; overflow: auto; border: 1px solid var(--rt-line); border-radius: 6px; }
    .recent__table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    /* Same widths as the basic layout's entry row above, so its boxes sit over their columns. */
    .recent__col-time { width: calc(5.5rem + 8px); }
    .recent__col-call { width: calc(11rem + 8px); }
    .recent__table td { overflow-wrap: break-word; }
    .recent__table th, .recent__table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--rt-line); vertical-align: top; }
    .recent__table th { position: sticky; top: 0; background: var(--rt-surface-2); color: var(--rt-ink); }
    .recent__msg { overflow-wrap: anywhere; }
    @media (max-width: 600px) {
      .recent__table { font-size: 0.875rem; }
      .recent__table th, .recent__table td { padding: 6px 4px; }
      .recent__col-time { width: 3rem; }
      .recent__col-call { width: 25%; }
    }
  `],
})
export class EntryRecentListComponent {
  readonly entries = input.required<readonly RadioLogEntryType[]>()
  time(e: RadioLogEntryType): string { return clock(e.date) }
  parties(e: RadioLogEntryType) { return entryFromTo(e) }
}
