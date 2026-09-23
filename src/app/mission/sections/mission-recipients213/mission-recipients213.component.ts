import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { FieldTree } from '@angular/forms/signals'

import { DEFAULT_RECIPIENT_OPTIONS_213, MissionType } from '../../../shared/services/'
import { MATERIAL_IMPORTS } from '../../../material-imports'

/**
 * E-103: the per-mission definable checklist of routine ICS-213 recipients (Incident
 * Commander, Ops Section, EOC, ...) that Entry's "To (recipient(s))" checkboxes render from -
 * see `MissionType.recipientOptions213`'s own comment.
 *
 * A plain one-option-per-line textarea rather than the ag-Grid `MissionFieldReportStatusesComponent`
 * uses for statuses: a recipient option is a single string with no per-row properties (no
 * color, no icon), so a full grid would be pure overhead for what a scribe using this is
 * going to do 95% of the time - add or rename a line. Parses on blur so a half-typed line
 * mid-edit never produces a change event.
 */
@Component({
  selector: 'rangertrak-mission-recipients213',
  standalone: true,
  imports: [CommonModule, FormsModule, ...MATERIAL_IMPORTS],
  templateUrl: './mission-recipients213.component.html',
  styleUrls: ['./mission-recipients213.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionRecipients213Component implements OnChanges {
  @Input({ required: true }) options: string[] = []
  @Output() optionsChange = new EventEmitter<string[]>()

  // Maintainer ask (2026-09-22): the auto-print-213-on-submit setting, added here rather
  // than as a third @Input/@Output pair - this is the page's own 213 section, and unlike
  // `options` (which needs its own textarea parse/blur handling above) a plain boolean is
  // the exact shape mission-command-post's own `[form]="settingsForm"` pattern already
  // covers, so this component takes the whole form tree the same way rather than inventing
  // a second wiring style for one checkbox.
  @Input({ required: true }) form!: FieldTree<MissionType>

  /** The textarea's own working text - only reconciled with `options` on external change. */
  text = ''

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['options']) {
      this.text = this.options.join('\n')
    }
  }

  onBlur() {
    this.optionsChange.emit(this.parse(this.text))
  }

  onBtnRestoreStarterList() {
    this.text = DEFAULT_RECIPIENT_OPTIONS_213.join('\n')
    this.optionsChange.emit([...DEFAULT_RECIPIENT_OPTIONS_213])
  }

  private parse(raw: string): string[] {
    return raw.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  }
}
