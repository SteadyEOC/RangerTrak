import { ChangeDetectionStrategy, Component } from '@angular/core'
import { RouterLink } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'

import { ExpandableSectionComponent } from '../../../shared/expandable-section/expandable-section.component'
import { FieldModeService } from '../../../shared/services/field-mode.service'

/**
 * Help tab: the first five minutes on a new device, as one linear checklist, plus reference
 * material behind expandable sections.
 *
 * F29-32 (2026-08-29): merged with the former "Mission setup" tab - see this template's own
 * comment for the reasoning and the abort-condition mechanism. Before that, this tab had
 * already been split from a combined "Start here" 2026-08-27 (it was doing two jobs at once -
 * onboarding steps and "what RangerTrak is", which now lives in HelpAboutComponent).
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
  selector: 'rangertrak-help-start',
  standalone: true,
  imports: [RouterLink, MatButtonModule, ExpandableSectionComponent],
  templateUrl: './help-start.component.html',
  styleUrls: ['./help-tab.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class HelpStartComponent {

  constructor(public fieldMode: FieldModeService) { }

  /**
   * E-142 (2026-09-29, John): the way out of field mode. Lives in Help because Help is one of
   * the only two pages a field-mode device can reach (fieldModeGuard blocks Mission). Safe to
   * offer without a gate: field mode is only ever turned on on a brand-new device, so leaving
   * it reveals nothing but this phone's own reports.
   */
  onTurnOffFieldMode(): void {
    if (!confirm('Turn off field mode on this device?\n\n'
      + 'Every page comes back to the menu: the roster, map, radio log and Mission. '
      + 'Reports already on this device stay.')) {
      return
    }
    this.fieldMode.disable()
    // Same reason as EntryComponent.onEnableFieldMode(): nav and route gating read
    // fieldMode.enabled() at construction time, so a reload is the reliable reset.
    window.location.reload()
  }
}
