import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatButtonModule } from '@angular/material/button'

import { ViewService } from '../services/view.service'

/**
 * E-207 / ADR D-62 item 4, reshaped by E-214: the "Full view" switch in the page header (on = Full
 * view, off = Simple view). The person's own choice, so it records source `user`. Switching only
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
      <button matButton="outlined" type="button" role="switch" [attr.aria-checked]="!view.isSimple()"
        (click)="view.setView(view.isSimple() ? 'full' : 'simple')" [title]="hint">
        <span class="view-switch__dot" aria-hidden="true"></span>Full view
      </button>
    </div>`,
  // E-231: in the header row beside AAR/214 and Help, and the same outlined button as them. Its edge
  // is always plum, the colour of the options it reveals; the explanation is hover text, not a line
  // on the page. A plain button with a dot, empty for Simple and plum-filled for Full, in place of
  // Material's slide toggle (John 2026-10-27).
  styles: `
    :host { display: block; min-width: 0; max-width: 100%; }
    .view-switch { display: flex; justify-content: flex-end; max-width: 100%; }
    button { --mat-button-outlined-outline-color: var(--rt-advanced); }
    .view-switch--full button { box-shadow: inset 0 0 0 1px var(--rt-advanced); }
    .view-switch__dot {
      display: inline-block; width: 12px; height: 12px; margin-inline-end: 8px;
      border: 2px solid var(--rt-advanced); border-radius: 50%; box-sizing: border-box;
    }
    .view-switch--full .view-switch__dot { background: var(--rt-advanced); }`,
})
export class ViewSwitchComponent {
  protected readonly view = inject(ViewService)
  protected readonly hint = 'Full view shows every option. Options with a plum edge, like this switch, appear only in Full view. '
    + 'Simple view hides them so each page shows just what most people need. Switching changes only what you see; nothing is changed or deleted.'
}
