import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core'

import { ViewService } from '../services/view.service'

/**
 * E-207 / ADR D-62 phase 3: the longer half of a piece of help text. Easy menus shows the one-line
 * version and folds the rest behind "More about this"; Full menus starts it open. Nothing is ever
 * removed: the fold is always there to open, in either view. Help itself is never hidden.
 *
 * A native <details>, not ExpandableSectionComponent: that one is a whole titled section, this is
 * the tail of a paragraph. `[open]` follows the view; a reader can still open or close it by hand.
 */
@Component({
  selector: 'rangertrak-more-about',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="more-about" data-testid="more-about" [open]="!view.isSimple()">
      <summary>{{ label() }}</summary>
      <div class="more-about__body"><ng-content></ng-content></div>
    </details>`,
  styles: `
    :host { display: block; }
    .more-about { margin-block: 0.25rem 0.75rem; }
    .more-about > summary {
      cursor     : pointer;
      color      : var(--rt-ink-2);
      font-size  : var(--rt-type-body-size);
      width      : fit-content;
      padding-block: 0.5rem;
    }
    .more-about > summary:focus-visible { outline: 2px solid var(--rt-accent); outline-offset: 2px; }
    .more-about__body { padding-inline-start: 0.75rem; border-inline-start: 2px solid var(--rt-line); }
  `,
})
export class MoreAboutComponent {
  protected readonly view = inject(ViewService)

  /** The fold's label. "More about this" unless the context needs a clearer one. */
  readonly label = input('More about this')
}
