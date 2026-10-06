import { CommonModule } from '@angular/common'
import { ApplicationRef, Component, OnInit, ChangeDetectionStrategy, inject } from '@angular/core'
import { RouterModule } from '@angular/router'
import { MatSnackBarModule } from '@angular/material/snack-bar'

import { CommandPostPublishService, LogService, StoragePersistenceService, UpdateService } from './shared/services'
import { HeaderComponent } from './shared/header/header.component'
import { NavbarComponent } from './shared/navbar/navbar.component'
import { FooterComponent } from './shared/footer/footer.component'
import { AlertsComponent } from './shared/alerts/alerts.component'
import { BackToTopComponent } from './shared/back-to-top/back-to-top.component'
import { StaleOriginNoticeComponent } from './shared/stale-origin-notice/stale-origin-notice.component'
import { GuideDrawerComponent } from './shared/guide/guide-drawer.component'
import { InstallUpdateComponent } from './shared/install-update/install-update.component'

@Component({
  selector: 'rangertrak-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatSnackBarModule,
    NavbarComponent,
    FooterComponent,
    BackToTopComponent,
    StaleOriginNoticeComponent,
    GuideDrawerComponent,
    InstallUpdateComponent
  ],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./app.component.scss']
})
// E-55: this used to also carry its own "Add to Home Screen" button - a fourth,
// undocumented install surface alongside the navbar's, Settings', and the footer's,
// with its own duplicate `beforeinstallprompt` @HostListener and `deferredPrompt`/
// `showButton` state instead of InstallableService. Unlike the other three (fixed by
// E-37), this one never hid itself after the app was actually installed, since it never
// listened for `appinstalled`. Removed - the navbar and footer both now render
// InstallUpdateComponent, which is real and correct.
export class AppComponent implements OnInit {

  private id = "AppComponent"
  private readonly appRef = inject(ApplicationRef)
  title = 'RangerTrak'
  pageDescr = `Track & map Rangers' progress & reports on a mission`

  constructor(
    private log: LogService,
    private updateService: UpdateService,
    private storagePersistence: StoragePersistenceService,
    // E-87 Stage 1: never called directly - injected here purely to force this
    // providedIn:'root' service to construct at app startup, same reason
    // storagePersistence is listed above. Its own constructor wires the subscriptions
    // that watch for commandPostEnabled and publish on every radio-log change.
    private commandPostPublish: CommandPostPublishService) {
  }



  ngOnInit() {
    // Request persistent storage once, at app startup, so a mission's
    // localStorage data is protected from silent eviction under storage
    // pressure. PRIVATE-Roadmap.md Section 8/R3. Most browsers grant/deny this
    // based on site-engagement heuristics rather than a user-facing prompt,
    // so there is nothing further to wait on here; the granted/denied
    // result is exposed via storagePersistence.persisted for any screen
    // (e.g. Settings) that wants to surface it.
    this.storagePersistence.requestPersistence()

    // Service-worker update handling lives in UpdateService: detect a new build,
    // tell the user, and activate + reload only when they accept. What was here
    // before built an Observable, never subscribed to it, and then tested the
    // Observable itself for truthiness - so it logged "App Updates ARE Available!"
    // on every single load and never actually updated anything.
    this.updateService.init()
  }

  /**
   * E-171, 2026-10-06 (PageSpeed mobile CLS 0.49, all of it on `rangertrak-page > main.main`).
   * RouterOutlet.activateWith() creates the routed component (location.createComponent) and
   * only calls markForCheck(), so the component's template runs in CREATION mode in one task
   * and its first UPDATE pass - where every `@if`, such as PageComponent's `@if (showHeader)`
   * around the ~137px pageHeader, and every binding is evaluated - waits for the zoneless
   * scheduler's next tick. Entry's update pass is ~130ms, and a frame can paint between the
   * two tasks: `main.main` at top 82 with no header, then 82 -> 219 when the header arrives.
   * Ticking here, still inside the activating task, means nothing paints until the page is
   * complete. The content is not hidden and nothing is deferred; the same work just runs
   * before the first frame rather than after it.
   */
  onRouteActivated(): void {
    try { this.appRef.tick() } catch { /* already inside a tick: the scheduled one will do it */ }
  }
}
