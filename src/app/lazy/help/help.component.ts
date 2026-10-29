import { Subscription } from 'rxjs'

import { ChangeDetectionStrategy, Component, OnDestroy, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute } from '@angular/router'

import { PageComponent } from '../../shared/page/page.component'
import { buildSuffix } from '../../shared/build-stamp'

import { LogService, MissionService, MissionType } from '../../shared/services'

import { HelpAboutComponent } from './tabs/help-about.component'
import { HelpAfterMissionComponent } from './tabs/help-after-mission.component'
import { HelpStartComponent } from './tabs/help-start.component'
import { HelpFeedbackComponent } from './tabs/help-feedback.component'
import { HelpDataComponent } from './tabs/help-data.component'
import { HelpFaqComponent } from './tabs/help-faq.component'
import { HELP_SECTIONS, TOUR_URL } from '../../shared/guide/help-sections'
import { HelpSearchComponent } from '../../shared/guide/help-search.component'
import { slugForHelp } from '../../shared/guide/help-search'

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
    CommonModule, PageComponent,
    HelpAboutComponent, HelpStartComponent,
    HelpDataComponent, HelpAfterMissionComponent, HelpFeedbackComponent, HelpFaqComponent,
    HelpSearchComponent,
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
   *  "How?" link can land on "Your data" instead of always "Start here". Now taken from
   *  HELP_SECTIONS, which the Help drawer's navigation row also uses. */
  static readonly TAB_KEYS: readonly string[] = HELP_SECTIONS.map(s => s.key)
  readonly sections = HELP_SECTIONS
  readonly tourUrl = TOUR_URL
  public selectedIndex = signal(0)
  private routeSubscription: Subscription
  private fragmentSubscription: Subscription

  constructor(
    private log: LogService,
    private missionService: MissionService,
    route: ActivatedRoute,
  ) {
    // Subscribed, not read once from the snapshot: the Help drawer's section links also work
    // while /help is already showing, and the router reuses this component for those.
    this.routeSubscription = route.queryParamMap.subscribe(params => {
      const index = HelpComponent.TAB_KEYS.indexOf(params.get('tab') ?? '')
      if (index >= 0) {
        this.selectedIndex.set(index)
      }
    })
    // The router's own anchorScrolling runs before the chosen tab's content exists, so the
    // fragment is scrolled to here, once the tab has rendered. Its own stream, not read inside
    // the tab's: a Help search result on the tab already showing changes only the fragment.
    this.fragmentSubscription = route.fragment.subscribe(fragment => {
      if (fragment) {
        setTimeout(() => HelpComponent.revealFragment(fragment))
      }
    })

    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.settings = newMission
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id)
    })

    this.version = this.settings ? this.settings.version + buildSuffix() : '0'
  }

  /**
   * Scrolls to the element a `#fragment` names. The FAQ and Start-here answers are collapsed
   * expandable sections, so a link that lands on one must open it (and any section around it),
   * or the reader arrives at a closed heading.
   */
  static revealFragment(fragment: string): void {
    // E-264: a search result for a heading with no id links to a slug of the heading.
    const target = document.getElementById(fragment)
      ?? [...document.querySelectorAll('.help-tab-body h3, .help-tab-body rangertrak-expandable-section[summary]')]
        .find(el => slugForHelp(el.getAttribute('summary') ?? el.textContent ?? '') === fragment)
    if (!target) {
      return
    }
    for (let el: Element | null = target; el; el = el.parentElement) {
      if (el.tagName.toLowerCase() === 'rangertrak-expandable-section') {
        const header = el.querySelector(':scope > mat-expansion-panel > mat-expansion-panel-header') as HTMLElement | null
        if (header?.getAttribute('aria-expanded') === 'false') {
          header.click()
        }
      }
    }
    // E-264: not scrollIntoView, which put the heading under the sticky navbar. Same offset as
    // AppComponent gives the router's anchorScrolling, so the two land in the same place.
    const header = Math.ceil(document.querySelector('.app-sticky-header')?.getBoundingClientRect().bottom ?? 0)
    window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - header - 8)
  }

  ngOnDestroy() {
    this.missionSubscription?.unsubscribe()
    this.routeSubscription?.unsubscribe()
    this.fragmentSubscription?.unsubscribe()
  }
}
