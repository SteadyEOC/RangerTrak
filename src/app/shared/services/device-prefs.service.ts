import { Injectable } from "@angular/core"

// Keys unchanged from when the components wrote them directly, so nothing stored moves.
const LAST_COORDINATE_FORMAT_KEY = 'lastCoordinateFormat'
const RANGERS_PRIVACY_DISMISSED_KEY = 'rangertrak.rangers.privacyNoticeDismissed'

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
