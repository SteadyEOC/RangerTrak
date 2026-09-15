import { Subscription, timer } from 'rxjs'

import { Component, Input, OnDestroy, OnInit, ChangeDetectionStrategy, inject, signal } from '@angular/core'
import { Router, RouterLink } from '@angular/router'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'

import {
  ClockService, LogService, MissionReadinessService, MissionService, MissionType, WelcomePanelService,
  OfflineBasemapService
} from '../services'
import { Utility } from '../'
import { MissionReadinessComponent } from '../mission-readiness/mission-readiness.component'
import { GuideService } from '../guide/guide.service'

/**
 * HaaderComponent
 * Displays a consistent line just below the NavBar, and above the component's main content
 *
 * Usage: To display this in your component add the following line to your (parent) template:
 *    <pageHeader [parentTitle]="title" [pageDescription]="pageDescr">...</pageHeader>
 * And the following in the parent component:
 *   title = 'Name of the (parent) Component'
 *   pageDescr = `Description of this page & purpose`
 */
@Component({
  selector: 'pageHeader',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MissionReadinessComponent],
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./header.component.scss']
})
export class HeaderComponent implements OnInit, OnDestroy {
  @Input() parentTitle: string
  @Input() pageDescription: string

  /**
   * The one Guide affordance. Lives here rather than on each page because this header is
   * already rendered by every routed page (via PageComponent), which is exactly the
   * property the redesign's "same place on every screen" rule needs. Hides itself on
   * routes with no guide content - see GuideService.available.
   */
  readonly guide = inject(GuideService)
  readonly readiness = inject(MissionReadinessService)
  readonly offlineBasemap = inject(OfflineBasemapService)

  private id = 'Header component'

  private missionSubscription!: Subscription
  private settings!: MissionType

  // Mutated from onNewSettings(), itself called from a raw RxJS subscribe() callback,
  // not an Angular template binding - this app is zoneless, so a plain field written
  // there has no guaranteed path back into change detection. Signals close that gap
  // (Sprint G). Rendered on every page, so a stale value here would be widely visible.
  public eventInfo = signal('')
  public opPeriod = signal('')

  // Raised live 2026-08-30: the pill was "nearly full width" and wrapped poorly on a real
  // screen once a mission name was long - eventInfo above (native `title` tooltip text,
  // since removed) was the only place this data ever showed. These back the hover panel
  // (.rt-mission-info-panel, header.component.html) instead: mission notes and the op-
  // period's actual date range are relatively STATIC (set once at mission setup) compared to
  // the live elapsed/left countdown that stays visible in the pill itself - moving the
  // static half into a hover-reveal panel is the actual width fix, not just a smaller font
  // or a second line, which would still have the same content fighting for space on every
  // page.
  public missionNotes = signal('')
  public opPeriodStartDisplay = signal('')
  public opPeriodEndDisplay = signal('')

  public opPeriodStart = new Date()

  // ROOT-CAUSED 2026-09-01, replacing the old `timeElapsed$`/`timeLeft$`/`timeCurrent`
  // Observables + `| async` template bindings: a live CDP trace showed the pill's clock
  // and elapsed/left text both rendering completely EMPTY at first paint and popping in
  // ~50ms later, even though both Observables already used `timer(0, 1000)` specifically
  // to emit "immediately." The fix that shipped 2026-08-26 (interval(1000) -> timer(0,
  // 1000)) closed a real, separate bug - the wait for a full 1000ms tick - but RxJS's
  // `timer(0, ...)` still schedules its "immediate" first value via a macrotask
  // (setTimeout(fn, 0) under the hood), not synchronously like a plain value would be -
  // so a browser paint committed before that macrotask runs still sees nothing bound yet,
  // no matter how early the Observable itself was created. These three signals are seeded
  // SYNCHRONOUSLY (in this constructor for the clock, in onNewSettings() below for
  // elapsed/left) with the correct current text before anything can ever paint, then kept
  // current by a plain 1-second interval - the interval only ever refreshes an
  // already-correct value, it's never depended on for the first one.
  public clockDisplay = signal('')
  public timeElapsedDisplay = signal('')
  public timeLeftDisplay = signal('')

