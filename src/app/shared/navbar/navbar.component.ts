import { CommonModule } from '@angular/common'
import { Component, OnInit, ChangeDetectionStrategy, signal, effect } from '@angular/core'
import { NavigationEnd, NavigationError, NavigationStart, Router, RouterModule } from '@angular/router';
import { faL, faMapMarkedAlt } from '@fortawesome/free-solid-svg-icons'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatMenuModule } from '@angular/material/menu'
import { MDCTopAppBar } from '@material/top-app-bar'
// import { MatButton } from '@angular/material/button'
// import { MatButtonModule } from '@angular/material/button'
import { subscribeOn } from 'rxjs';
import { FieldModeService, LogService, MissionService, MissionType, RadioLogService, Skin, SKINS, SkinService, ThemeService } from '../services';
//https://material.io/components/app-bars-top/web#regular-top-app-bar

@Component({
  selector: 'rangertrak-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule, MatProgressBarModule, MatMenuModule],
  templateUrl: './navbar.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit {

  private settings!: MissionType
  private id = 'Navbar Component'

  // Mutated inside a raw this.router.events.subscribe() callback, not an Angular
  // template binding - this app is zoneless, so a plain field written there has no
  // guaranteed path back into change detection. Signals close that gap (Sprint G).
  // Rendered on every page.
  isNavigating = signal(false)
  faMapMarkedAlt = faMapMarkedAlt
  recycled = 0

  /**
   * 2026-08-26: phone-width nav links used to just wrap onto extra rows - a deliberate
   * stopgap noted in navbar.component.scss's own comment ("a real collapsed/hamburger
   * treatment is Sprint E's job") that was never revisited. This is that treatment: the
   * link list collapses behind a toggle button below bp.phone (575px), and stays exactly
   * as it was (a plain inline row, this signal never read) at every wider size.
   */
  navOpen = signal(false)

  toggleNav(): void {
    this.navOpen.set(!this.navOpen())
  }

  closeNav(): void {
    this.navOpen.set(false)
  }

  protected readonly skins = SKINS

  /**
   * 2026-09-28, John: drives the brand mark's event-triggered wave pulse (see the template's
   * own comment on the svg's rt-pulse-a/rt-pulse-b bindings). `pulseKey % 2` alternates which
   * of the two identically-styled classes is applied, so an already-finished CSS animation
   * restarts on the NEXT submitted report even though the animation-triggering class value at
   * rest never repeats twice in a row. Starts at 0 (class 'rt-pulse-a') so the animation also
   * plays once for free on initial page load - nothing needs to increment it for that case,
   * the class is just already there on first render.
   */
  pulseKey = signal(0)

  // Effects run once immediately on creation; that first run is the initial signal read, not
  // a real "a report was submitted" event, so it must not also bump pulseKey (page load
  // already gets its pulse for free from rt-pulse-a's presence on first render - counting
  // this too would be a redundant second pulse at boot).
  private pulseEffectRanOnce = false

  /**
   * 2026-09-28, John: AAR note - see the template's own comment on the skin-toggle button
   * for the root cause (focusing a `position: sticky` element scrolls to its static, not its
   * sticky, position). Captured on open rather than read fresh on close because the jump has
   * already happened by the time `menuClosed` fires - this is what's being restored TO, not
   * a live read of a value the jump has already clobbered.
   */
  private skinMenuScrollY = 0

  onSkinMenuOpened(): void {
    this.skinMenuScrollY = window.scrollY
  }

  onSkinMenuClosed(): void {
    // Only correcting the specific jump-to-static-position bug, not fighting anything else -
    // if the page was already at this Y (nothing to correct) this is a same-value no-op.
    if (window.scrollY !== this.skinMenuScrollY) {
      window.scrollTo(window.scrollX, this.skinMenuScrollY)
    }
  }

  constructor(
    private log: LogService,
    //private missionService: MissionService,
    private router: Router,
    protected theme: ThemeService,
    protected skin: SkinService,
    protected fieldMode: FieldModeService,
    private radioLog: RadioLogService
  ) {
    this.log.verbose("constructor", this.id)

    // 2026-09-28: fires the brand mark's wave pulse on every submitted radio log entry - see
    // pulseKey's own comment for why the first (creation-time) run is skipped.
    effect(() => {
      this.radioLog.reportSubmittedSignal()
      if (!this.pulseEffectRanOnce) { this.pulseEffectRanOnce = true; return }
      this.pulseKey.update(n => n + 1)
    })

    this.router.events.subscribe(
      (event) => {
        // https://angular.io/api/router/NavigationStart
        if (event instanceof NavigationStart) {
          // #81 (2026-09-27): an un-awaited Utility.sleep(100) used to sit here ("seems to
          // help page get properly loaded") - an unawaited promise delays nothing, so it was
          // removed, with a never-taken `if (false)` reload block below it.
          this.isNavigating.set(true)
          this.navOpen.set(false)
        }
        if (event instanceof NavigationEnd) {
          this.isNavigating.set(false)
        }
        if (event instanceof NavigationError) {
          // https://angular.io/api/router/NavigationError
          this.log.error(`Navigation Error event: to "${event.target?.toString()}" got "${event.toString()}"`, this.id)
          //this.isNavigating.set(false)

        }
      }
    )
  }

  ngOnInit(): void {
    this.log.info("ngOnInit", this.id)
  }
}
