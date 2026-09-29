import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Input } from '@angular/core'

import { MATERIAL_IMPORTS } from '../../material-imports'

/**
 * A labelled block of secondary content, collapsed by default - click the heading to open.
 *
 * Sibling to `SectionComponent` (same `summary`/`[rtSummary]` call-site API), for content
 * that specifically wants to start OUT of sight: an exceptional/rarely-needed action (a
 * danger zone), or a long list a reader scans selectively rather than reads start to end
 * (FAQ). Deliberately a SEPARATE component, not a mode on `SectionComponent` - that
 * component's own predecessor (`DisclosureComponent`) was removed as collapsible app-wide
 * 2026-08-25 ("Remove all collapsable sectinos: all should be visible"), and `SectionComponent`
 * now always renders open with no toggle state at all. This component is the 2026-08-29
 * exception to that: the maintainer asked for exactly this pattern in three places in the
 * same feedback batch (F29-18 danger zones, F29-31 FAQ, and Help's Log-inside-Feedback
 * decision) - reusing `SectionComponent`'s name for the opposite behavior would misdescribe
 * it for its other, still-always-open callers.
 *
 * Wrap several in a `<mat-accordion multi>` for independent open/close (FAQ); a single one
 * needs no accordion wrapper (danger zones, Log-in-Feedback).
 */
@Component({
  selector: 'rangertrak-expandable-section',
  standalone: true,
  imports: [CommonModule, ...MATERIAL_IMPORTS],
  templateUrl: './expandable-section.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./expandable-section.component.scss']
})
export class ExpandableSectionComponent {
  /** Plain-text heading. Omit and project `[rtSummary]` for anything richer. */
  @Input() summary = ''

  /**
   * 2026-09-28, John: a short, muted one-line explanation shown in the header WHILE
   * COLLAPSED (Material's own `<mat-panel-description>`, always visible regardless of
   * expanded state) - so a reader can tell what a section holds before opening it, e.g.
   * Danger zone: "Reset, restore, or load a sample mission." Omit for a section whose
   * heading alone is already self-explanatory.
   */
  @Input() description = ''

  /** Starts open. Every current use (danger zones, FAQ, Log) wants closed - default false. */
  @Input() startOpen = false
}