  private clockSubscription?: Subscription
  private timeDisplaySubscription?: Subscription

  private static readonly MONTH_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]

  /** Matches the format the old `date: 'MMM d, HH:mm:ss'` pipe produced - hand-formatted
   *  rather than via Intl.DateTimeFormat, which has known hour12:false midnight quirks
   *  ("24:00" instead of "00:00" in some engines) this app's own time-picker component
   *  already avoids the same way (padStart, not Intl). */
  private formatClock(d: Date): string {
    const hh = d.getHours().toString().padStart(2, '0')
    const mm = d.getMinutes().toString().padStart(2, '0')
    const ss = d.getSeconds().toString().padStart(2, '0')
    return `${HeaderComponent.MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${hh}:${mm}:${ss}`
  }

  constructor(
    private clockService: ClockService,
    private log: LogService,
    private missionService: MissionService,
    private welcomePanel: WelcomePanelService,
    private router: Router,
  ) {
    //======== Constructor() ============
    this.clockDisplay.set(this.formatClock(new Date()))
    this.clockSubscription = this.clockService.getCurrentTime()
      .subscribe(d => this.clockDisplay.set(this.formatClock(d)))

    // consuming components should include their name, e.g.
    this.parentTitle = 'parent component`s title'
    this.pageDescription = 'parent component`s title'

    // ROOT-CAUSED 2026-09-01 (live CDP layout-shift trace against deployed 0.91.3): the
    // status-cluster pill (.header__right) was measured growing 186px -> 477px at t=627ms
    // - well after first paint, not "before anything is ever painted" as this file's own
    // ngOnInit() subscription was assumed to guarantee (see that comment). The 2026-08-26
    // timer(0,1000) fix above solved the ONE-SECOND gap inside onNewSettings() itself, but
    // did nothing for THIS outer gap: ngOnInit() genuinely doesn't run until well into the
    // page's own boot sequence (confirmed via the app's own verbose logs - this component's
    // "Received new Settings via subscription" landed after Entry's mini-map, location, and
    // datetime-picker children had already constructed), so onNewSettings() simply hadn't
    // run yet for that entire span, regardless of the ReplaySubject's synchronous-replay
    // guarantee once subscribed.
    //
    // MissionService.settings (mission.service.ts) is a plain synchronous getter, backed by
    // a signal MissionService's OWN constructor already populates (from localStorage or
    // hardcoded defaults) long before this component is created - other consumers already
    // depend on that guarantee (see that getter's own comment). Reading it here, synchronous
    // in THIS constructor rather than waiting on ngOnInit's subscription, covers the
    // overwhelmingly common case (a device that already has mission settings) with zero
    // shift, while leaving ngOnInit's subscription in place for a genuine fresh install
    // (where onNewSettings() correctly still fires only once real settings exist) and for
    // any later change while this component stays mounted. Calling onNewSettings() twice
    // with the same data (this seed, then the subscription's own synchronous replay) is
    // harmless - it only ever derives signals from its argument, no other side effects.
    if (this.missionService.settings) {
      this.onNewSettings(this.missionService.settings)
    }
  }

  ngOnInit(): void {
    this.missionSubscription = this.missionService.getMissionObserver().subscribe({
      next: (newMission) => {
        this.onNewSettings(newMission)
        this.log.excessive('Received new Settings via subscription.', this.id)
      },
      error: (e) => this.log.error('Settings Subscription got:' + e, this.id),
      complete: () => this.log.warn('Settings Subscription complete', this.id)
    })

    if (!this.settings) {
      this.log.warn(`Settings not yet available in OnInit()`, this.id)
      return
    }
  }

  onNewSettings(newMission: MissionType) {
    this.log.verbose(`New settings received`, this.id)

    this.settings = newMission
    // debugger
    // E-57(1): was always `#${mission}: ${event}`, so a settings object with neither set
    // yet (a fresh install, or before Settings has been filled in) rendered as the bare
    // literal "#:" - the isolated fragment visible in the maintainer's own live
    // screenshots. Empty until there's something real to show.
    const mission = this.settings.mission.trim()
    const event = this.settings.event.trim()
    this.eventInfo.set(mission || event ? `#${mission}: ${event}` : '')
    this.opPeriod.set(`${this.settings.opPeriod}`)
    this.missionNotes.set(this.settings.eventNotes.trim())
    // hour12: false - 24-hour clock throughout the app, not the locale default toLocaleString() would use.
    const timeOpts: Intl.DateTimeFormatOptions = {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
    }
    this.opPeriodStartDisplay.set(new Date(this.settings.opPeriodStart).toLocaleString([], timeOpts))
    this.opPeriodEndDisplay.set(new Date(this.settings.opPeriodEnd).toLocaleString([], timeOpts))

    // if (!this.settings.opPeriodStart) {
    //   console.error(`OpPeriod had no Start time! Reset to 2 hours ago...`, this.id)
    //   this.settings.opPeriodStart = new Date()
    //   this.settings.opPeriodStart.setHours(new Date().getHours() - 2)
    // }
    // this.log.verbose(`OpPeriodStart = ${JSON.stringify(this.settings.opPeriodStart)}`, this.id)

    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#calculating_elapsed_time
    //
    // E-44 audit follow-up, 2026-08-26: was interval(1000), which does NOT emit
    // immediately - its first value only arrives a full second after construction. That
    // fix (interval(1000) -> timer(0, 1000)) is now superseded, not reverted: 2026-09-01
    // root-caused that timer(0, 1000)'s own "immediate" emission is STILL a scheduled
    // macrotask, not synchronous, so a paint committed before that macrotask runs (which a
    // live CDP trace showed actually happening) still rendered `.opPeriod` empty. See
    // timeElapsedDisplay's own doc comment above for the full mechanism. updateTimeDisplays()
    // below is called once, synchronously, right here - not waiting on any timer tick for
    // its first value - and a plain 1-second interval only ever refreshes it afterward.
    let msStartTime = new Date(this.settings.opPeriodStart).getTime()
    let msEndTime = new Date(this.settings.opPeriodEnd).getTime()

    const updateTimeDisplays = () => {
      const elapsed = Utility.timeDiff(msStartTime, new Date().getTime())
      // Raised live 2026-08-30: "before period starts" was the single longest fragment in
      // the pill's op-period readout - shortened per the maintainer's own suggested wording.
      this.timeElapsedDisplay.set(`${elapsed.string} ${elapsed.negative ? ' until period' : ' elapsed'}`)

      const left = Utility.timeDiff(new Date().getTime(), msEndTime)
      this.timeLeftDisplay.set(`${left.string} ${left.negative ? ' since period ended' : ' left'}`)
    }
    updateTimeDisplays()

    // Re-seeding onNewSettings() (a genuine mission-settings change, or this constructor's
    // own synchronous pre-seed followed by ngOnInit's subscription replaying the same data)
    // must not stack a second interval on top of the first.
    this.timeDisplaySubscription?.unsubscribe()
    this.timeDisplaySubscription = timer(1000, 1000).subscribe(updateTimeDisplays)
  }

  /**
   * E-83: "clicking somewhere on the wide pill next to the Field Entry header should bring
   * it back up" - the status-cluster is shared/app-wide (every route renders HeaderComponent),
   * so rather than scoping this to Entry-only, clicking it from anywhere navigates to Entry
   * AND reopens the panel - a simpler, equally discoverable behavior than disabling the
   * click on every other route. Ignores clicks that landed on the readiness dot specifically
   * (its own `[routerLink]` already handles those) so the two don't both fire - still needed
   * even now that the dot is inert-on-touch (2026-08-31 fix), because it emits its own
   * `(dotActivated)` for that case (bound in the template, same `panelOpenOnTouch` toggle) -
   * without this exclusion, a touch tap on the dot would double-toggle (this handler once,
   * `dotActivated` once), netting no visible change.
   */
  /**
   * ADR D-32/F29-21, ported from MissionReadinessComponent (2026-08-30): that component is
   * only ever used here (inside this pill), and used to render its OWN separate hover
   * tooltip on just the dot - raised live as one hover panel with mission info AND
   * readiness together being clearer than two overlapping ones. Same six signals, same
   * route/fragment targets as that component's own `items` getter.
   */
  readonly readinessItems = () => {
    const r = this.readiness
    return [
      { ok: r.missionNamed(), label: 'Mission named', route: '/mission', fragment: 'readiness-mission-details' },
      { ok: r.rosterLoaded(), label: 'Real roster loaded', route: '/rangers', fragment: 'rangersgrid' },
      { ok: r.opPeriodCurrent(), label: 'Operating period current', route: '/mission', fragment: 'readiness-mission-details' },
      { ok: r.offlineTilesSaved(), label: 'Offline map tiles saved (Leaflet)', route: '/map', fragment: 'readiness-offline-tiles' },
      { ok: r.bundledMapWarmed(), label: this.mapWarmedLabel(), route: '/map', fragment: 'readiness-map-engine-switch' },
      { ok: r.storagePersisted(), label: 'Storage protected from eviction', route: '/mission', fragment: 'readiness-storage-protection' },
    ]
  }

  /** 2026-09-14 (offline map coverage scoping, Q6 YES addendum): the merged world+Vashon
   *  archive this row's "warmed" check now waits on is ~16 MB, not 1.7 MB - worth surfacing
   *  progress rather than leaving the row reading "not ready yet" with no indication
   *  anything is happening. `downloadProgress()` is null outside an active download, so this
   *  falls back to the plain label everywhere except the moments a fetch is actually in
   *  flight (see OfflineBasemapService.warm()). */
  private mapWarmedLabel(): string {
    const pct = this.offlineBasemap.downloadProgress()
    return pct === null ? 'Alternative map warmed (MapLibre)' : `Downloading offline world map… ${pct}%`
  }

  // Raised live 2026-08-30: "do phone users need unique directions for navigation and
  // clicking?" - a real question, prompted by the hover-reveal panel just added above. A
  // touch device has no true hover state, and a plain click-handler element with a hover-
  // revealed child is exactly the pattern that makes iOS Safari treat a first tap as hover-
  // only (no click fires) - so the SAME tap that should show mission info would also, on
  // other browsers, immediately navigate away before the panel could ever be seen.
  //
  // matchMedia('(hover: none)') identifies touch input specifically (not narrow SCREENS -
  // a touch laptop with a mouse still reports hover:hover), so this only changes behaviour
  // where hovering to preview the panel was never possible in the first place. On such a
  // device, tapping the pill toggles the panel instead of navigating - a real nav link to
  // Entry already exists for the primary way to get there, so trading away this pill's
  // navigation shortcut (never the only path) for actually being able to see mission
  // status on a phone is the right trade.
  panelOpenOnTouch = signal(false)
  private readonly isTouchOnly = () => matchMedia('(hover: none)').matches

  onStatusClusterClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('.readiness-dot')) return
    if (this.isTouchOnly()) {
      this.panelOpenOnTouch.set(!this.panelOpenOnTouch())
      return
    }
    this.welcomePanel.show()
    this.router.navigateByUrl('/')
  }

  ngOnDestroy() {
    // Note the parentheses: this read the property without calling it, so the header -
    // which every page instantiates - never actually released its settings subscription.
    this.missionSubscription?.unsubscribe()
    this.clockSubscription?.unsubscribe()
    this.timeDisplaySubscription?.unsubscribe()
  }
}
