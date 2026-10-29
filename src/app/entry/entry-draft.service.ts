import { Injectable } from '@angular/core'
import type { LocationType } from '../shared/services'
import type { PendingAttachment } from '../shared/attachments/attachment-intake.service'

/** What Entry keeps of an unsent report when the scribe leaves the page. */
export interface EntryDraft {
  callsign: string
  to: string
  status: string
  notes: string
  date: Date
  source: string
  generates213: boolean
  replyRequested213: boolean
  message213: string
  recipients213: string
  subject213: string
  selectedRecipients213: string[]
  /** Only when it was moved off the mission default; otherwise Entry starts from the default as before. */
  location?: LocationType
  pendingFiles: PendingAttachment[]
}

/**
 * E-261 (tester, 2026-10-28): Who and What were blank after a trip to the Map page to find the
 * spot, so she learnt to visit the Map first. Entry is rebuilt on every visit (no route reuse),
 * so the unsent report is handed here on the way out and picked up on the way back in.
 *
 * In memory only, same as OperatorNameService (D-44): it lasts until the page is reloaded, so
 * no report text is written to storage unasked (rule 5). Add to radio log and Reset empty the
 * form, and an empty form leaves no draft behind.
 */
@Injectable({ providedIn: 'root' })
export class EntryDraftService {
  private draft: EntryDraft | null = null

  save(draft: EntryDraft | null): void {
    this.draft = draft
  }

  /** Hands the draft over once; a second call returns null. */
  take(): EntryDraft | null {
    const d = this.draft
    this.draft = null
    return d
  }
}

/** True when the scribe has typed, picked or attached anything worth keeping. */
export function draftHasContent(d: EntryDraft): boolean {
  return !!(d.callsign.trim() || d.to.trim() || d.notes.trim() || d.message213.trim() || d.subject213.trim()
    || d.recipients213.trim() || d.selectedRecipients213.length || d.pendingFiles.length)
}
