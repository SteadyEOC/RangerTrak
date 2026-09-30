import { Injectable, signal } from '@angular/core'

/**
 * E-150: the Mission page's "Extra copies for the paper log" for ICS-213 printing.
 *
 * Deliberately in memory only - a signal that resets to 1 on page reload. The rc.1 storage
 * freeze (maintainer, "unsaved for now") forbids persisting anything new, so this is NOT a
 * MissionType/SettingsType field and never touches localStorage or backups.
 */
@Injectable({ providedIn: 'root' })
export class PrintCopiesService {
  static readonly DEFAULT_EXTRA = 1
  static readonly MAX_EXTRA = 9

  readonly extraCopies = signal(PrintCopiesService.DEFAULT_EXTRA)

  setExtraCopies(value: number): void {
    this.extraCopies.set(PrintCopiesService.clampExtra(value))
  }

  /** Total copies for one print job: the form itself plus the extras. */
  totalCopies(): number {
    return 1 + this.extraCopies()
  }

  static clampExtra(value: number): number {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) ? Math.min(PrintCopiesService.MAX_EXTRA, Math.max(0, n)) : PrintCopiesService.DEFAULT_EXTRA
  }
}
