import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { RouterLink } from '@angular/router'

import { ViewService } from '../../../shared/services/view.service'
import { MoreAboutComponent } from '../../../shared/view/more-about.component'

/**
 * Help tab: Where your data lives, who can see it, exports, backup and restore, and the Log.
 *
 * E-84: the Help page was one long scroll of ~8 prose blocks plus three disclosures, which
 * is why six shipped features ended up documented nowhere - there was no obvious place to
 * put them and no way to tell what was already covered. Each tab is its own component so a
 * section can be rewritten without touching the others, and so the shell stays readable.
 *
 * Content rule for every tab in this folder: describe only controls that actually exist and
 * work. See "E-84 Documentation Rewrite Plan.md" section 2 for the audited keep/remove list -
 * several controls on screen today are scheduled for removal and must NOT be documented.
 */
@Component({
  selector: 'rangertrak-help-data',
  standalone: true,
  imports: [RouterLink, MoreAboutComponent],
  templateUrl: './help-data.component.html',
  styleUrls: ['./help-tab.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HelpDataComponent {
  /** E-207: Attach's whereabouts depend on the view. */
  protected readonly view = inject(ViewService)
}
