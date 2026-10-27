import { Injectable } from "@angular/core"

import {
  COLUMN_TARGETS, ImportMappings, parseImportMappings, PLACE_TARGET_WORDS, rememberMapping,
} from "../../domain/roster-sheet"

// Keys unchanged from when the components wrote them directly, so nothing stored moves.
const LAST_COORDINATE_FORMAT_KEY = 'lastCoordinateFormat'
const RANGERS_PRIVACY_DISMISSED_KEY = 'rangertrak.rangers.privacyNoticeDismissed'
// E-187: remembered spreadsheet column mappings, keyed by header set. Header names only, never cell values.
const IMPORT_MAPPINGS_KEY = 'rt-import-mappings'
// D-61: this device's hold on a Board. See BoardPublisherPref.
const BOARD_PUBLISHER_KEY = 'rt-board-publisher'
// E-04 / D-63: the kind the AAR/214 capture box opens on ('aar' or 'activity'): the one used last on this device.
const AAR_NOTE_LAST_KIND_KEY = 'aarNoteLastKind'
// E-220 / D-68: the station letter this device's message numbers carry. A device pref, not a Mission
// setting, so a Setup file sent to ten phones does not give them all the same letter.
const MSG_STATION_KEY = 'rt-msg-station'
// 2026-10-27: the grids this device fits to the screen (Fit to screen), comma-separated names.
const GRID_FIT_KEY = 'rt-grid-fit'

/**
 * D-61: what this device remembers about publishing to a Board. `key` is the hidden publish key the
 * server issued at the last claim, `base` the server it belongs to. `replaced` is set once another
 * device took the Board, so a restart does not claim it back. A secret: never exported, never logged.
 */
/** The grids that have a Fit to screen switch. */
export type GridName = 'radio-log' | 'rangers'

export type BoardPublisherPref = { base?: string, key?: string, replaced?: boolean }

/**
 * Small per-device UI preferences that used to be read and written by components straight
 * from localStorage (ADR D-57: components go through a service, never storage). Each is a
 * convenience only: if storage throws (private browsing, full quota) a read gives the default
 * and a write is dropped, which is the safe direction to fail in.
 */
@Injectable({ providedIn: 'root' })
export class DevicePrefsService {

  /**
   * E-114 §1a: the coordinate format this device last actually used on Entry. It outranks the
   * mission's own preferred format (see LocationComponent's constructor). Unvalidated: the
   * caller checks it against the formats it knows.
   */
  /** E-04 / D-63: the capture box opens on the kind used last on this device. Anything unknown reads as `aar`. */
  getAarNoteLastKind(): 'aar' | 'activity' {
    return this.read(AAR_NOTE_LAST_KIND_KEY) === 'activity' ? 'activity' : 'aar'
  }

  setAarNoteLastKind(kind: 'aar' | 'activity'): void {
    this.write(AAR_NOTE_LAST_KIND_KEY, kind)
  }

  /** E-220 / D-68: this device's station letter, A-Z, default A. Anything else reads as A. */
  getMsgStation(): string {
    const letter = (this.read(MSG_STATION_KEY) ?? '').trim().toUpperCase()
    return /^[A-Z]$/.test(letter) ? letter : 'A'
  }

  /** False when the letter is not A-Z or storage refused the write. */
  setMsgStation(letter: string): boolean {
    const clean = (letter ?? '').trim().toUpperCase()
    return /^[A-Z]$/.test(clean) && this.write(MSG_STATION_KEY, clean)
  }

  /** Fit to screen (John 2026-10-27): whether this grid fits the screen rather than up to 1.5 widths. */
  getGridFit(grid: GridName): boolean {
    return (this.read(GRID_FIT_KEY) ?? '').split(',').includes(grid)
  }

  setGridFit(grid: GridName, fit: boolean): void {
    const others = (this.read(GRID_FIT_KEY) ?? '').split(',').filter(g => g && g !== grid)
    this.write(GRID_FIT_KEY, (fit ? [...others, grid] : others).join(','))
  }

  getLastCoordinateFormat(): string | null {
    return this.read(LAST_COORDINATE_FORMAT_KEY)
  }

  setLastCoordinateFormat(system: string): void {
    this.write(LAST_COORDINATE_FORMAT_KEY, system)
  }

  /** The Rangers page's "Confidential" bar (the roster holds personal data), once dismissed. */
  isRangersPrivacyNoticeDismissed(): boolean {
    return this.read(RANGERS_PRIVACY_DISMISSED_KEY) === 'true'
  }

  /** False when storage refused the write: the bar still goes, but comes back next visit. */
  dismissRangersPrivacyNotice(): boolean {
    return this.write(RANGERS_PRIVACY_DISMISSED_KEY, 'true')
  }

  /** E-187: the column mappings remembered for roster and places spreadsheets. Bad or missing data reads as none. */
  getImportMappings(): ImportMappings {
    // Roster and places sheets share this one key (places under a `places:` prefix), so both
    // kinds of target must survive a read-modify-write.
    return parseImportMappings(this.read(IMPORT_MAPPINGS_KEY), [...COLUMN_TARGETS, ...PLACE_TARGET_WORDS])
  }

  /** Remembers the mapping used for this header set (at most 20 are kept, oldest dropped). */
  rememberImportMapping(headerKey: string, targets: readonly string[]): boolean {
    const next = rememberMapping(this.getImportMappings(), headerKey, targets)
    return this.write(IMPORT_MAPPINGS_KEY, JSON.stringify(next))
  }

  /** D-61: the publish key and replaced flag. Unreadable or missing data reads as nothing. */
  getBoardPublisher(): BoardPublisherPref {
    try {
      const parsed = JSON.parse(this.read(BOARD_PUBLISHER_KEY) ?? '{}')
      if (typeof parsed !== 'object' || parsed === null) return {}
      return {
        ...(typeof parsed.base === 'string' && typeof parsed.key === 'string' ? { base: parsed.base, key: parsed.key } : {}),
        ...(parsed.replaced === true ? { replaced: true } : {}),
      }
    } catch {
      return {}
    }
  }

  /** An empty preference removes the entry. */
  setBoardPublisher(pref: BoardPublisherPref): boolean {
    if (!pref.key && !pref.replaced) {
      try { localStorage.removeItem(BOARD_PUBLISHER_KEY); return true } catch { return false }
    }
    return this.write(BOARD_PUBLISHER_KEY, JSON.stringify(pref))
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  private write(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      // See the class comment: a lost preference just comes back next visit.
      return false
    }
  }
}
