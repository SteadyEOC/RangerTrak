import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, EventEmitter, Output, signal } from '@angular/core'

import { MATERIAL_IMPORTS } from '../../../material-imports'
import { ExpandableSectionComponent } from '../../../shared/expandable-section/expandable-section.component'
import {
  BackupService, LogService, SampleDataService, StoragePersistenceService
} from '../../../shared/services/'
// Direct path, not the barrel above - see the note in rangers.component.ts.
import { DEFAULT_SAMPLE_SCENARIO, SAMPLE_SCENARIOS, SampleScenarioId } from '../../../shared/services/sample-data.service'

/**
 * Data safety (Storage Protection, Mission Backup) and the page's Danger Zone (reset
 * settings, Mission Restore, load sample data - all of which replace data already on the
 * device).
 *
 * Material-M3 pass 2026-08-25 split those two apart: they were one undifferentiated
 * "Advanced Options" block, so an unrecoverable "replaces everything on this device" import
 * looked exactly like the reversible export beside it. Sprint C split out of the 429-line mission.component template - see
 * mission.component.ts for the rest.
 *
 * The Font Explorium (a dev-time typography-comparison tool, not something a scribe in the
 * field has any reason to see) used to live here too - extracted 2026-08-20 to a standalone
 * font-explorium.html in the parent directory, outside the app entirely.
 *
 * Injects its own services directly (all `providedIn: 'root'`) rather than threading them
 * down as Inputs, since none of this section's actions need to hand anything back to the
 * parent except "reset defaults", which does affect sibling sections' displayed `settings`
 * and stays owned there.
 */
