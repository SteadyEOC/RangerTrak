import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'

import { ViewService } from '../services/view.service'

/**
 * E-207 / ADR D-62 item 4, reshaped by E-214: the "Full menus" switch in the page header (on = Full
 * view, off = Easy menus). The person's own choice, so it records source `user`. Switching only
 * changes what is shown; it never changes or deletes anything. One setting for the whole device;
 * the page shell (PageComponent) decides which pages show it.
 */
@Component({
  selector: 'rangertrak-view-switch',
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view-switch" data-testid="view-switch-header" [class.view-switch--full]="!view.isSimple()">
      <button matButton="outlined" type="button" role="switch" class="rt-header-action"
        [attr.aria-checked]="!view.isSimple()"
        [attr.aria-label]="'Full menus' + (hidden() ? ', ' + hidden() + ' more options on this page' : '')"
        (click)="view.setView(view.isSimple() ? 'full' : 'simple')" [title]="title()">
        <span class="view-switch__dot" aria-hidden="true"></span>
        <span class="rt-header-action__label">Full menus</span>
        @if (hidden()) {
        <span class="view-switch__count" data-testid="view-switch-count" aria-hidden="true">+{{ hidden() }}</span>
        }
      </button>
    </div>`,
  // E-231: in the header row beside AAR/214 and Help, and the same outlined button as them. Its edge
  // is always plum, the colour of the options it reveals; the explanation is hover text, not a line
  // on the page. A plain button with a dot, empty for Simple and plum-filled for Full, in place of
  // Material's slide toggle (John 2026-10-27). E-248 (John 2026-10-28): the rest of the outline shows
  // the state, plum for Full and the normal grey for Simple; the left edge stays plum in both.
  styles: `
    :host { display: block; min-width: 0; max-width: 100%; }
    .view-switch { display: flex; justify-content: flex-end; max-width: 100%; }
    /* The same 3px left edge that marks Full-view-only options (_patterns.scss .rt-advanced). */
    button { box-shadow: inset 3px 0 0 var(--rt-advanced); }
    .view-switch--full button { --mat-button-outlined-outline-color: var(--rt-advanced); }
    .view-switch__dot {
      display: inline-block; width: 16px; height: 16px; margin-inline-end: 8px;
      border: 2px solid var(--rt-advanced); border-radius: 50%; box-sizing: border-box;
    }
    .view-switch--full .view-switch__dot { background: var(--rt-advanced); }
    /* E-303: the number of options Easy menus is hiding on this page. */
    .view-switch__count {
      margin-inline-start: 6px; padding: 0 6px; border-radius: 10px; font-size: 0.8em; font-weight: 700;
      background: var(--rt-advanced); color: var(--rt-surface);
    }
    @media (max-width: 599.98px) { .view-switch__dot { margin-inline-end: 0; } .view-switch__count { margin-inline-start: 4px; } }`,
})
export class ViewSwitchComponent {
  protected readonly view = inject(ViewService)
  /** The ids this page can hide (ADVANCED_FEATURES); the page shell passes them in (E-303). */
  readonly viewIds = input<readonly string[]>([])
  protected readonly hidden = computed(() => this.view.hiddenCount(this.viewIds()))
  protected readonly title = computed(() => {
    const n = this.hidden()
    return n ? `${n} more option${n === 1 ? '' : 's'} on this page. ${this.hint}` : this.hint
  })
  protected readonly hint = 'Full menus shows every option. Options with a plum edge, like this switch, appear only in Full menus. '
    + 'Easy menus hides them so each page shows just what most people need. Switching changes only what you see; nothing is changed or deleted.'
}
