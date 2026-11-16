import { Injectable, Optional, SkipSelf, signal } from '@angular/core'

import { LogService } from './log.service'
import { ActivityLogHeader, EMPTY_ACTIVITY_LOG_HEADER, normalizeActivityLogHeader } from '../../domain/activity-log'
import { recordStore } from '../storage/record-store'

/**
 * E-04 / ADR D-63 item 4: the ICS-214 header (the name, ICS position and home agency of the
 * person whose log it is, and up to 8 Resources Assigned rows), entered once in the Export
 * ICS-214 dialog and kept as mission data under RecordStore key `activityLogHeader`.
 *
 * It names people (CLAUDE.md rule 5), so the key is in ENCRYPTED_KEYS and encrypts with the
 * roster when device encryption is on; it travels in the mission backup as the optional
 * `activityLogHeader` field. Not cleared when the radio log is deleted (the notes are not
 * either); cleared by "Start a real mission" with the rest of the demo data.
 *
 * One small signal-holding service, no ReplaySubject: the only reader is the export dialog,
 * and a stored value that will not parse reads as the empty header, never as an error.
 */
@Injectable({ providedIn: 'root' })
export class ActivityLogHeaderService {

  private id = 'Activity Log Header Service'
  private readonly storageKey = 'activityLogHeader'

  private headerSignal = signal<ActivityLogHeader>({ ...EMPTY_ACTIVITY_LOG_HEADER, resources: [] })
  /** Read-only view for templates and dialogs. */
  readonly header = this.headerSignal.asReadonly()

  constructor(
    @Optional() @SkipSelf() existingService: ActivityLogHeaderService,
    private log: LogService,
  ) {
    if (existingService) {
      throw new Error('ActivityLogHeaderService has already been provided. It is providedIn:\'root\' - do not list it in a component\'s providers.')
    }
    this.load()
  }

  private load(): void {
    const stored = recordStore.getItem(this.storageKey)
    try {
      this.headerSignal.set(normalizeActivityLogHeader(stored != null ? JSON.parse(stored) : null))
    } catch (error: any) {
      this.headerSignal.set(normalizeActivityLogHeader(null))
      this.log.error(`Unable to parse the ICS-214 header from storage: ${error.message}`, this.id)
    }
  }

  /**
   * E-313: a read-only window (a pop-out) calls this when the main window has written the ICS-214 header: re-reads
   * it from RecordStore (already refreshed by `recordStore.reloadKey()`) and publishes it. Never writes.
   */
  public reloadFromStore(): void {
    this.load()
  }

  getCurrentHeader(): ActivityLogHeader {
    return this.headerSignal()
  }

  /** Normalises and saves the header. Returns what was stored. */
  save(header: unknown): ActivityLogHeader {
    const normalized = normalizeActivityLogHeader(header)
    recordStore.setItem(this.storageKey, JSON.stringify(normalized))
    this.headerSignal.set(normalized)
    return normalized
  }

  clear(): void {
    recordStore.removeItem(this.storageKey)
    this.headerSignal.set(normalizeActivityLogHeader(null))
  }
}