@Component({
  selector: 'rangertrak-mission-advanced-options',
  standalone: true,
  imports: [CommonModule, ExpandableSectionComponent, ...MATERIAL_IMPORTS],
  templateUrl: './mission-advanced-options.component.html',
  styleUrls: ['./mission-advanced-options.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class MissionAdvancedOptionsComponent {
  private id = 'Mission Advanced Options Component'

  @Output() resetDefaults = new EventEmitter<void>()

  constructor(
    private backupService: BackupService,
    private sampleDataService: SampleDataService,
    public storagePersistence: StoragePersistenceService,
    private log: LogService) { }

  onBtnRequestPersistence() {
    this.log.verbose('onBtnRequestPersistence: re-requesting persistent storage.', this.id)
    this.storagePersistence.requestPersistence()
  }

  /**
   * Downloads the current mission (settings + rangers + field reports) as a
   * single JSON file. See PRIVATE-Roadmap.md Section 8/R3.
   */
  onBtnExportMission() {
    // The backup bundles the full ranger roster, so it carries the same personal data as
    // the Rangers page warns about. E-122 Phase 1 made encrypting it optional, so this
    // now offers the choice rather than only warning about the consequence.
    if (!confirm(`Back up this mission to a file?\n\n`
      + `The file includes the full ranger roster - legal names, personal `
      + `phone numbers and call signs.\n\n`
      + `You will be offered a passphrase next. Either way, store the file `
      + `appropriately, share it only with people who need it for this mission, and `
      + `delete it when the mission is over.`)) {
      this.log.verbose('onBtnExportMission: user cancelled backup.', this.id)
      return
    }

    // Blank = unencrypted, which stays the default: a passphrase nobody can recover
    // destroys the mission record outright, and there is no server to reset it from.
    const passphrase = prompt(`Passphrase for this backup?\n\n`
      + `Leave blank for an UNENCRYPTED file (the previous behaviour).\n\n`
      + `If you set one it CANNOT be recovered - no reset, no support address, no `
      + `copy anywhere. Lose it and this backup is gone for good.`)

    if (passphrase === null) {
      this.log.verbose('onBtnExportMission: cancelled at the passphrase prompt.', this.id)
      return
    }

    // Typed twice on purpose. A typo here is not discovered until the day someone needs
    // the backup, by which time it is unrecoverable - the worst failure this can produce.
    if (passphrase !== '') {
      if (prompt('Type the same passphrase again to confirm it.') !== passphrase) {
        alert('Those did not match. Nothing was written - start the backup again.')
        this.log.warn('onBtnExportMission: passphrase confirmation did not match.', this.id)
        return
      }
    }

    this.log.verbose('onBtnExportMission: Backing up mission.', this.id)
    this.backupService.exportMission(passphrase || undefined)
      .catch(error => {
        this.log.error(`onBtnExportMission: backup failed: ${error.message}`, this.id)
        alert(`Could not write the backup: ${error.message}`)
      })
  }

  /**
   * Handles a file picked via the "Restore mission" <input type="file">.
   * Destructive - replaces current settings/rangers/field reports entirely -
   * so this confirms with the user before applying.
   */
  onImportFileSelected(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = '' // allow re-selecting the same file later

    if (!file) {
      return
    }

    this.backupService.readFileAsMissionExport(file, hint => prompt(
      `"${file.name}" is encrypted.\n\n`
      + (hint?.exportedAt ? `Backed up ${hint.exportedAt}` : 'Backed up on an unknown date')
      + (hint?.appVersion ? ` by RangerTrak ${hint.appVersion}` : '') + `.\n\n`
      + `Enter its passphrase to restore it.`))
      .then(async payload => {
        const summary = `Mission "${payload.settings.mission || '(unnamed)'}" backed up `
          + `${payload.exportedAt}, with ${payload.rangers.length} rangers and `
          + `${payload.radioLog.logEntries.length} field reports.`

        if (!confirm(`Restore this mission?\n\n${summary}\n\n`
          + `This REPLACES all current settings, rangers, and field reports on this device. `
          + `This cannot be undone - back up the current mission first if you want to keep it.`)) {
          this.log.verbose('onImportFileSelected: user cancelled restore.', this.id)
          return
        }

        // E-122 Phase 2a: awaited now - importMission() only resolves once rangers/radioLog/
        // locations have actually committed to IndexedDB (RecordStore.flush()), which the
        // reload() right below depends on. See importMission()'s own doc comment.
        await this.backupService.importMission(payload)
        this.log.warn(`Restored mission from ${file.name}.`, this.id)
        alert('Mission restored. Reloading to refresh every screen with the new data...')
        window.location.reload()
      })
      .catch(error => {
        this.log.error(`onImportFileSelected: failed to restore ${file.name}: ${error.message}`, this.id)
        alert(`Could not restore "${file.name}": ${error.message}`)
      })
  }

  /** Scenario picker for "Load sample mission" below - see SAMPLE_SCENARIOS' own comment. */
  readonly sampleScenarios = SAMPLE_SCENARIOS
  selectedScenario = signal<SampleScenarioId>(DEFAULT_SAMPLE_SCENARIO)

  /** One-line description of whichever scenario is currently selected in the picker above. */
  selectedScenarioHint(): string {
    return this.sampleScenarios.find(s => s.id === this.selectedScenario())?.hint ?? ''
  }

  /**
   * Loads the built-in demonstration mission. Destructive - replaces rangers, field reports,
   * and Locations - so it confirms first, matching onImportFileSelected().
   */
  async onBtnLoadSampleData(): Promise<void> {
    const scenario = this.selectedScenario()
    const label = this.sampleScenarios.find(s => s.id === scenario)?.label ?? scenario

    if (!confirm(`Load the "${label}" sample mission?\n\n`
      + `This REPLACES all rangers, field reports and locations currently on this device with `
      + `demonstration data, renames the mission to make that obvious, and moves the mission's `
      + `default location to the demo's command post.\n\n`
      + `This cannot be undone - back up the current mission first if you want to keep it.`)) {
      this.log.verbose('onBtnLoadSampleData: user cancelled.', this.id)
      return
    }

    await this.sampleDataService.loadSampleMission(scenario)
    this.log.warn(`Loaded the sample mission (demo data): ${scenario}.`, this.id)
    alert('Sample mission loaded. Reloading to refresh every screen with the new data...')
    window.location.reload()
  }
}
