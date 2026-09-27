import { AarNoteAbout, AarNoteType } from './aar-note.interface'
import { newLocationUid } from './mission-location-migration'

/**
 * E-116: the stored shape of After Action notes, versioned from the start like Locations
 * (mission-location-migration.ts), so a later field change has somewhere to migrate from.
 */
export const AAR_NOTE_SCHEMA_VERSION = 1

export type StoredAarNotes = {
  schemaVersion: number,
  notes: AarNoteType[],
}

const ABOUT_VALUES: readonly AarNoteAbout[] = ['incident', 'app']

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

  const note: AarNoteType = {
    uid,
    createdAt: typeof n.createdAt === 'string' && n.createdAt ? n.createdAt : new Date(0).toISOString(),
    text,
    page: typeof n.page === 'string' ? n.page : '',
    about: ABOUT_VALUES.includes(n.about as AarNoteAbout) ? n.about as AarNoteAbout : 'incident',
  }
  // Blank review fields are left off rather than stored as empty strings or undefined.
  for (const field of ['area', 'recommendation', 'owner'] as const) {
    const v = n[field]
    if (typeof v === 'string' && v.trim()) note[field] = v
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
