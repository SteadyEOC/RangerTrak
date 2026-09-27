import { CommonModule } from '@angular/common'
import { Component, OnInit, ChangeDetectionStrategy, signal } from '@angular/core'
import { NavigationEnd, NavigationError, NavigationStart, Router, RouterModule } from '@angular/router';
import { faL, faMapMarkedAlt } from '@fortawesome/free-solid-svg-icons'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatMenuModule } from '@angular/material/menu'
import { MDCTopAppBar } from '@material/top-app-bar'
// import { MatButton } from '@angular/material/button'
// import { MatButtonModule } from '@angular/material/button'
import { subscribeOn } from 'rxjs';
import { FieldModeService, LogService, MissionService, MissionType, Skin, SKINS, SkinService, ThemeService } from '../services';
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

  constructor(
    private log: LogService,
    //private missionService: MissionService,
    private router: Router,
    protected theme: ThemeService,
    protected skin: SkinService,
    protected fieldMode: FieldModeService
  ) {
    this.log.verbose("constructor", this.id)

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
