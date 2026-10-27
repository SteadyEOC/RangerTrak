import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { MatSlideToggleModule } from '@angular/material/slide-toggle'

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
  imports: [MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view-switch" data-testid="view-switch-header" [class.view-switch--full]="!view.isSimple()">
      <mat-slide-toggle hideIcon [checked]="!view.isSimple()" (change)="view.setView($event.checked ? 'full' : 'simple')"
        title="Full view shows every control, including the advanced ones. Nothing is changed.">Full view</mat-slide-toggle>
      @if (!view.isSimple()) {
      <span class="view-switch__hint" data-testid="view-switch-hint">Options with a plum edge show only in Full view</span>
      }
    </div>`,
  // Wraps under the toggle on a phone; the hint is first in the row when it does, never wider than the screen.
  // E-231: in the header row beside AAR/214 and Help, so the switch wears the same control height,
  // corners and outline (_patterns.scss rule 1-2); in Full view the edge is plum, the colour the hint
  // talks about.
  styles: `
    :host { display: block; min-width: 0; max-width: 100%; }
    .view-switch { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--rt-space-xs) var(--rt-space-md); max-width: 100%; }
    .view-switch__hint { order: -1; color: var(--rt-ink-2); font-size: 0.85em; min-width: 0; text-align: right; }
    mat-slide-toggle {
      display: inline-flex; align-items: center; box-sizing: border-box;
      min-height: var(--rt-control-height);
      padding-inline: 12px 4px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: var(--rt-control-radius);
    }
    .view-switch--full mat-slide-toggle { border-color: var(--rt-advanced); box-shadow: inset 0 0 0 1px var(--rt-advanced); }`,
})
export class ViewSwitchComponent {
  protected readonly view = inject(ViewService)
}
