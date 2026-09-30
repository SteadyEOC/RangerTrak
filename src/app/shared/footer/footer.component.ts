import { CommonModule, DOCUMENT, formatDate } from '@angular/common'
import { Component, Inject, ChangeDetectionStrategy } from '@angular/core'

import { FieldModeService, LogService, MissionService, UpdateService } from '../services'
import { InstallUpdateComponent } from '../install-update/install-update.component'

/**
 * Footer component
 */
@Component({
  selector: 'rangertrak-footer',
  standalone: true,
  imports: [CommonModule, InstallUpdateComponent],
  templateUrl: './footer.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./footer.component.scss']
})
export class FooterComponent {

  private id = 'Footer Component'

  today = new Date()

  /**
   * Read through to the service rather than snapshotting into a field in
   * ngOnInit, which is what this used to do. MissionService.settings reads a
   * signal, so the template picks up later emissions - Restore mission, Load
   * Sample Mission and Reset Settings all republish settings, and the old
   * snapshot left the footer showing the previous mission's version forever.
   */
  get version(): string {
    return this.missionService.settings?.version ?? ''
  }

  /** When the browser last confirmed this build was current. */
  get lastChecked(): string {
    return this.updateService.lastChecked()
  }

  /**
   * The update-check timestamp used to print in the footer as "(checked 8/15/26, 9:01 AM)".
   * It earned its place while R7 was unproven, but 19i confirmed the update path works
   * against the real deployment - so it is now a tooltip on the version instead of standing
   * text. The information is still one hover away, which matters when diagnosing a device
   * that has been offline: "when did this last reach the network?" is a real field question.
   */
  get versionTitle(): string {
    return this.lastChecked
      ? `Last checked for a newer version: ${formatDate(this.lastChecked, 'short', 'en-US')}`
      : 'This build has not yet checked for a newer version on this device'
  }

  /** E-161: read-only view of two existing facts, so an operator can tell what this device is. */
  get isFieldPhone(): boolean {
    return this.fieldMode.enabled()
  }

  get publishingToBoard(): boolean {
    return !!this.missionService.settings?.commandPostEnabled
  }

  get modeLabel(): string {
    return this.isFieldPhone ? 'Field phone' : 'Full app'
  }

  get modeTitle(): string {
    const device = this.isFieldPhone
      ? 'This device is set up as a ranger\'s field phone (Radio Log Entry and Help only).'
      : 'This device runs the full app.'
    const board = this.publishingToBoard
      ? 'It is sending this log to a RangerTrak Board.'
      : 'It is not sending this log to a RangerTrak Board.'
    return `${device} ${board}`
  }

  constructor(
    private log: LogService,
    private fieldMode: FieldModeService,
    private missionService: MissionService,
    private updateService: UpdateService,
    @Inject(DOCUMENT) private document: Document) {

    this.log.excessive(`======== Constructor() ============`, this.id)
  }
}
