import { computed, inject, Injectable } from '@angular/core'
import { MissionService } from './mission.service'

/**
 * E-150: the Mission page's "Extra copies for the paper log" for ICS-213 printing.
 *
 * The value is a SAVED mission setting, `MissionType.extraCopies213` (valid 0-9, default 1),
 * so it survives reloads and travels in mission backups. Saved under the maintainer's explicit
 * rc.1 storage-clock exception (2026-09-30). This service is just the read side: it exposes
 * the saved value, clamped, plus the total-copies arithmetic. The Mission page writes the field.
 */
@Injectable({ providedIn: 'root' })
export class PrintCopiesService {
  static readonly DEFAULT_EXTRA = 1
  static readonly MAX_EXTRA = 9

  private missionService = inject(MissionService)

  readonly extraCopies = computed(() => {
    const saved = this.missionService.settings?.extraCopies213
    return saved === undefined ? PrintCopiesService.DEFAULT_EXTRA : PrintCopiesService.clampExtra(saved)
  })

  /** Total copies for one print job: the form itself plus the extras. */
  totalCopies(): number {
    return 1 + this.extraCopies()
  }

  static clampExtra(value: number): number {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) ? Math.min(PrintCopiesService.MAX_EXTRA, Math.max(0, n)) : PrintCopiesService.DEFAULT_EXTRA
  }
}
