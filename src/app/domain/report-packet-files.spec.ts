import type { AttachmentRef } from './attachments'
import {
  distinctLiveRefs,
  matchMedia,
  mediaSummary,
  planShare,
  shareNames,
  stillRemote,
} from './report-packet-files'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

function ref(sha256: string, name: string, removed = false): AttachmentRef {
  return {
    sha256,
    name,
    type: 'image/jpeg',
    size: 1,
    addedAt: '2026-10-16T10:00:00Z',
    addedBy: 'K7ABC',
    ...(removed ? { removed: { at: 'x', by: 'y' } } : {}),
  }
}

describe('report-packet-files (D-60 item 6)', () => {
  it('collects each live fingerprint once, ignoring removed references', () => {
    const out = distinctLiveRefs([
      { attachments: [ref(A, 'one.jpg'), ref(B, 'gone.jpg', true)] },
      { attachments: [ref(A, 'again.jpg'), ref(C, 'three.jpg')] },
      {},
    ])
    expect(out.map((r) => r.sha256)).toEqual([A, C])
  })

  it('gives clashing names a fingerprint tag so every shared file is distinct', () => {
    const names = shareNames([
      ref(A, 'IMG_0001.jpg'),
      ref(B, 'img_0001.JPG'),
      ref(C, 'voice'),
    ])
    expect(names.get(A)).toBe('IMG_0001.jpg')
    expect(names.get(B)).toBe('img_0001-bbbbbbbb.JPG')
    expect(names.get(C)).toBe('voice')
  })

  describe('planShare', () => {
    const text = 'T',
      photo = 'P'
    it('shares everything when the sheet accepts the set', () => {
      expect(planShare(() => true, text, [photo])).toBe('with-files')
    })
    it('falls back to the text alone when the set is refused', () => {
      expect(planShare((d) => d.files.length === 1, text, [photo])).toBe('text-only')
    })
    it('with no photos, the text alone is the whole share', () => {
      expect(planShare(() => true, text, [])).toBe('with-files')
    })
    it('cannot share at all without canShare, or when even the text is refused', () => {
      expect(planShare(undefined, text, [photo])).toBe('cannot-share')
      expect(planShare(() => false, text, [photo])).toBe('cannot-share')
    })
  })

  it('stores only files whose fingerprint a live reference names', () => {
    const { matched, unmatched } = matchMedia(
      [
        { name: 'a.jpg', sha256: A },
        { name: 'stray.jpg', sha256: 'd'.repeat(64) },
        { name: 'ONLY-REMOVED.jpg', sha256: B },
      ],
      new Set([A, C])
    )
    expect(matched.map((f) => f.name)).toEqual(['a.jpg'])
    expect(unmatched.map((f) => f.name)).toEqual(['stray.jpg', 'ONLY-REMOVED.jpg'])
  })

  it('counts references with no bytes here', () => {
    expect(stillRemote([ref(A, 'a'), ref(B, 'b'), ref(C, 'c')], new Set([B]))).toBe(2)
  })

  it('words the report, leaving out lines with nothing in them', () => {
    expect(mediaSummary({ added: 1, unmatched: 0, remote: 0 })).toEqual([
      '1 attachment added.',
    ])
    expect(mediaSummary({ added: 3, unmatched: 2, remote: 1 })).toEqual([
      '3 attachments added.',
      '2 files didn’t match any entry (not stored).',
      '1 attachment is still on the ranger’s phone.',
    ])
    expect(mediaSummary({ added: 0, unmatched: 0, remote: 4 })).toEqual([
      '4 attachments are still on the ranger’s phone.',
    ])
    expect(mediaSummary({ added: 0, unmatched: 0, remote: 0 })).toEqual([])
  })
})
