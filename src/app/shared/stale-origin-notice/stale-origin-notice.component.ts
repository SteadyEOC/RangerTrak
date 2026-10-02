import { CommonModule } from '@angular/common'
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'

import { UsageStateService } from '../services'

/**
 * E-45: `www.rangertrak.org` redirects to the canonical `rangertrak.org` at the Cloudflare
 * edge - but only for a request that actually reaches Cloudflare. A PWA bookmarked or
 * installed from `www.` *before* that redirect existed registered its own service worker at
 * that origin, which now intercepts navigation and serves its own stranded cache before any
 * HTTP-level redirect can fire. That visitor never reaches Cloudflare, never reaches the
 * canonical host, and - because UpdateService (E-43) deliberately never auto-reloads -
 * never gets prompted to update either. They're stuck.
 *
 * The only code that will ever run for that visitor is whatever shipped in that stranded
 * cache, which is why this has to be app code, not a server-side fix. It's a client-side
 * "you're on the wrong address" nudge, not a redirect - a service worker can't make the
 * BROWSER navigate to a different origin from inside itself without the visitor's own
 * action.
 *
 * DELIBERATELY TEMPORARY - not a permanent runtime cost. Affects only visitors who
 * bookmarked/installed from `www.` before the redirect existed, a shrinking population.
 * Added 2026-08-20; remove this component, its import/selector in app.component.ts/.html,
 * and its barrel export once affected users have plausibly migrated - a few months out,
 * call it early 2027, sooner if nobody's hit it. Don't wait for a formal removal ticket;
 * deleting a component you're confident is done is fine.
 */
@Component({
  selector: 'rangertrak-stale-origin-notice',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stale-origin-notice.component.html',
  styleUrls: ['./stale-origin-notice.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class StaleOriginNoticeComponent {

  private static readonly STALE_HOSTNAME = 'www.rangertrak.org'
  private static readonly CANONICAL_URL = 'https://rangertrak.org'

  readonly canonicalUrl = StaleOriginNoticeComponent.CANONICAL_URL

  /**
   * Session-only dismiss, not persisted. Deliberate: the point is a visitor who hasn't
   * migrated yet, and every fresh visit is another chance to catch them - a permanent
   * dismiss would defeat that for someone who closes it without reading closely, or whose
   * stranded install re-launches into a fresh session next time regardless.
   */
  private dismissed = signal(false)
  // E-168 (2026-10-01, John): not shown while real work is going on; back when it quiets down.
  private readonly usage = inject(UsageStateService)

  get isStaleOrigin(): boolean {
    return typeof window !== 'undefined' && window.location.hostname === StaleOriginNoticeComponent.STALE_HOSTNAME
  }

  get visible(): boolean {
    return this.isStaleOrigin && !this.dismissed() && !this.usage.quiet()
  }

  dismiss(): void {
    this.dismissed.set(true)
  }
}
