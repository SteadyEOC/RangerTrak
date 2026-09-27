import { ChangeDetectionStrategy, Component } from '@angular/core'
import { SectionComponent } from '../section/section.component'

/**
 * The AG Grid keyboard-interaction disclosure, shared by Rangers and Radio Log entries —
 * previously two byte-identical copies of the same content (E-84 audit, §2.8).
 */
@Component({
  selector: 'rangertrak-grid-keyboard-help',
  standalone: true,
  imports: [SectionComponent],
  templateUrl: './grid-keyboard-help.component.html',
  changeDetection: ChangeDetectionStrategy.Eager
})
export class GridKeyboardHelpComponent { }
