import { Observable, ReplaySubject } from 'rxjs'

import { Injectable, Optional, SkipSelf, signal } from '@angular/core'

import { LogService } from './log.service'
import { AarNoteAbout, AarNoteType } from './aar-note.interface'
import { AAR_NOTE_SCHEMA_VERSION, migrateAarNotes, normalizeAarNotes } from './aar-note-migration'
import { newLocationUid } from './mission-location-migration'
import { recordStore } from '../storage/record-store'

/**
 * E-116: per-device storage for After Action notes. Same shape as MissionLocationService -
 * signal + ReplaySubject, a versioned wrapper in RecordStore, uid-keyed CRUD.
 *
 * Notes are NOT cleared when the radio log is deleted or a demo is loaded: they are the
 * debrief's raw material, and losing them as a side effect of another button would be worse
 * than having to delete them on the After Action page. Restore mission replaces them, since a
 * backup carries them.
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

  private saveAndPublish(): void {
    recordStore.setItem(this.storageKey,
      JSON.stringify({ schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: this.list }))
    this.publish()
  }

  private publish(): void {
    this.notesSignal.set([...this.list])
    this.notesReplay$.next(this.list)
  }

  /** Captures a note. Returns it, or null when the text is blank. */
  addNote(text: string, about: AarNoteAbout, page: string): AarNoteType | null {
    if (!text.trim()) return null
    const note: AarNoteType = {
      uid: newLocationUid(),
      createdAt: new Date().toISOString(),
      text: text.trim(),
      page,
      about,
    }
    this.list = [...this.list, note]
    this.saveAndPublish()
    this.log.verbose(`Noted for the after-action review (${about}, on ${page})`, this.id)
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
      this.log.warn('updateNote got a note with no text; kept the previous version', this.id)
      return
    }
    this.list = this.list.map((n, i) => i === index ? { ...normalized, uid: note.uid } : n)
    this.saveAndPublish()
  }

  deleteNote(uid: string): void {
    const before = this.list.length
    this.list = this.list.filter(n => n.uid !== uid)
    if (this.list.length === before) {
      this.log.error(`deleteNote got unknown uid: ${uid}`, this.id)
      return
    }
    this.saveAndPublish()
  }

  deleteAllNotes(): void {
    this.list = []
    this.saveAndPublish()
  }

  /** Replaces every note, e.g. when restoring a mission backup. */
  replaceAllNotes(notes: readonly unknown[]): void {
    this.list = normalizeAarNotes(notes)
    this.saveAndPublish()
  }
}
