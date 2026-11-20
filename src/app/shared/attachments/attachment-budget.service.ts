import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core'

import { BYTES_PER_MB, budgetUsage, formatBytes } from '../../domain/attachments'
import type { BudgetLevel } from '../../domain/attachments'
import { AttachmentStoreService } from '../services/attachment-store.service'
import { MissionService } from '../services/mission.service'
import { RadioLogService } from '../services/radio-log.service'
import type { RadioLogEntryType } from '../../domain/model/radio-log-entry.interface'

/**
 * How full the mission's attachment budget is (ADR D-60 item 7), live. The rules are in
 * `domain/attachments.ts` (`budgetUsage`); this only feeds them the entries, the stored sizes and
 * the `attachmentBudgetMB` setting, and keeps the answer current as any of the three change.
 *
 * Used by the Mission page's "Attachments: 41 MB of 512 MB (8%)" line, by the Attach button's
 * note past 80%, and by the questions asked before a file is stored. A warning threshold only:
 * nothing here ever blocks.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentBudgetService {

  private store = inject(AttachmentStoreService)
  private radioLog = inject(RadioLogService)
  private mission = inject(MissionService)

  private entries = signal<RadioLogEntryType[]>([])
  private budgetMB = signal(this.mission.settings?.attachmentBudgetMB ?? 512)
  private sizes = signal<Record<string, number>>({})

  readonly budgetBytes = computed(() => Math.max(1, this.budgetMB()) * BYTES_PER_MB)
  readonly usage = computed(() => budgetUsage(this.entries(), this.sizes(), this.budgetBytes()))

  /** "Attachments: 41 MB of 512 MB (8%)", always. */
  readonly line = computed(() => {
    const u = this.usage()
    return `Attachments: ${formatBytes(u.usedBytes)} of ${Math.max(1, this.budgetMB())} MB (${Math.round(u.pct)}%)`
  })

  constructor() {
    this.radioLog.getRadioLogObserver().subscribe(log => this.entries.set([...(log.logEntries ?? [])]))
    this.mission.getMissionObserver().subscribe(settings => {
      const mb = Number(settings?.attachmentBudgetMB)
      this.budgetMB.set(Number.isFinite(mb) && mb > 0 ? mb : 512)
    })
    effect(() => {
      this.store.changes()
      untracked(() => void this.store.sizes().then(s => this.sizes.set(s)).catch(() => { }))
    })
  }

  /** The level the budget would reach if `extraBytes` more were stored now. */
  levelAfter(extraBytes: number): BudgetLevel {
    const used = this.usage().usedBytes + extraBytes
    const pct = (used / this.budgetBytes()) * 100
    return pct >= 100 ? 'over' : pct >= 80 ? 'warn80' : 'ok'
  }
}
