import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, ElementRef, Input, ViewChild } from '@angular/core'

/**
 * A labelled block of secondary page content.
 *
 * Was `DisclosureComponent`, a collapsed `<details>`/`<summary>` widget (Sprint B). The
 * maintainer removed every collapsible section app-wide 2026-08-25: "Remove all
 * collapsable sectinos: all should be visible. You can put them under a minor heading to
 * group them if appropriate." This component now renders its heading and body both always
 * visible - same call-site API (`summary` input, `[rtSummary]` projection, `emphasis`), so
 * every consumer only needed its tag/import renamed, not its markup rewritten.
 *
 * Usage - simple text heading:
 *    <rangertrak-section summary="Instructions"> ...content... </rangertrak-section>
 *
 * Usage - rich heading (links, interpolation), projected instead:
 *    <rangertrak-section>
 *      <span rtSummary>&copy;{{today | date: 'y'}} <a href="...">SteadyEOC</a></span>
 *      ...content...
 *    </rangertrak-section>
 *
 * `emphasis="plain"` renders the heading as plain small print (no `<h3>`, no bold/larger
 * styling) rather than a real heading - for content like the license line that is genuinely
 * a footer, not a section a reader would look for by name.
 */
@Component({
  selector: 'rangertrak-section',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './section.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./section.component.scss']
})
export class SectionComponent {
  /** Plain-text heading. Omit and project `[rtSummary]` for anything richer. */
  @Input() summary = ''

  @Input() emphasis: 'strong' | 'plain' = 'strong'

  @ViewChild('section') private sectionEl?: ElementRef<HTMLElement>

  /**
   * Scroll this section into view. Used by the Rangers confidentiality bar's
   * "What this means", so a dismissable summary can still point at the full text. No
   * open/collapse state to set anymore - the content is already visible.
   */
  reveal(): void {
    this.sectionEl?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}
