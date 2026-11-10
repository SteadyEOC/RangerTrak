import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import type { AttachmentRef } from '../../domain/attachments'
import { AttachmentStoreService, sha256Hex } from '../services/attachment-store.service'
import { OperatorNameService } from '../services/operator-name.service'
import { RadioLogService } from '../services/radio-log.service'
import { recordStore } from '../storage/record-store'
import { AttachmentBudgetService } from './attachment-budget.service'
import { AttachmentIntakeService } from './attachment-intake.service'
import { ALREADY_SMALL_NOTE } from './compress/compress-types'

/** E-194 / D-60 item 2 (revised): the sender's choice at Attach, end to end through the real store. */
describe('AttachmentIntakeService - smaller copy', () => {
  let intake: AttachmentIntakeService
  let store: AttachmentStoreService
  let merged: AttachmentRef[]

  async function photo(w: number, h: number): Promise<File> {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(w, h)
    let seed = 99
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const n = (seed % 9) - 4
      image.data[i] = (((i / 4) % w) * 255) / w + n
      image.data[i + 1] = n + 128
      image.data[i + 2] = 200 + n
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    return new File([blob], 'scene.png', {
      type: 'image/png',
      lastModified: Date.UTC(2026, 9, 17, 9, 0),
    })
  }

  beforeEach(async () => {
    merged = []
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: RadioLogService,
          useValue: {
            mergeEntryAttachments: (_uid: string, refs: AttachmentRef[]) => {
              merged.push(...refs)
            },
          },
        },
        { provide: OperatorNameService, useValue: { name: () => 'K7ABC' } },
        { provide: AttachmentBudgetService, useValue: {} },
      ],
    })
    intake = TestBed.inject(AttachmentIntakeService)
    store = TestBed.inject(AttachmentStoreService)
    await store.whenReady()
    await store.sweepOrphans([])
  })

  afterEach(async () => {
    await store.sweepOrphans([])
    await recordStore.resetForTests()
  })

  it('Keep original is the default: pend() selects it and offers a smaller copy', async () => {
    const [p] = await intake.pend([await photo(300, 200)])
    expect(p.smaller).toBe(false)
    expect(p.offer).toBe(true)
  })

  it('Keep original stores the original and carries no compressed note', async () => {
    const file = await photo(1200, 800)
    const [p] = await intake.pend([file])
    const { added } = await intake.attach('uid-1', [p], false)
    expect(added.length).toBe(1)
    expect(added[0].compressed).toBeUndefined()
    expect(added[0].sha256).toBe(await sha256Hex(await file.arrayBuffer()))
    expect(await store.has(added[0].sha256)).toBe(true)
  })

  it("Smaller copy stores ONLY the smaller copy, and records the original's fingerprint, size, type, who and where", async () => {
    const file = await photo(3000, 2000)
    const [p] = await intake.pend([file])
    const { added, notes } = await intake.attach(
      'uid-1',
      [{ ...p, smaller: true }],
      false
    )
    const originalSha = await sha256Hex(await file.arrayBuffer())
    expect(notes).toEqual([])
    expect(added.length).toBe(1)
    const ref = added[0]
    expect(ref.type).toBe('image/jpeg')
    expect(ref.size).toBeLessThan(file.size)
    expect(ref.sha256).not.toBe(originalSha)
    expect(ref.compressed).toEqual(
      expect.objectContaining({
        fromSha256: originalSha,
        fromSize: file.size,
        fromType: 'image/png',
        by: 'K7ABC',
        where: 'sender',
      })
    )
    expect(await store.has(ref.sha256)).toBe(true)
    expect(await store.has(originalSha)).toBe(false)
    expect(merged.map((r) => r.sha256)).toEqual([ref.sha256])
    expect(Object.values(await store.sizes())).toEqual([ref.size])
  })

  it('keeps the original, and says so, when the smaller copy is not smaller', async () => {
    const file = await photo(8, 8)
    const [p] = await intake.pend([file])
    const { added, notes } = await intake.attach(
      'uid-1',
      [{ ...p, smaller: true }],
      false
    )
    expect(notes).toEqual([ALREADY_SMALL_NOTE])
    expect(added[0].compressed).toBeUndefined()
    expect(added[0].sha256).toBe(await sha256Hex(await file.arrayBuffer()))
  })
})
