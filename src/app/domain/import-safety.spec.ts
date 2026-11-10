import type { AttachmentRef } from './attachments'
import { orphans, removedOnly } from './attachments'
import type { ImportSafetyMeta } from './import-safety'
import {
  IMPORT_SAFETY_TTL_MS,
  describeLastImport,
  entriesLoggedSinceImport,
  entriesSince,
  heldFingerprints,
  holdAsEntries,
  isSafetyCopyExpired,
  safetyCopyExpiresAt,
} from './import-safety'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

function ref(sha256: string, removed = false): AttachmentRef {
  return {
    sha256,
    name: 'x.jpg',
    type: 'image/jpeg',
    size: 1,
    addedAt: '2026-10-17T10:00:00Z',
    addedBy: 'FERN-1',
    ...(removed ? { removed: { at: 'x', by: 'y' } } : {}),
  }
}

const meta = (takenAt: string): ImportSafetyMeta => ({
  takenAt,
  reason: 'restore',
  fileName: 'rangertrak-Ops-2026-10-17.json',
  appVersion: '0.99.56-alpha',
})

describe('import safety copy rules (E-198)', () => {
  describe('expiry', () => {
    const taken = '2026-10-17T14:02:00.000Z'
    const t0 = Date.parse(taken)

    it('is 24 hours', () => {
      expect(IMPORT_SAFETY_TTL_MS).toBe(86400000)
      expect(safetyCopyExpiresAt(meta(taken))).toBe(t0 + 86400000)
    })

    it('is fresh until the 24th hour, then expired', () => {
      expect(isSafetyCopyExpired(meta(taken), t0)).toBe(false)
      expect(isSafetyCopyExpired(meta(taken), t0 + IMPORT_SAFETY_TTL_MS - 1)).toBe(false)
      expect(isSafetyCopyExpired(meta(taken), t0 + IMPORT_SAFETY_TTL_MS)).toBe(true)
    })

    it('treats an unreadable time as expired', () => {
      expect(isSafetyCopyExpired(meta('not a time'))).toBe(true)
    })
  })

  describe('entriesSince', () => {
    it('returns the entries on the device now whose uid the copy lacks', () => {
      const copy = [{ uid: 'e1' }, { uid: 'e2' }]
      const now = [{ uid: 'e1' }, { uid: 'e2' }, { uid: 'e3' }, { uid: 'e4' }]
      expect(entriesSince(copy, now).map((e) => e.uid)).toEqual(['e3', 'e4'])
    })

    it('is empty when nothing was logged since', () => {
      expect(entriesSince([{ uid: 'e1' }], [{ uid: 'e1' }])).toEqual([])
    })

    it('counts an entry with no uid as new, and ignores copy entries with no uid', () => {
      expect(entriesSince([{}, { uid: 'e1' }], [{ uid: 'e1' }, {}]).length).toBe(1)
    })

    it('does not count entries only the copy has (Undo brings those back)', () => {
      expect(entriesSince([{ uid: 'e1' }, { uid: 'old' }], [{ uid: 'e1' }])).toEqual([])
    })
  })

  describe('entriesLoggedSinceImport', () => {
    // A Restore replaced 2 device entries with 3 from the file; then the scribe logged 1 more.
    const copy = [{ uid: 'dev1' }, { uid: 'dev2' }]
    const afterImport = ['f1', 'f2', 'f3']
    const now = [{ uid: 'f1' }, { uid: 'f2' }, { uid: 'f3' }, { uid: 'new1' }]

    it('counts only entries logged after the import, not the ones it brought in', () => {
      expect(entriesLoggedSinceImport(copy, afterImport, now).map((e) => e.uid)).toEqual([
        'new1',
      ])
    })

    it('is empty straight after the import', () => {
      expect(entriesLoggedSinceImport(copy, afterImport, now.slice(0, 3))).toEqual([])
    })

    it('falls back to everything not in the copy before the import has finished', () => {
      expect(entriesLoggedSinceImport(copy, undefined, now).length).toBe(4)
    })
  })

  describe('the attachment hold', () => {
    it('holds the fingerprints a LIVE reference in the copy names, not a removed one', () => {
      const held = heldFingerprints([
        { attachments: [ref(A), ref(B, true)] },
        { attachments: [ref(C)] },
        {},
      ])
      expect([...held].sort()).toEqual([A, C])
    })

    it('keeps a held fingerprint out of orphans() and removedOnly()', () => {
      const held = heldFingerprints([{ attachments: [ref(A), ref(B)] }])
      const current = [{ attachments: [ref(C), ref(B, true)] }]
      // Without the hold: A is an orphan, B is removed-only.
      expect(orphans([A, B, C], current)).toEqual([A])
      expect(removedOnly([A, B, C], current)).toEqual([B])
      // With it: both are live as far as the sweep is concerned.
      expect(orphans([A, B, C], [...current, ...holdAsEntries(held)])).toEqual([])
      expect(removedOnly([A, B, C], [...current, ...holdAsEntries(held)])).toEqual([])
    })

    it('adds nothing when the hold is empty', () => {
      expect(holdAsEntries(new Set())).toEqual([])
    })
  })

  describe('describeLastImport', () => {
    it('names the file and the kind of import', () => {
      expect(describeLastImport(meta('2026-10-17T14:02:00.000Z'))).toMatch(
        /^Last import: Restore of "rangertrak-Ops-2026-10-17\.json", \d\d:\d\d\.$/
      )
      expect(
        describeLastImport({
          ...meta('2026-10-17T14:02:00.000Z'),
          reason: 'report-packet',
          fileName: 'p.txt',
        })
      ).toContain('Report Packet "p.txt"')
      expect(
        describeLastImport({
          ...meta('2026-10-17T14:02:00.000Z'),
          reason: 'setup-file',
          fileName: 's.zip',
        })
      ).toContain('Setup file "s.zip"')
      expect(
        describeLastImport({
          ...meta('2026-10-17T14:02:00.000Z'),
          reason: 'roster',
          fileName: 'r.csv',
        })
      ).toMatch(/^Last import: roster import of "r\.csv" at \d\d:\d\d\.$/)
    })
  })
})
