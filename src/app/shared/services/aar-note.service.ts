import { Observable, ReplaySubject } from 'rxjs'

import { Injectable, Optional, SkipSelf, signal } from '@angular/core'

import { LogService } from './log.service'
import { AarNoteAbout, AarNoteKind, AarNoteType } from '../../domain/model/aar-note.interface'
import { AAR_NOTE_SCHEMA_VERSION, migrateAarNotes, normalizeAarNotes } from '../../domain/aar-note-migration'
import { newLocationUid } from '../../domain/mission-location-migration'
import { recordStore } from '../storage/record-store'

/**
 * E-116: per-device storage for After Action notes. Same shape as MissionLocationService -
 * signal + ReplaySubject, a versioned wrapper in RecordStore, uid-keyed CRUD.
 *
 * Notes are not cleared silently when the radio log is deleted or a demo is loaded: they are the
 * debrief's raw material. Those actions ask what to clear first (E-221, deleteWhere below), and
 * Clear radio log keeps every note unless the operator ticks them. Restore mission replaces
 * them, since a backup carries them.
 */
@Injectable({ providedIn: 'root' })
export class AarNoteService {

  private id = 'AAR Note Service'
  private readonly storageKey = 'aarNotes'

  private notesSignal = signal<AarNoteType[]>([])
  /** Read-only view for templates; newest last, in capture order. */
  readonly notes = this.notesSignal.asReadonly()
  private notesReplay$ = new ReplaySubject<AarNoteType[]>(1)
  private list: AarNoteType[] = []

  constructor(
    @Optional() @SkipSelf() existingService: AarNoteService,
    private log: LogService,
  ) {
    if (existingService) {
      throw new Error('AarNoteService has already been provided. It is providedIn:\'root\' - do not list it in a component\'s providers.')
    }
    this.load()
    this.publish()
  }

  getNotesObserver(): Observable<AarNoteType[]> {
    return this.notesReplay$.asObservable()
  }

  getCurrentNotes(): AarNoteType[] {
    return this.list
  }

  private load(): void {
    const stored = recordStore.getItem(this.storageKey)
    try {
      this.list = migrateAarNotes(stored != null ? JSON.parse(stored) : null).notes
    } catch (error: any) {
      this.list = []
      this.log.error(`Unable to parse After Action notes from storage: ${error.message}`, this.id)
    }
  }

  /**
   * E-313: a read-only window (a pop-out) calls this when the main window has written the notes: re-reads
   * it from RecordStore (already refreshed by `recordStore.reloadKey()`) and publishes it. Never writes.
   */
  public reloadFromStore(): void {
    this.load()
    this.publish()
  }

  private saveAndPublish(): void {
    recordStore.setItem(this.storageKey,
      JSON.stringify({ schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: this.list }))
    this.publish()
  }

  private publish(): void {
    this.notesSignal.set([...this.list])
    this.notesReplay$.next(this.list)
  }

  /**
   * Captures a note. Returns it, or null when the text is blank. E-04 / D-63: `kind` 'activity'
   * adds an ICS-214 line instead - always about the incident; `at` is the scribe's edited time
   * (ISO), passed only when it differs from now.
   */
  addNote(text: string, about: AarNoteAbout, page: string, kind: AarNoteKind = 'aar', at?: string): AarNoteType | null {
    if (!text.trim()) return null
    const note: AarNoteType = {
      uid: newLocationUid(),
      createdAt: new Date().toISOString(),
      text: text.trim(),
      page,
      about: kind === 'activity' ? 'incident' : about,
      kind,
    }
    if (kind === 'activity' && at && !isNaN(new Date(at).getTime())) note.at = at
    this.list = [...this.list, note]
    this.saveAndPublish()
    this.log.info(`Added an after-action note (${kind}, ${about}, on ${page}).`, this.id)
    return note
  }

  /** Replaces the note with the same uid. Blank optional fields are dropped. */
  updateNote(note: AarNoteType): void {
    const index = this.list.findIndex(n => n.uid === note.uid)
    if (index < 0) {
      this.log.error(`updateNote got unknown uid: ${note.uid}`, this.id)
      return
    }
    const [normalized] = normalizeAarNotes([note])
    if (!normalized) {
      this.log.warn('An edited note had no text, so the previous text was kept.', this.id)
      return
    }
    this.list = this.list.map((n, i) => i === index ? { ...normalized, uid: note.uid } : n)
    this.saveAndPublish()
    this.log.info(`Edited after-action note ${note.uid}.`, this.id)
  }

  deleteNote(uid: string): void {
    const before = this.list.length
    this.list = this.list.filter(n => n.uid !== uid)
    if (this.list.length === before) {
      this.log.error(`deleteNote got unknown uid: ${uid}`, this.id)
      return
    }
    this.saveAndPublish()
    this.log.info(`Deleted after-action note ${uid}.`, this.id)
  }

  deleteAllNotes(): void {
    this.list = []
    this.saveAndPublish()
  }

  /**
   * E-04 / D-63: deletes every note of one kind, so "Delete all after-action notes" on the After Action page
   * leaves the ICS-214 lines alone (and the other way round).
   */
  deleteAllOfKind(kind: AarNoteKind): void {
    this.list = this.list.filter(n => n.kind !== kind)
    this.saveAndPublish()
  }

  /**
   * E-221: deletes every note the predicate accepts (the "What to clear" dialog's choices; see
   * noteMatcher() in domain/clear-choices.ts). Saves only when something went.
   */
  deleteWhere(pred: (n: AarNoteType) => boolean): void {
    const kept = this.list.filter(n => !pred(n))
    if (kept.length === this.list.length) return
    this.list = kept
    this.saveAndPublish()
  }

  /** Replaces every note, e.g. when restoring a mission backup. */
  replaceAllNotes(notes: readonly unknown[]): void {
    this.list = normalizeAarNotes(notes)
    this.saveAndPublish()
  }
}
