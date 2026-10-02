import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core'

import { MATERIAL_IMPORTS } from '../../material-imports'
import { LogService, MissionService, UsageStateService } from '../services'
// Direct path, not the barrel - see the note in rangers.component.ts.
import {
  DEFAULT_SAMPLE_SCENARIO, SAMPLE_SCENARIOS, SampleDataService, SampleScenarioId
} from '../services/sample-data.service'
import { confirmReplaceMission } from './replace-guard'

/**
 * E-168 (2026-10-01, John): the demo scenario picker plus its Load button, in one place. It
 * used to be copied into Entry, Mission > Advanced and Rangers, each with its own confirm text
 * and reload; they now all use this, so a demo is loaded and guarded the same way everywhere
 * (and in a live mission the guard is the stronger one in replace-guard.ts).
 */
@Component({
  selector: 'rangertrak-demo-picker',
  standalone: true,
  imports: [...MATERIAL_IMPORTS],
  templateUrl: './demo-picker.component.html',
  styleUrls: ['./demo-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DemoPickerComponent {
  private id = 'Demo Picker Component'

  /** Text of the Load button. The Mission page's e2e and tools find it by "Load sample mission". */
  readonly buttonLabel = input('Load sample mission')
  /** Shows the one-line description of the chosen scenario under the picker. */
  readonly showHint = input(false)
  /** Red button, for inside Mission's Danger zone fence (this page's other replace actions are red). */
  readonly danger = input(false)

  readonly scenarios = SAMPLE_SCENARIOS
  readonly selected = signal<SampleScenarioId>(DEFAULT_SAMPLE_SCENARIO)

  constructor(
    private sampleData: SampleDataService,
    private usage: UsageStateService,
    private missionService: MissionService,
    private log: LogService,
  ) { }

  hint(): string {
    return this.scenarios.find(s => s.id === this.selected())?.hint ?? ''
  }

  async onLoad(): Promise<void> {
    const scenario = this.selected()
    const label = this.scenarios.find(s => s.id === scenario)?.label ?? scenario
    const state = this.usage.state()

    // An empty device has nothing to replace, so no question (the Entry welcome panel's old
    // behaviour); every other state confirms, and a live mission confirms hard.
    if (state !== 'empty' && !confirmReplaceMission({
      state,
      missionName: this.missionService.settings.mission,
      message: `Load the "${label}" sample mission?\n\n`
        + `This REPLACES all rangers, radio log entries and locations currently on this device with `
        + `demonstration data, renames the mission to make that obvious, and moves the mission's `
        + `default location to the demo's command post.\n\n`
        + `This cannot be undone - back up the current mission first if you want to keep it.`,
    })) {
      this.log.verbose('onLoad: user cancelled.', this.id)
      return
    }

    await this.sampleData.loadSampleMission(scenario)
    this.log.warn(`Loaded the sample mission (demo data): ${scenario}.`, this.id)
    if (state !== 'empty') alert('Sample mission loaded. Reloading to refresh every screen with the new data...')
    window.location.reload()
  }
}
