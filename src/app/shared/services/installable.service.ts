import { Injectable, signal } from '@angular/core'

/**
 * Whether this app can be installed on this device, and doing it.
 *
 * E-37. Three surfaces offered installation - the footer's "Add to Home Screen", the
 * navbar's "Install", and Settings' install panel - through three unrelated mechanisms, and
 * two of them did nothing at all:
 *
 *  - `installableEvent` started as `1`, a truthy sentinel, so `isInstallable` was true
 *    before any event fired. Both surfaces showed unconditionally, including in browsers
 *    that never offer installation and on devices where the app was already installed.
 *  - The navbar and Settings buttons used the HTML attribute `onclick="onInstallBtn()"`
 *    rather than Angular's `(click)`, so the click resolved against `window`, where no such
 *    function exists. `NavbarComponent.onInstallBtn()` was never reached - and its body was
 *    `//! TODO: Implement me!!!` anyway.
 *  - `showPrompt()` opened a confirmation dialog whose actual `prompt()` call was commented
 *    out, so even the reachable path could not install anything.
 *
 * Nothing anywhere listened for `appinstalled` or checked `display-mode`, so the app never
 * knew whether it was already installed.
 *
 * This is now the one place that knows. Install and update stay separate concepts - updates
 * are UpdateService/SwUpdate's job (R7) - but they are both about "is this device running
 * the right thing", so they belong side by side in the UI, not in three unrelated corners.
 */

/** The non-standard event Chromium fires when a PWA meets the install criteria. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

@Injectable({ providedIn: 'root' })
export class InstallableService {

  /** The stashed event, or null when the browser has not offered installation. */
  private deferred: BeforeInstallPromptEvent | null = null

  /** Signals so templates react without a manual subscription. */
  readonly installable = signal(false)
  readonly installed = signal(false)

  constructor() {
    // Already running as an installed app? Then never offer to install it again.
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.installed.set(window.matchMedia('(display-mode: standalone)').matches
        // iOS Safari predates display-mode and uses this instead.
        || (window.navigator as any).standalone === true)
    }

    window.addEventListener('beforeinstallprompt', (e: Event) => {
      // Stop the mini-infobar so the app chooses when to ask.
      e.preventDefault()
      this.deferred = e as BeforeInstallPromptEvent
      this.installable.set(!this.installed())
    })

    // The missing half: once installed, every "Install" affordance must disappear.
    window.addEventListener('appinstalled', () => {
      this.deferred = null
      this.installed.set(true)
      this.installable.set(false)
    })
  }

  /**
   * E-160: short manual steps for browsers that can install the app but never fire
   * `beforeinstallprompt` (Firefox on Android, Safari on iPhone/iPad). Null when the app is
   * already installed, when the browser offered a real prompt, or for any other browser.
   */
  manualInstallHint(): string | null {
    if (this.installed() || this.installable()) {
      return null
    }
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    if (/Android/i.test(ua) && /Firefox|FxiOS/i.test(ua)) {
      return 'To install: open the browser menu (⋮) and choose Add to Home screen (or Install).'
    }
    const iOS = /iPhone|iPad|iPod/i.test(ua)
    if (iOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) {
      return 'To install: tap Share, then Add to Home Screen.'
    }
    return null
  }

  /**
   * Shows the browser's own install prompt. Resolves to what the user chose, or
   * 'unavailable' when there was nothing to prompt with.
   *
   * The event is single-use: after prompting, it is spent whatever the answer, which is why
   * the affordance is hidden afterwards rather than left to fail silently on a second click.
   */
  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = this.deferred
    if (!event) {
      return 'unavailable'
    }

    this.deferred = null
    this.installable.set(false)

    await event.prompt()
    const { outcome } = await event.userChoice

    // A dismissal is not a refusal forever - the browser may offer again this session, and
    // if it does, beforeinstallprompt fires and installable goes true again.
    return outcome
  }
}
