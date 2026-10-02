import { ChangeDetectionStrategy, Component, OnInit, input, signal } from '@angular/core'

import { MATERIAL_IMPORTS } from '../../material-imports'
import { LogService, MissionService, UsageStateService } from '../services'
// Direct path, not the barrel - see the note in rangers.component.ts.
import {
  DEFAULT_SAMPLE_SCENARIO, SAMPLE_SCENARIOS, SampleDataService, SampleScenarioId
} from '../services/sample-data.service'
import { activeDemoScenario } from '../mapping/demo-map'
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
export class DemoPickerComponent implements OnInit {
  private id = 'Demo Picker Component'

  /** Text of the Load button. The Mission page's e2e and tools find it by "Load sample mission". */
  readonly buttonLabel = input('Load sample mission')
  /** Shows the one-line description of the chosen scenario under the picker. */
  readonly showHint = input(false)
  /** Red button, for inside Mission's Danger zone fence (this page's other replace actions are red). */
  readonly danger = input(false)

  /**
   * 2026-10-02, John: "Is that button necessary?" Picking a demo now loads it (after the usual
   * confirm) everywhere except Mission > Danger zone, which keeps an explicit red button: it is
   * the page's deliberate place for replace actions, and the tools that load demos click it.
   */
  readonly withButton = input(false)
  /** The field's label, e.g. "Switch demo" while one is loaded, "Load a demo" on an empty device. */
  readonly label = input('Demo scenario')

  readonly scenarios = SAMPLE_SCENARIOS
  // 2026-10-02, John: show the demo that is actually loaded, not always the default. With a
  // button, an empty device still starts on the default; without one, nothing is preselected,
  // so any pick is a real choice.
  private readonly loaded = activeDemoScenario()
  readonly selected = signal<SampleScenarioId | null>(null)

  // Inputs are not set yet when field initializers run, so the starting value is chosen here.
  ngOnInit(): void {
    this.selected.set(this.loaded ?? (this.withButton() ? DEFAULT_SAMPLE_SCENARIO : null))
  }

  /** Pick-to-load: a different scenario loads at once; the one already loaded does nothing. */
  async onPick(scenario: SampleScenarioId): Promise<void> {
    if (this.withButton()) {
      this.selected.set(scenario)
      return
    }
    if (scenario === this.loaded) return
    this.selected.set(scenario)
    if (!await this.onLoad()) this.selected.set(this.loaded) // cancelled: show what is loaded
  }

  constructor(
    private sampleData: SampleDataService,
    private usage: UsageStateService,
    private missionService: MissionService,
    private log: LogService,
  ) { }

  hint(): string {
    return this.scenarios.find(s => s.id === this.selected())?.hint ?? ''
  }

  /** Returns false if the operator cancelled. */
  async onLoad(): Promise<boolean> {
    const scenario = this.selected()
    if (!scenario) return false
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
      return false
    }

    await this.sampleData.loadSampleMission(scenario)
    this.log.warn(`Loaded the sample mission (demo data): ${scenario}.`, this.id)
    if (state !== 'empty') alert('Sample mission loaded. Reloading to refresh every screen with the new data...')
    window.location.reload()
    return true
  }
}
