import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'

import { ExpandableSectionComponent } from '../../../shared/expandable-section/expandable-section.component'
import { FeedbackComponent } from '../../../shared/feedback/feedback.component'

/**
 * Help tab: where to report a problem or suggest something - was "Log" (0.74.0), renamed and
 * repurposed 2026-08-29 (D-d, F29-26). Two things merged into it:
 *
 * - The feedback form (ADR D-15), moved here from About (0.78.0's F29-25 pass put it there
 *   as an interim consolidation while every tab's repeated About/feedback/How-it's-built
 *   blocks were being stripped - this is where the maintainer actually wanted it to land:
 *   "having Log as an optional part of the Help page's feedback tab").
 * - The diagnostic Log, folded in as a closed-by-default ExpandableSectionComponent rather
 *   than kept as its own tab - the maintainer's own reasoning: "the main reason to
 *   read/copy/send the log is for feedback purposes." This is not a round trip back to
 *   0.74.0's "buried in prose" problem - a labelled section inside a Feedback tab is still
 *   far more findable than a link in another tab's paragraph, it just no longer needs a tab
 *   of its own.
 *
 * Content rule for every tab in this folder: describe only controls that actually exist and
 * work. See "E-84 Documentation Rewrite Plan.md" section 2 for the audited keep/remove list.
 */
@Component({
  selector: 'rangertrak-help-feedback',
  standalone: true,
  imports: [RouterLink, MatButtonModule, ExpandableSectionComponent, FeedbackComponent],
  templateUrl: './help-feedback.component.html',
  styleUrls: ['./help-tab.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HelpFeedbackComponent {
  // E-258 (2026-10-28): the Log section is always shown now (it was gated on Debug mode).
}
