import { provideHttpClient } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'

import { recordStore } from '../storage/record-store'
import {
  ATTACHMENTS_DB_NAME,
  AttachmentStoreService,
  FingerprintMismatchError,
  sha256Hex,
} from './attachment-store.service'

/** Reads a record straight out of an attachments object store, independent of the service's own
 *  internals, and never creates the database (same idea as ranger-photo.service.spec.ts). */
function readRaw(store: 'originals' | 'thumbs', sha: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACHMENTS_DB_NAME)
    req.onsuccess = () => {
      const db = req.result
      const getReq = db.transaction(store, 'readonly').objectStore(store).get(sha)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result)
      }
      getReq.onerror = () => {
        db.close()
        reject(getReq.error)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

async function pngFile(name: string, w = 600, h = 300): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c33'
  ctx.fillRect(0, 0, w, h)
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
  return new File([blob], name, {
    type: 'image/png',
    lastModified: Date.UTC(2026, 9, 16, 12, 0, 0),
  })
}

/** ADR D-60 / E-194: bytes stored by fingerprint, never altered, deleted only by the one sweep. */
describe('AttachmentStoreService', () => {
  let service: AttachmentStoreService

  const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer())
  const wav = (name = 'memo.wav') =>
    new File([new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5, 6, 7, 8])], name, {
      type: 'audio/wav',
      lastModified: 1700000000000,
    })

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient()] })
    service = TestBed.inject(AttachmentStoreService)
    await service.whenReady()
    await service.sweepOrphans([])
  })

  afterEach(async () => {
    await service.sweepOrphans([])
    await recordStore.resetForTests()
  })

  it('add() stores the original byte for byte and returns a reference with its SHA-256', async () => {
    const file = wav()
    const ref = await service.add(file, 'K7ABC')

    const expected = await sha256Hex(await file.arrayBuffer())
    expect(ref.sha256).toBe(expected)
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(ref).toEqual(
      expect.objectContaining({
        name: 'memo.wav',
        type: 'audio/wav',
        size: 12,
        addedBy: 'K7ABC',
      })
    )
    expect(ref.capturedAt).toBe(new Date(1700000000000).toISOString())
    expect(await bytesOf(await service.getOriginal(ref.sha256))).toEqual(
      new Uint8Array(await file.arrayBuffer())
    )
    expect(await service.has(ref.sha256)).toBe(true)
  })

  it('stores the same file once, however many times it is added', async () => {
    const a = await service.add(wav('one.wav'), 'K7ABC')
    const b = await service.add(wav('two.wav'), 'K7XYZ')

    expect(a.sha256).toBe(b.sha256)
    expect(Object.keys(await service.sizes())).toEqual([a.sha256])
  })

  it('keeps an image original unchanged and makes a small JPEG thumbnail beside it', async () => {
    const file = await pngFile('wash.png')
    const ref = await service.add(file, 'K7ABC')

    expect(await bytesOf(await service.getOriginal(ref.sha256))).toEqual(
      new Uint8Array(await file.arrayBuffer())
    )
    const thumb = await service.getThumb(ref.sha256)
    expect(thumb?.type).toBe('image/jpeg')
    const bitmap = await createImageBitmap(thumb!)
    expect(Math.max(bitmap.width, bitmap.height)).toBe(240)
  })

  it('makes no thumbnail for audio', async () => {
    const ref = await service.add(wav(), 'K7ABC')
    expect(await service.getThumb(ref.sha256)).toBeUndefined()
  })

  it('putVerified() stores bytes that match, and refuses ones that do not (storing nothing)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sha = await sha256Hex(bytes.buffer)

    await service.putVerified(sha, bytes, 'audio/wav')
    expect(await service.has(sha)).toBe(true)

    const wrong = 'f'.repeat(64)
    await expect(service.putVerified(wrong, bytes, 'audio/wav')).rejects.toThrowError(
      FingerprintMismatchError
    )
    expect(await service.has(wrong)).toBe(false)
  })

  it('sizes() reports each original once', async () => {
    const ref = await service.add(wav(), 'K7ABC')
    expect(await service.sizes()).toEqual({ [ref.sha256]: 12 })
  })

  it('sweepOrphans() deletes only what no reference names, and a removed-but-referenced file is kept', async () => {
    const live = await service.add(wav('a.wav'), 'K7ABC')
    const removed = await service.add(
      new File([new Uint8Array([9, 9, 9])], 'b.wav', { type: 'audio/wav' }),
      'K7ABC'
    )
    const orphan = await service.add(
      new File([new Uint8Array([8, 8, 8])], 'c.wav', { type: 'audio/wav' }),
      'K7ABC'
    )
    const entries = [
      {
        attachments: [
          live,
          { ...removed, removed: { at: '2026-10-16T12:00:00Z', by: 'K7ABC' } },
        ],
      },
    ]

    const gone = await service.sweepOrphans(entries)

    expect(gone).toBe(1)
    expect(await service.has(live.sha256)).toBe(true)
    expect(await service.has(removed.sha256)).toBe(true)
    expect(await service.has(orphan.sha256)).toBe(false)
    expect(await service.sweepOrphans([])).toBe(2)
    expect(await service.sizes()).toEqual({})
  })

  it('releaseRemoved() deletes bytes only removed references name, never ones a live reference still names', async () => {
    const removedOnlyRef = await service.add(wav('a.wav'), 'K7ABC')
    const stillLive = await service.add(
      new File([new Uint8Array([9, 9, 9])], 'b.wav', { type: 'audio/wav' }),
      'K7ABC'
    )
    const mark = { at: '2026-10-16T12:00:00Z', by: 'K7ABC' }
    const entries = [
      {
        attachments: [
          { ...removedOnlyRef, removed: mark },
          { ...stillLive, removed: mark },
        ],
      },
      { attachments: [stillLive] },
    ]

    expect(await service.releaseRemoved(entries)).toBe(1)

    expect(await service.has(removedOnlyRef.sha256)).toBe(false)
    expect(await service.has(stillLive.sha256)).toBe(true)
  })

  it('deletionNotice() says how many attachments would go, and nothing when none would', async () => {
    const ref = await service.add(wav(), 'K7ABC')
    expect(await service.deletionNotice([{ attachments: [ref] }])).toBe('')
    expect(await service.deletionNotice([])).toContain('1 attachment (12 B)')
  })

  // ── D-51: encrypted at rest under RecordStore's session key ──────────────
  describe('encryption at rest', () => {
    it('stores encrypted once RecordStore has a key, and still opens', async () => {
      await recordStore.enableEncryption('a device passphrase')
      const file = await pngFile('enc.png')

      const ref = await service.add(file, 'K7ABC')

      const raw = await readRaw('originals', ref.sha256)
      expect(raw.encrypted).toBe(true)
      expect(raw.size).toBe(file.size)
      expect((await readRaw('thumbs', ref.sha256)).encrypted).toBe(true)
      expect(await bytesOf(await service.getOriginal(ref.sha256))).toEqual(
        new Uint8Array(await file.arrayBuffer())
      )
      expect(await service.getThumb(ref.sha256)).toBeDefined()
      expect((await service.sizes())[ref.sha256]).toBe(file.size)
    })

    it('encryptAll() then decryptAll() round-trips files stored before and after', async () => {
      const file = await pngFile('rt.png')
      const ref = await service.add(file, 'K7ABC')
      expect((await readRaw('originals', ref.sha256)).encrypted).toBeUndefined()

      await recordStore.enableEncryption('a device passphrase')
      const key = recordStore.getEncryptionKey()!
      await service.encryptAll(key)
      expect((await readRaw('originals', ref.sha256)).encrypted).toBe(true)
      expect((await readRaw('thumbs', ref.sha256)).encrypted).toBe(true)
      expect(await bytesOf(await service.getOriginal(ref.sha256))).toEqual(
        new Uint8Array(await file.arrayBuffer())
      )

      await service.decryptAll(key)
      const plain = await readRaw('originals', ref.sha256)
      expect(plain.encrypted).toBeUndefined()
      expect(plain.blob instanceof Blob).toBe(true)
      expect(await bytesOf(await service.getOriginal(ref.sha256))).toEqual(
        new Uint8Array(await file.arrayBuffer())
      )
    })
  })
})
