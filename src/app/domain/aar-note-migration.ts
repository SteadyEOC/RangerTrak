import type { AarCapability, AarNoteAbout, AarNoteKind, AarNoteType } from '../shared/services/aar-note.interface'
import { newLocationUid } from './mission-location-migration'

/**
 * E-116: the stored shape of After Action notes, versioned from the start like Locations
 * (mission-location-migration.ts), so a later field change has somewhere to migrate from.
 */
// E-04 / D-63: 1 -> 2 adds `kind` and `at`; schema 1 reads as all 'aar'.
// 2 -> 3 adds the optional HSEEP `capability` (POETE); schema 2 notes simply have none.
export const AAR_NOTE_SCHEMA_VERSION = 3

export type StoredAarNotes = {
  schemaVersion: number,
  notes: AarNoteType[],
}

const ABOUT_VALUES: readonly AarNoteAbout[] = ['incident', 'app']
const KIND_VALUES: readonly AarNoteKind[] = ['aar', 'activity']
// HSEEP's POETE list. Kept here, not imported, because domain/ takes *.interface files as types only (ADR D-57).
const CAPABILITY_VALUES: readonly AarCapability[] = ['planning', 'organization', 'equipment', 'training', 'exercise']

/** E-04 / D-63: the time a note counts as happening - the edited time if there is one, else capture. */
export function noteTime(n: Pick<AarNoteType, 'createdAt' | 'at'>): string {
  return n.at ?? n.createdAt
}

/**
 * Repairs one stored or imported note: every note leaves with a string `text`, a valid
 * `about`, a `createdAt` and a unique `uid`. Returns null for something that is not a note at
 * all (not an object, or no text), so a damaged record is dropped rather than shown blank.
 */
function normalizeNote(raw: unknown, usedUids: Set<string>): AarNoteType | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as Partial<AarNoteType>
  const text = typeof n.text === 'string' ? n.text : ''
  if (!text.trim()) return null

  let uid = String(n.uid ?? '').trim()
  while (!uid || usedUids.has(uid)) uid = newLocationUid()
  usedUids.add(uid)

  // E-04 / D-63: a missing or unknown kind is an AAR note (schema 1 data, a hand-edited file).
  const kind: AarNoteKind = KIND_VALUES.includes(n.kind as AarNoteKind) ? n.kind as AarNoteKind : 'aar'

  const note: AarNoteType = {
    uid,
    createdAt: typeof n.createdAt === 'string' && n.createdAt ? n.createdAt : new Date(0).toISOString(),
    text,
    page: typeof n.page === 'string' ? n.page : '',
    // An activity line is always about the incident; it has no About choice.
    about: kind === 'activity' ? 'incident'
      : ABOUT_VALUES.includes(n.about as AarNoteAbout) ? n.about as AarNoteAbout : 'incident',
    kind,
  }
  // A time that does not parse is dropped rather than kept, so the line falls back to capture time.
  if (typeof n.at === 'string' && n.at && !isNaN(new Date(n.at).getTime())) note.at = n.at
  // Blank review fields are left off rather than stored as empty strings or undefined. An
  // activity line never carries them.
  if (kind === 'aar') {
    for (const field of ['area', 'recommendation', 'owner'] as const) {
      const v = n[field]
      if (typeof v === 'string' && v.trim()) note[field] = v
    }
    // An unknown or blank capability is left off, the same as a blank review field.
    if (CAPABILITY_VALUES.includes(n.capability as AarCapability)) note.capability = n.capability
  }
  return note
}

/** Normalizes a list of notes. Pure; a second run over its own output changes nothing. */
export function normalizeAarNotes(notes: readonly unknown[]): AarNoteType[] {
  const usedUids = new Set<string>()
  return notes.map(n => normalizeNote(n, usedUids)).filter((n): n is AarNoteType => n !== null)
}

/**
 * Accepts whatever storage or a backup file holds - nothing (a device that has never saved a
 * note, or a backup made before E-116), a bare array, or the versioned wrapper - and returns
 * the current shape. A wrapper from a NEWER schema is passed through untouched rather than
 * downgraded, the same rule migrateLocations() follows.
 */
export function migrateAarNotes(raw: unknown): StoredAarNotes {
  if (Array.isArray(raw)) {
    return { schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: normalizeAarNotes(raw) }
  }
  if (!raw || typeof raw !== 'object') {
    return { schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: [] }
  }

  const incoming = raw as { schemaVersion?: unknown, notes?: unknown }
  const notes = Array.isArray(incoming.notes) ? incoming.notes : []
  const version = typeof incoming.schemaVersion === 'number' ? incoming.schemaVersion : 0

  if (version > AAR_NOTE_SCHEMA_VERSION) {
    return { schemaVersion: version, notes: notes as AarNoteType[] }
  }
  return { schemaVersion: AAR_NOTE_SCHEMA_VERSION, notes: normalizeAarNotes(notes) }
}
