import { CommonModule } from '@angular/common'
import { Component, Input, ChangeDetectionStrategy } from '@angular/core'
import { RouterLink } from '@angular/router'

import { InstallableService, UpdateService } from '../services'
// E-122 Phase 2b: reload clears the in-memory encryption key (main.ts derives it fresh at
// unlock, and nothing persists it) - see the getter below for why this pill needs to know.
import { RecordStore } from '../storage/record-store'

/**
 * E-55: RangerTrak used to offer "install this app" and "a new version is ready" through
 * four different, unrelated implementations - the navbar's own button, Settings' own panel
 * (raw hex colors, a fixed 250px width, opacity:0.8 - see git history), the footer's update
 * indicator, and an entirely separate, never-cleaned-up "Add to Home Screen" button in
 * app.component.ts/.html with its own duplicate `beforeinstallprompt` listener and state
 * (which, unlike the other three, never hid itself after the app was actually installed -
 * InstallableService's `appinstalled` handling didn't apply to it because it wasn't using
 * InstallableService at all). This is the one component now used everywhere: navbar, footer,
 * and Settings all render this instead of their own bespoke markup.
 *
 * An update takes priority over an install offer when both are true at once - a stuck-on-
 * old-build incident (E-43) matters more than a missed install opportunity.
 *
 * E-57(1) simplification (2026-08-20): the compact form (navbar/footer) went back to a
 * v0.12-era shape - one small pill: an icon, a short label, done, no separate sentence next
 * to a separate CTA button. The maintainer, comparing mockups: "the install button can be
 * much simplified, as it used to be, say in version 11 or so" (see git history around
 * v0.12.0 for the actual shape this revives). Install and update-ready now share one pill
 * silhouette with only the icon/label/tint differing, so they visibly read as the same
 * affordance rather than two unrelated widgets.
 *
 * E-43's original top-sticky `[fixed]` banner is gone, replaced by `[stickyBottom]`, used
 * once, in footer.component.html: "I like the button on the bottom more than a bar. can it
 * go into the footer though?" `position: sticky; bottom: 0` on the footer's own instance
 * settles into normal flow once the real footer is reached and pins to the viewport bottom
 * otherwise - the same guarantee the old top banner made (visible regardless of scroll, so
 * a scribe deep in a tall Field Reports/Log page still sees it), without a second,
 * update-only instance living outside the footer. Because it's the footer's own instance
 * rather than a dedicated urgent-only one, it shows the install offer too, not just
 * update-ready - a small extra visibility win, not something asked for on its own.
 */
@Component({
  selector: 'rangertrak-install-update',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './install-update.component.html',
  styleUrls: ['./install-update.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class InstallUpdateComponent {

  private id = 'Install/Update Component'

  /** Settings gets the fuller explanation; navbar/footer get the compact pill only. */
  @Input() detailed = false

  /**
   * Raised live, 2026-08-27: Mission ended up showing two update bars at once once the
   * app-shell instance (app.component.html) was added above every page's own content -
   * Mission's own pre-existing `[detailed]` instance still showed the SAME update-ready
   * message a second time, right below it. Rather than just deleting one instance outright,
   * split what each surface is FOR: a scribe mid-incident needs a version-update prompt to
   * be impossible to miss (that's the whole point of the app-shell instance now being
   * everywhere), but an "install this app" offer is a different, lower-urgency thing that has
   * no business competing for attention on an incident-tracking page - it already has its own
   * unobtrusive home in the footer. `showUpdate`/`showInstall` (both default true, so the
   * footer/navbar's existing usage is unaffected) let each instance opt out of the HALF it
   * shouldn't show rather than the whole component: the app-shell instance sets
   * `[showInstall]="false"` (update only, everywhere), Mission's own instance sets
   * `[showUpdate]="false"` (install offer only, with its fuller explanation - the update half
   * is already covered app-wide).
   */
  @Input() showUpdate = true
  @Input() showInstall = true

  /**
   * The footer's own instance: `position: sticky; bottom: 0`, so it stays reachable
   * regardless of scroll position the same way the old top-fixed banner did - see the
   * class doc comment for why this replaced `[fixed]`.
   */
  @Input() stickyBottom = false

  constructor(
    private installableService: InstallableService,
    private updateService: UpdateService,
    private recordStore: RecordStore) { }

  get updateReady(): boolean {
    return this.updateService.updateReady()
  }

  /**
   * E-122 Phase 2b: whether reloading for this update will ask for the device passphrase
   * again. Reload clears the in-memory key the same way it clears everything else in memory -
   * there is nothing E-43-specific here, it is just the first place that matters enough to
   * say so out loud, since a scribe mid-mission should not be surprised by a lock screen they
   * did not expect.
   */
  get willAskForPassphrase(): boolean {
    return this.recordStore.isEncryptionEnabled()
  }

  get installable(): boolean {
    return this.installableService.installable()
  }

  onReload(): void {
    this.updateService.activateAndReload()
  }

  async onInstall(): Promise<void> {
    await this.installableService.promptInstall()
  }
}
