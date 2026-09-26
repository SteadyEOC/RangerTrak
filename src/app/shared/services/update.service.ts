import { filter } from "rxjs"

import { Injectable, signal } from "@angular/core"
import { MatSnackBar } from "@angular/material/snack-bar"
import { SwUpdate, VersionReadyEvent } from "@angular/service-worker"

import { LogService } from "./log.service"
import { recordStore } from "../storage/record-store"

// Based on: https://angular.io/guide/service-worker-communications

const LAST_CHECKED_KEY = 'updateLastChecked'

/**
 * Owns the service-worker update lifecycle: detect a new build, tell the user,
 * and - only on their say-so - activate it and reload.
 *
 * This used to be three console.warn()s and nothing else, so an installed copy
 * kept serving its cached build indefinitely: after 0.13.0 shipped, browsers
 * still rendered 0.12.0. A scribe unknowingly running a months-old build during
 * an incident is the failure this prevents (PRIVATE-Roadmap.md Section 8/R7).
 *
 * The reload is never automatic. Yanking the page out from under someone who is
 * mid-report would lose the report.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {

  private id = 'Update Service'

  /**
   * True once a newer build is downloaded and waiting. Exposed as a signal so
   * the footer can show a persistent "update ready" indicator - a snackbar can
   * be dismissed and missed, and R7 asks for a visible standing indicator.
   */
  public readonly updateReady = signal(false)

  /** When the browser last confirmed this build was current (ISO string), or ''. */
  public readonly lastChecked = signal(localStorage.getItem(LAST_CHECKED_KEY) ?? '')

  constructor(
    private updates: SwUpdate,
    private snackbar: MatSnackBar,
    private log: LogService) { }

  /**
   * Called once from AppComponent. Not done in the constructor: this service is
   * providedIn root and tree-shaken until injected, and subscribing as a side
   * effect of construction makes the wiring invisible at the call site.
   */
  public init(): void {
    if (!this.updates.isEnabled) {
      // Normal in `ng serve` and in any browser without service-worker support.
      this.log.info(`Service worker not enabled; no update checks will run.`, this.id)
      return
    }

    // Logged unconditionally so the Log page can answer "is update checking even
    // armed?" after a deploy. Without it, an update flow that never fires and one
    // that fires and finds nothing look identical - silence.
    this.log.info(`Update checks armed; watching for new versions.`, this.id)

    this.updates.versionUpdates.subscribe(evt => {
      switch (evt.type) {
        case 'VERSION_DETECTED':
          this.log.info(`Downloading new app version: ${evt.version.hash}`, this.id)
          break
        case 'NO_NEW_VERSION_DETECTED':
          this.recordCheck()
          break
        case 'VERSION_READY':
          this.log.info(`New app version ready: ${evt.latestVersion.hash} (running ${evt.currentVersion.hash})`, this.id)
          break
        case 'VERSION_INSTALLATION_FAILED':
          this.log.error(`Failed to install app version '${evt.version.hash}': ${evt.error}`, this.id)
          break
      }
    })

    // E-57(1) follow-up: this used to also open a MatSnackBar here ("A new version of
    // RangerTrak is available", duration: 0) - a third surface for the same notice
    // alongside the navbar and footer's InstallUpdateComponent instances. Maintainer:
    // "New version available shows up in three places. 1 is probably enough. (footer)."
    // updateReady=true already drives the footer's [stickyBottom] instance, which
    // guarantees visibility regardless of scroll and has its own "Reload now" action
    // (activateAndReload(), called directly) - the snackbar was fully redundant with it.
    this.updates.versionUpdates.pipe(
      filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'),
    ).subscribe(() => {
      this.updateReady.set(true)
      this.recordCheck()
    })

    // The service worker checks on registration and periodically after; this
    // makes the first check explicit so `lastChecked` is populated on a fresh load.
    this.updates.checkForUpdate()
      .then(foundNew => {
        this.recordCheck()
        this.log.verbose(`Update check complete; new version found: ${foundNew}`, this.id)
      })
      .catch(e => this.log.error(`Update check failed: ${e}`, this.id))
  }

  /**
   * Swap in the waiting build and reload. Public so the footer's standing
   * indicator can trigger it too, for a user who dismissed the snackbar.
   */
  public async activateAndReload(): Promise<void> {
    try {
      await this.updates.activateUpdate()
      // E-122 Phase 2a: a report saved moments ago may still be queued for IndexedDB.
      await recordStore.flush()
      this.log.info(`New version activated; reloading.`, this.id)
      location.reload()
    } catch (e) {
      // Most often "Service workers are disabled or not supported by this browser".
      this.log.error(`Could not activate the new version: ${e}`, this.id)
      this.snackbar.open('Could not install the update. Try reloading the page (Ctrl+Shift+R).', 'Dismiss')
    }
  }

  private recordCheck(): void {
    const now = new Date().toISOString()
    localStorage.setItem(LAST_CHECKED_KEY, now)
    this.lastChecked.set(now)
  }
}
