import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, Input, computed, inject } from '@angular/core'
import { FieldTree, FormField } from '@angular/forms/signals'

import { COORDINATE_FORMATS, CoordinateFormat, defaultCoordinateFormat } from '../../../domain/coordinate'
import { MissionType, RadioLogService } from '../../../shared/services/'
import { DevicePrefsService } from '../../../shared/services/device-prefs.service'
import { bearingAndDistance } from '../../../domain/coordinate'
import { isUsablePoint } from '../../../domain/far-location'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatCardModule } from '@angular/material/card'
import { MatButtonToggleModule } from '@angular/material/button-toggle'

/**
 * Location Defaults (lat/lng) and the coordinate systems Entry offers. Sprint C split out of the
 * 429-line mission.component template - see mission.component.ts. defPlusCode and
 * w3wLocale used to live here too - both removed 2026-08-25 as dead controls (E-89/E-90).
 */
@Component({
  selector: 'rangertrak-mission-location-section',
  standalone: true,
  imports: [CommonModule, FormField, MatFormFieldModule, MatInputModule, MatCardModule, MatButtonToggleModule],
  templateUrl: './mission-location-section.component.html',
  styleUrls: ['./mission-location-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionLocationSectionComponent {
  @Input({ required: true }) form!: FieldTree<MissionType>
  @Input({ required: true }) settings!: MissionType

  private radioLog = inject(RadioLogService)

  /**
   * E-296 (11-14 drill): a new default location under an old mission's reports. The maps fit to every report in
   * the log, so Grand Canyon reports kept pulling the map away from a new Vashon default. Counts the reports more
   * than 50 km from the default being typed, so the card can say why and point at Start the next mission.
   */
  readonly farReports = computed(() => {
    const lat = Number(this.form?.defLat?.().value())
    const lng = Number(this.form?.defLng?.().value())
    if (!isUsablePoint({ lat, lng })) return 0
    return (this.radioLog.getCurrentRadioLog()?.logEntries ?? [])
      .filter(e => isUsablePoint(e.location) && bearingAndDistance(lat, lng, e.location.lat, e.location.lng).distanceMeters > 50_000)
      .length
  })

  /**
   * 2026-08-26 (maintainer): "Default coordinate format for Entry" becomes a real
   * single-choice radio group instead of five independent checkboxes that only happened to
   * behave like one (location.component.ts's preferredSystems() already picked just the
   * first checked one - see this section's own template comment). Maidenhead drops out of
   * the set entirely here: it was never one of the five switchable coordinate systems
   * (LocationComponent.SYSTEM_ORDER), just a sixth checkbox riding along in the same grid.
   * Backed by the same five boolean fields (no schema change) - mat-radio-group is a
   * Material CVA component, so [value]/(change) here rather than [formField], same reason
   * as the mat-checkbox group this replaces.
   */
  readonly coordFormats = COORDINATE_FORMATS

  currentDefaultFormat(): CoordinateFormat {
    return defaultCoordinateFormat({
      showDD: this.form.showDD().value(), showDDM: this.form.showDDM().value(), showDMS: this.form.showDMS().value(),
      showMGRS: this.form.showMGRS().value(), showUTM: this.form.showUTM().value(),
    })
  }

  private devicePrefs = inject(DevicePrefsService)

  /**
   * E-329 (tester feedback 2026-11-19): also becomes this device's remembered Entry format. That
   * remembered format outranks the mission default (E-114 §1a), so a device that once tapped DD in
   * Full menus kept opening on DD after the mission was set to UTM - with no picker in Easy menus.
   * Picking here is the most recent choice made on this device, so it wins here too.
   */
  selectDefaultFormat(system: CoordinateFormat): void {
    this.devicePrefs.setLastCoordinateFormat(system)
    this.form.showDD().value.set(system === 'DD')
    this.form.showDDM().value.set(system === 'DDM')
    this.form.showDMS().value.set(system === 'DMS')
    this.form.showMGRS().value.set(system === 'MGRS')
    this.form.showUTM().value.set(system === 'UTM')
  }
}
