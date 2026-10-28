import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { RouterModule } from '@angular/router'
import { A11yModule } from '@angular/cdk/a11y'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatTabsModule } from '@angular/material/tabs'

import { GuideService } from './guide.service'
import { renderGuideText } from './guide-render'
import { HELP_SECTIONS, TOUR_URL } from './help-sections'
// The /help page's tab components, shown in the drawer when a section pill is chosen. Used
// only inside @defer, so they load as their own chunk, not with the app shell.
import { HelpAboutComponent } from '../../lazy/help/tabs/help-about.component'
import { HelpAfterMissionComponent } from '../../lazy/help/tabs/help-after-mission.component'
import { HelpDataComponent } from '../../lazy/help/tabs/help-data.component'
import { HelpFaqComponent } from '../../lazy/help/tabs/help-faq.component'
import { HelpFeedbackComponent } from '../../lazy/help/tabs/help-feedback.component'
import { HelpStartComponent } from '../../lazy/help/tabs/help-start.component'

/**
 * The one Guide drawer, rendered once in app.component.html and opened by the Guide button
 * in every page header. Holds the reference material that used to sit permanently in each
 * page's main column as `<rangertrak-section>` blocks - see guide-content.ts for the full
 * reasoning and for the content itself.
 *
 * Built from a plain fixed-position `<aside>` plus `cdkTrapFocus` rather than
 * `mat-sidenav`: a sidenav requires wrapping the entire application in
 * `<mat-sidenav-container>`, which takes over the app's scrolling and layout - a large,
 * app-wide structural change to gain a panel that slides. The CDK focus trap is the part
 * that actually matters for accessibility, and it is available on its own.
 *
 * Deliberately NOT a `mat-dialog`: a dialog is modal and demands a decision. This is
 * reference material read alongside the screen it describes, so the page stays visible and
 * scrollable behind it on a wide window.
 */
@Component({
  selector: 'rangertrak-guide-drawer',
  standalone: true,
  imports: [
    CommonModule, RouterModule, A11yModule, MatButtonModule, MatIconModule, MatTabsModule,
    HelpStartComponent, HelpAboutComponent, HelpFaqComponent, HelpDataComponent,
    HelpAfterMissionComponent, HelpFeedbackComponent,
  ],
  templateUrl: './guide-drawer.component.html',
  styleUrls: ['./guide-drawer.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager
})
export class GuideDrawerComponent {
  readonly guide = inject(GuideService)
  private readonly sanitizer = inject(DomSanitizer)

  readonly sections = HELP_SECTIONS
  readonly tourUrl = TOUR_URL

  /** renderGuideText() already escapes everything but its own `<a>` output, so this is safe. */
  renderText(text: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(renderGuideText(text))
  }

  /**
   * Escape closes the drawer. Bound on the document rather than the panel so it works
   * regardless of which element inside the trap has focus, and guarded on `isOpen` so this
   * component never swallows Escape for anything else on the page (the map's full-screen
   * mode and every mat-select overlay also listen for it).
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.guide.isOpen()) {
      this.guide.close()
    }
  }
}
