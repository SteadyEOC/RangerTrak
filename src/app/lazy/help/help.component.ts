import { Subscription } from 'rxjs'

import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute } from '@angular/router'
import { MatTabsModule } from '@angular/material/tabs'

import { PageComponent } from '../../shared/page/page.component'

import { LogService, MissionService, MissionType } from '../../shared/services'

import { HelpAboutComponent } from './tabs/help-about.component'
import { HelpAfterMissionComponent } from './tabs/help-after-mission.component'
import { HelpStartComponent } from './tabs/help-start.component'
import { HelpFeedbackComponent } from './tabs/help-feedback.component'
import { HelpDataComponent } from './tabs/help-data.component'
import { HelpFaqComponent } from './tabs/help-faq.component'

/**
 * The in-app user documentation, and (E-84 decision, 2026-08-24) the canonical one: it ships
 * with the app, always matches the running version, and works with no connection - which is
 * the situation this product exists for. FIELD-GUIDE.md is now the pre-mission companion,
 * not a second copy of this.
 *
 * This page was one long scroll until E-84. That is how six shipped features (route trails,
 * per-ranger markers, base-layer switching, offline tile saving, the theme toggle, the
 * readiness dot) ended up documented nowhere at all - there was no obvious place to add
 * anything and no way to see what was already covered. Content now lives in sibling
 * components under ./tabs, one per tab. "Mission setup" merged into "Start here" as one
 * onboarding checklist (D-d, F29-32, 2026-08-29), and "After mission" split out of "Your
 * data" - a merge and a split that cancel out. "Log" (2026-08-27, so the Log page,
 * deliberately absent from the main nav, stayed easy to find) is now "Feedback" - it also
 * carries the feedback form, per the maintainer's own reasoning that reading/copying the log
 * is mostly a feedback-adjacent task. "Entering reports" and "Maps" (2026-08-30, live
 * request): moved into the Entry and Map pages' own Guide drawers instead - both were
 * screen-specific operating instructions, which is what the Guide (not general Help) is for;
 * see guide-content.ts.
 *
 * Content rule for anything added here, from the maintainer: keep it minimal, the UI should
 * be self-explanatory. These tabs deliberately cover only what a screen cannot say for
 * itself. Where the UI is NOT self-explanatory, the fix belongs in the UI.
 */
@Component({
  selector: 'rangertrak-help',
  standalone: true,
  imports: [
    CommonModule, PageComponent, MatTabsModule,
    HelpAboutComponent, HelpStartComponent,
    HelpDataComponent, HelpAfterMissionComponent, HelpFeedbackComponent, HelpFaqComponent,
  ],
  templateUrl: './help.component.html',
  styleUrls: ['./help.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  // Deliberately NOT providing MissionService: it is providedIn:'root' and a second
  // instance here would diverge from everyone else's - see entry.component.ts's own
  // fixed-2026-08-19 note on the same historical mistake.
})
export class HelpComponent implements OnDestroy {

  id = 'Help'
  private missionSubscription!: Subscription
  private settings!: MissionType
  public version = ''

  /** `?tab=` names, in tab order (help.component.html). E-124 added this so the map page's
   *  "How?" link can land on "Your data" instead of always "Start here". */
  static readonly TAB_KEYS = ['start', 'about', 'faq', 'data', 'after', 'feedback'] as const
  public selectedIndex = signal(0)

  constructor(
    private log: LogService,
    private missionService: MissionService,
    route: ActivatedRoute,
  ) {
    const tab = route.snapshot.queryParamMap.get('tab')
    const index = HelpComponent.TAB_KEYS.indexOf(tab as typeof HelpComponent.TAB_KEYS[number])
    if (index >= 0) {
      this.selectedIndex.set(index)
    }
    // The router's own anchorScrolling runs before the chosen tab's content exists, so the
    // fragment is scrolled to here, once the tab has rendered.
    const fragment = route.snapshot.fragment
    if (fragment) {
      setTimeout(() => document.getElementById(fragment)?.scrollIntoView())
    }

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.info('Settings Subscription complete', this.id)
    })

    this.version = this.settings ? this.settings.version : '0'
  }

  ngOnDestroy() {
    this.missionSubscription?.unsubscribe()
  }
}
