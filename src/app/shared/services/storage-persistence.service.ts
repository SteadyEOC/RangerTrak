import { Injectable, signal } from '@angular/core'

import { LogService } from './log.service'

/**
 * Requests persistent storage (protects localStorage from being silently
 * evicted under browser storage pressure - PRIVATE-Roadmap.md Section 8/R3) and
 * exposes the current grant state as a signal.
 *
 * `persisted()` state meaning:
 *   - `true`  - storage is protected; the browser should not clear it
 *               without the user's explicit action.
 *   - `false` - not (yet) protected; a request was made and denied, or has
 *               not been made yet.
 *   - `null`  - unsupported by this browser (Storage API not present).
 */
@Injectable({ providedIn: 'root' })
export class StoragePersistenceService {

  private id = 'Storage Persistence Service'

  private persistedSignal = signal<boolean | null>(null)
  readonly persisted = this.persistedSignal.asReadonly()

  constructor(private log: LogService) {
    this.refreshStatus()
  }

  /** Re-checks the current grant state without prompting/requesting anything. */
  async refreshStatus(): Promise<void> {
    if (!navigator.storage?.persisted) {
      this.persistedSignal.set(null)
      return
    }
    const result = await navigator.storage.persisted()
    this.persistedSignal.set(result)
  }

  /**
   * Requests persistent storage. Most browsers grant this silently based on
   * site engagement heuristics (installed PWA, bookmarked, frequently
   * visited) rather than prompting the user - there is no dedicated UI
   * permission dialog to wait for in most implementations.
   */
  async requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) {
      this.log.warn('This browser cannot keep data persistently (navigator.storage.persist is not supported).', this.id)
      this.persistedSignal.set(null)
      return false
    }
    const granted = await navigator.storage.persist()
    this.persistedSignal.set(granted)
    this.log.info(`Persistent storage ${granted ? 'granted' : 'denied'}.`, this.id)
    return granted
  }
}
