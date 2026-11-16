import { Injectable, Optional, SkipSelf, signal } from '@angular/core'

import { LogService } from './log.service'
import { MissionService } from './mission.service'
import {
  JOURNAL_GENESIS, JournalAction, JournalCheck, JournalEntry, MISSION_JOURNAL_SCHEMA_VERSION, appendEntry,
  migrateMissionJournal, shortHead, verifyJournal,
} from '../../domain/mission-journal'
import { recordStore } from '../storage/record-store'

/**
 * E-222 / ADR D-67: the mission journal - what was done to the mission's data on this device
 * (loaded a demo, restored, imported, backed up, printed...), kept apart from the debug log
 * (LogService), which is in memory and clearable. Stored like the After Action notes: a versioned
 * wrapper in RecordStore, encrypted with the roster when device encryption is on.
 *
 * Append-only: there is deliberately no edit, delete or clear method, and the journal is not
 * cleared by Start a real mission, a demo load or Clear radio log. Nothing in the app deletes all
 * data on the device, so nothing removes it. Restore never replaces it either (BackupService only
 * adds an entry). record() saves synchronously, so an entry made just before a page reload is kept.
 *
 * Events, never contents: pass call signs, counts, file names and scenario or mission names only.
 */
@Injectable({ providedIn: 'root' })
export class MissionJournalService {

  private id = 'Journal'
  private readonly storageKey = 'missionJournal'

  private entriesSignal = signal<JournalEntry[]>([])
  /** Read-only view, oldest first. */
  readonly entries = this.entriesSignal.asReadonly()
  private list: JournalEntry[] = []

  constructor(
    @Optional() @SkipSelf() existingService: MissionJournalService,
    private log: LogService,
    private missionService: MissionService,
  ) {
    if (existingService) {
      throw new Error('MissionJournalService has already been provided. It is providedIn:\'root\' - do not list it in a component\'s providers.')
    }
    this.load()
    this.entriesSignal.set([...this.list])
  }

  private load(): void {
    const stored = recordStore.getItem(this.storageKey)
    try {
      this.list = migrateMissionJournal(stored != null ? JSON.parse(stored) : null).entries
    } catch (error: any) {
      this.list = []
      this.log.error(`Unable to parse the mission journal from storage: ${error.message}`, this.id)
    }
  }

  /**
   * E-313: a read-only window (a pop-out) calls this when the main window has written the journal: re-reads
   * it from RecordStore (already refreshed by `recordStore.reloadKey()`) and publishes it. Never writes.
   */
  public reloadFromStore(): void {
    this.load()
    this.entriesSignal.set([...this.list])
  }

  /**
   * Adds one entry (one plain sentence, past tense, no contents) and also writes it to the debug log.
   * Call it where the action actually happens, in place of that site's own info log.
   */
  record(action: JournalAction, summary: string): void {
    const s = this.missionService.settings
    this.list = appendEntry(this.list, {
      action, summary, mission: s?.mission ?? '', mode: s?.missionMode ?? '',
    }, new Date())
    recordStore.setItem(this.storageKey,
      JSON.stringify({ schemaVersion: MISSION_JOURNAL_SCHEMA_VERSION, entries: this.list }))
    this.entriesSignal.set([...this.list])
    this.log.info(summary, this.id)
  }

  /** Whether the chain is intact, how many entries it holds, and the latest hash. */
  verify(): JournalCheck {
    return verifyJournal(this.list)
  }

  /** The latest hash and the entry count (the genesis hash and 0 when empty). */
  head(): { head: string, count: number } {
    const list = this.entriesSignal()   // a signal read, so a template that prints it updates
    return { head: list.length ? list[list.length - 1].hash : JOURNAL_GENESIS, count: list.length }
  }

  /** `jrnl 3f9a·c21b (143)`, as printed on the 309, the Summary and the map sheet. */
  shortHead(): string {
    const { head, count } = this.head()
    return shortHead(head, count)
  }

  /** A copy of every entry, for the backup file and the CSV export. */
  snapshot(): JournalEntry[] {
    return [...this.list]
  }
}
