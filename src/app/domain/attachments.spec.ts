import type { AttachmentRef } from './attachments'
import {
  budgetUsage,
  formatFingerprint,
  isGone,
  isSmallerCopy,
  liveRefs,
  mergeAttachmentRefs,
  nameWithKind,
  orphans,
  printAttachments,
  referencedFingerprints,
  removedOnly,
  smallerCopyLabel,
  smallerCopyLabelIn,
} from './attachments'

/** ADR D-60 / E-194: the pure rules for attachment references. */
describe('attachments (D-60)', () => {
  const sha = (c: string) => c.repeat(64)
  const ref = (c: string, over: Partial<AttachmentRef> = {}): AttachmentRef => ({
    sha256: sha(c),
    name: `${c}.jpg`,
    type: 'image/jpeg',
    size: 1000,
    addedAt: '2026-10-16T10:00:00.000Z',
    addedBy: 'K7ABC',
    ...over,
  })
  const removedAt = (at: string, by = 'K7ABC') => ({ at, by })

  describe('mergeAttachmentRefs', () => {
    it('is the union by sha256', () => {
      const merged = mergeAttachmentRefs([ref('a'), ref('b')], [ref('b'), ref('c')])
      expect(merged.map((r) => r.sha256)).toEqual([sha('a'), sha('b'), sha('c')])
    })

    it('is idempotent: merging twice equals merging once', () => {
      const a = [ref('a'), ref('b', { removed: removedAt('2026-10-16T11:00:00Z') })]
      const b = [ref('b'), ref('c')]
      const once = mergeAttachmentRefs(a, b)
      expect(mergeAttachmentRefs(once, b)).toEqual(once)
      expect(mergeAttachmentRefs(once, once)).toEqual(once)
    })

    it('is commutative (the stable order makes the results equal)', () => {
      const a = [ref('c', { addedAt: '2026-10-16T09:00:00Z' }), ref('a')]
      const b = [ref('b'), ref('a')]
      expect(mergeAttachmentRefs(a, b)).toEqual(mergeAttachmentRefs(b, a))
    })

    it('orders by addedAt, then sha256', () => {
      const merged = mergeAttachmentRefs(
        [ref('b'), ref('a')],
        [ref('c', { addedAt: '2026-10-16T08:00:00Z' })]
      )
      expect(merged.map((r) => r.sha256)).toEqual([sha('c'), sha('a'), sha('b')])
    })

    it('removal is sticky from either side, and the earlier mark is kept', () => {
      const early = removedAt('2026-10-16T11:00:00Z', 'K7EARLY')
      const late = removedAt('2026-10-16T12:00:00Z', 'K7LATE')
      const live = ref('a')
      expect(
        mergeAttachmentRefs([live], [ref('a', { removed: early })])[0].removed
      ).toEqual(early)
      expect(
        mergeAttachmentRefs([ref('a', { removed: early })], [live])[0].removed
      ).toEqual(early)
      expect(
        mergeAttachmentRefs(
          [ref('a', { removed: late })],
          [ref('a', { removed: early })]
        )[0].removed
      ).toEqual(early)
      expect(
        mergeAttachmentRefs(
          [ref('a', { removed: early })],
          [ref('a', { removed: late })]
        )[0].removed
      ).toEqual(early)
    })

    it('keeps the first-seen name and addedAt', () => {
      const first = ref('a', { name: 'first.jpg', addedAt: '2026-10-16T09:00:00Z' })
      const second = ref('a', { name: 'second.jpg', addedAt: '2026-10-16T10:00:00Z' })
      expect(mergeAttachmentRefs([second], [first])[0].name).toBe('first.jpg')
      expect(mergeAttachmentRefs([first], [second])[0].name).toBe('first.jpg')
    })

    it('does not mutate its inputs and copes with undefined', () => {
      const a = [ref('a')]
      const merged = mergeAttachmentRefs(a, [
        ref('a', { removed: removedAt('2026-10-16T11:00:00Z') }),
      ])
      expect(a[0].removed).toBeUndefined()
      expect(merged[0].removed).toBeDefined()
      expect(mergeAttachmentRefs(undefined, undefined)).toEqual([])
    })
  })

  describe('liveRefs / referencedFingerprints / orphans', () => {
    const entries = [
      {
        attachments: [ref('a'), ref('b', { removed: removedAt('2026-10-16T11:00:00Z') })],
      },
      { attachments: undefined },
      { attachments: [ref('a')] },
    ]

    it('liveRefs leaves out removed references', () => {
      expect(liveRefs(entries[0]).map((r) => r.sha256)).toEqual([sha('a')])
      expect(liveRefs(entries[1])).toEqual([])
    })

    it('referencedFingerprints counts live and removed', () => {
      expect([...referencedFingerprints(entries)].sort()).toEqual([sha('a'), sha('b')])
    })

    it('orphans ignores a removed-but-referenced fingerprint', () => {
      expect(orphans([sha('a'), sha('b'), sha('z')], entries)).toEqual([sha('z')])
      expect(orphans([sha('a')], [])).toEqual([sha('a')])
    })
  })

  it('removedOnly() finds fingerprints only removed references name', () => {
    const entries = [
      {
        attachments: [
          ref('a', { removed: removedAt('2026-10-16T11:00:00Z') }),
          ref('b', { removed: removedAt('2026-10-16T11:00:00Z') }),
        ],
      },
      { attachments: [ref('b')] },
    ]
    expect(removedOnly([sha('a'), sha('b'), sha('z')], entries)).toEqual([sha('a')])
  })

  describe('budgetUsage', () => {
    const budget = 100
    const usageOf = (bytes: number) =>
      budgetUsage([{ attachments: [ref('a')] }], { [sha('a')]: bytes }, budget)

    it('levels at 79 / 80 / 100 percent', () => {
      expect(usageOf(79).level).toBe('ok')
      expect(usageOf(80).level).toBe('warn80')
      expect(usageOf(99).level).toBe('warn80')
      expect(usageOf(100).level).toBe('over')
      expect(usageOf(80).pct).toBe(80)
    })

    it('counts each fingerprint once, live references only', () => {
      const entries = [
        {
          attachments: [
            ref('a'),
            ref('b', { removed: removedAt('2026-10-16T11:00:00Z') }),
          ],
        },
        { attachments: [ref('a')] },
      ]
      const u = budgetUsage(entries, { [sha('a')]: 30, [sha('b')]: 50 }, 100)
      expect(u.usedBytes).toBe(30)
    })

    it('a zero budget with bytes is over, and empty is ok', () => {
      expect(budgetUsage([{ attachments: [ref('a')] }], { [sha('a')]: 1 }, 0).level).toBe(
        'over'
      )
      expect(budgetUsage([], {}, 0).level).toBe('ok')
    })
  })

  describe('smaller copies (D-60 item 2, revised)', () => {
    const note = (where: 'sender' | 'receiver', by = 'K7ABC') => ({
      fromSha256: sha('o'),
      fromSize: 4404019,
      fromType: 'image/png',
      at: '2026-10-17T10:00:00Z',
      by,
      where,
    })
    const replacedAt = (at: string) => ({ at, by: 'N7XYZ', bySha256: sha('s') })

    it('isSmallerCopy follows the note', () => {
      expect(isSmallerCopy(ref('s'))).toBe(false)
      expect(isSmallerCopy(ref('s', { compressed: note('sender') }))).toBe(true)
    })

    it('labels the copies a sender and a receiver make', () => {
      expect(smallerCopyLabel(ref('s'))).toBe('')
      expect(smallerCopyLabel(ref('s', { compressed: note('sender') }))).toBe(
        "Smaller copy, made on K7ABC's phone from 4.2 MB"
      )
      expect(smallerCopyLabel(ref('s', { compressed: note('receiver', 'N7XYZ') }))).toBe(
        'Smaller copy made by N7XYZ from 4.2 MB; original kept'
      )
      expect(
        smallerCopyLabel(ref('s', { compressed: note('receiver', 'N7XYZ') }), false)
      ).toBe('Smaller copy made by N7XYZ from 4.2 MB; original replaced')
      expect(smallerCopyLabel(ref('s', { compressed: note('sender', ' ') }))).toContain(
        "the sender's phone"
      )
    })

    it('an original and its copy are two references, and the union keeps both', () => {
      const original = ref('o')
      const copy = ref('s', { compressed: note('receiver') })
      expect(mergeAttachmentRefs([original], [copy]).map((r) => r.sha256)).toEqual([
        sha('o'),
        sha('s'),
      ])
    })

    it('keeps the compressed note, first seen wins, and a side without one does not erase it', () => {
      const early = ref('s', {
        addedAt: '2026-10-17T09:00:00Z',
        compressed: note('sender', 'K7ABC'),
      })
      const late = ref('s', {
        addedAt: '2026-10-17T11:00:00Z',
        compressed: note('receiver', 'N7XYZ'),
      })
      expect(mergeAttachmentRefs([late], [early])[0].compressed?.by).toBe('K7ABC')
      const bare = ref('s', { addedAt: '2026-10-17T08:00:00Z' })
      expect(mergeAttachmentRefs([bare], [late])[0].compressed?.where).toBe('receiver')
    })

    it('replaced is sticky, keeps the earlier mark, and counts like removed', () => {
      const merged = mergeAttachmentRefs(
        [ref('o', { replaced: replacedAt('2026-10-17T12:00:00Z') })],
        [ref('o'), ref('o', { replaced: replacedAt('2026-10-17T11:00:00Z') })]
      )
      expect(merged[0].replaced?.at).toBe('2026-10-17T11:00:00Z')
      expect(isGone(merged[0])).toBe(true)
      const entries = [
        {
          attachments: [
            ref('o', { replaced: replacedAt('2026-10-17T11:00:00Z') }),
            ref('s'),
          ],
        },
      ]
      expect(liveRefs(entries[0]).map((r) => r.sha256)).toEqual([sha('s')])
      expect(removedOnly([sha('o'), sha('s')], entries)).toEqual([sha('o')])
      expect(
        budgetUsage(entries, { [sha('o')]: 90, [sha('s')]: 10 }, 100).usedBytes
      ).toBe(10)
    })

    it('the label in an entry says whether the original was kept or replaced', () => {
      const copy = ref('s', { compressed: note('receiver', 'N7XYZ') })
      const kept = { attachments: [ref('o'), copy] }
      const replaced = {
        attachments: [ref('o', { replaced: replacedAt('2026-10-17T11:00:00Z') }), copy],
      }
      expect(smallerCopyLabelIn(kept, copy)).toContain('original kept')
      expect(smallerCopyLabelIn(replaced, copy)).toContain('original replaced')
    })

    it('a name for a CSV says "(smaller copy)" for a copy only', () => {
      expect(nameWithKind(ref('o'))).toBe('o.jpg')
      expect(nameWithKind(ref('s', { compressed: note('sender') }))).toBe(
        's.jpg (smaller copy)'
      )
    })

    it('a print line carries the label for a smaller copy only', () => {
      const [a, b] = printAttachments({
        attachments: [ref('a'), ref('s', { compressed: note('sender') })],
      })
      expect(a.smallerCopy).toBeUndefined()
      expect(b.smallerCopy).toContain('Smaller copy')
    })
  })

  it('formatFingerprint shows the first 8 and last 4 characters', () => {
    expect(formatFingerprint('3f9a12c0' + 'e'.repeat(52) + 'b71e')).toBe('3f9a12c0…b71e')
    expect(formatFingerprint('abc')).toBe('abc')
  })
})
