import {
  decryptBytes,
  DecryptionFailedError,
  encryptBytes,
} from '../crypto/encrypted-file'
import { RadioLogEntryType } from '../services/radio-log-entry.interface'
import { RangerType, UnknownRanger } from '../services/ranger.interface'
import {
  buildHandoverFile,
  classifyOpenedBytes,
  HANDOVER_KIND,
  openHandoverFile,
  readEnvelope,
} from './handover-file'
import {
  buildMissionZipBytes,
  entryCountOf,
  extractMissionZip,
  handoverFilename,
  layerFor,
  MISSION_ZIP_SCHEMA_VERSION,
  MissionZipManifest,
} from './mission-zip'

/** E-188 (ADR D-59): the hand-over file, plain and encrypted. */
describe('handover file', () => {
  const ranger = (over: Partial<RangerType>): RangerType => ({
    ...UnknownRanger,
    ...over,
  })
  const entry = (over: Partial<RadioLogEntryType> = {}): RadioLogEntryType => ({
    id: 0,
    uid: 'e-1',
    callsign: 'K7AAA',
    location: { lat: 47.4, lng: -122.4, address: '', derivedFromAddress: false },
    date: new Date('2026-10-15T10:00:00Z'),
    status: 'Normal',
    notes: 'n',
    ...over,
  })

  const input = (over = {}) => ({
    mission: 'Fern Hollow',
    event: 'Drill',
    opPeriod: '2',
    appVersion: '0.99.38',
    rangers: [ranger({ callsign: 'K7AAA', id: 'REW-1', uid: 'u1' })],
    locations: [],
    entries: [
      entry(),
      entry({ id: 1, uid: 'e-2', revisedAt: new Date('2026-10-15T11:00:00Z') }),
    ],
    photos: [{ stem: 'REW-1', blob: new Blob(['jpeg'], { type: 'image/jpeg' }) }],
    now: new Date('2026-10-15T14:32:10Z'),
    ...over,
  })

  describe('mission-zip with entries', () => {
    it('round-trips an entries category and counts it', async () => {
      const built: MissionZipManifest = {
        schemaVersion: MISSION_ZIP_SCHEMA_VERSION,
        exportedAt: '2026-10-15T00:00:00.000Z',
        appVersion: '1',
        entries: [entry()],
      }

      const { manifest } = extractMissionZip(await buildMissionZipBytes(built, []))

      expect(entryCountOf(manifest)).toBe(1)
      expect(manifest.entries?.[0].uid).toBe('e-1')
      // Dates come back as strings, which is why the merge rehydrates them.
      expect(typeof (manifest.entries?.[0].date as unknown)).toBe('string')
    })

    it('accepts a file whose only category is entries, and rejects entries that are not an array', async () => {
      const ok = {
        schemaVersion: 3,
        exportedAt: '2026-10-15T00:00:00.000Z',
        appVersion: '1',
        entries: [],
      }
      expect(
        extractMissionZip(await buildMissionZipBytes(ok, [])).manifest.entries
      ).toEqual([])

      const bad = { ...ok, entries: 'nope' } as unknown as MissionZipManifest
      const bytes = await buildMissionZipBytes(bad, [])
      expect(() => extractMissionZip(bytes)).toThrow()
    })

    it('layerFor lists entries, marks the layer personal information and records the kind', () => {
      const layer = layerFor({ entries: [] }, 'x', '2026-10-15', 'handover')

      expect(layer.contains).toEqual(['entries'])
      expect(layer.sensitivity).toBe('pii')
      expect(layer.kind).toBe('handover')
    })

    it('names the file like the other Setup files, plus handover and the time', () => {
      // The stamp is the device's local date and time, so build the expectation the same way.
      const at = new Date(2026, 9, 15, 14, 32)
      expect(handoverFilename('Fern Hollow!', at.toISOString(), false)).toBe(
        'rangertrak-setup-handover-Fern_Hollow_-20261015-1432.zip'
      )
      expect(handoverFilename('', at.toISOString(), true)).toBe(
        'rangertrak-setup-handover-mission-20261015-1432.rtenc.json'
      )
    })
  })

  describe('plain hand-over', () => {
    it('never carries the station letter (E-220: it stays on the device, not in a file sent around)', async () => {
      localStorage.setItem('rt-msg-station', 'Q')
      try {
        const file = await buildHandoverFile(input())
        const json = JSON.stringify(file.manifest)
        expect(json).not.toContain('msgStation')
        expect(json).not.toContain('devicePrefs')
        expect(json).not.toContain('rt-msg-station')
      } finally {
        localStorage.removeItem('rt-msg-station')
      }
    })

    it('carries people, entries, photos and the advisory context, but no settings', async () => {
      const file = await buildHandoverFile(input())

      expect(file.encrypted).toBe(false)
      expect(file.filename).toContain('handover')
      expect(readEnvelope(file.bytes)).toBeNull()

      const { manifest, photos } = await openHandoverFile(file.bytes)
      expect(manifest.layer?.kind).toBe('handover')
      expect(manifest.settings).toBeUndefined()
      expect(manifest.rangers?.length).toBe(1)
      expect(manifest.entries?.length).toBe(2)
      expect(manifest.context).toEqual({
        mission: 'Fern Hollow',
        event: 'Drill',
        opPeriod: '2',
      })
      expect(photos.length).toBe(1)
    })

    it('a blank passphrase writes plaintext', async () => {
      expect((await buildHandoverFile(input({ passphrase: '' }))).encrypted).toBe(false)
    })
  })

  describe('attachments folder (E-194)', () => {
    const sha = 'ab'.repeat(32)
    const file = (bytes: Uint8Array, over = {}) => ({
      sha256: sha,
      name: 'wash.jpg',
      type: 'image/jpeg',
      bytes,
      ...over,
    })

    it('carries the bytes in attachments/, stored not compressed, and reads them back', async () => {
      const bytes = new Uint8Array(4096).fill(7) // very compressible on purpose
      const built = await buildHandoverFile(input({ attachments: [file(bytes)] }))

      const { attachments, manifest } = await openHandoverFile(built.bytes)

      expect(attachments.length).toBe(1)
      expect(attachments[0].sha256).toBe(sha)
      expect(attachments[0].type).toBe('image/jpeg')
      expect([...attachments[0].bytes]).toEqual([...bytes])
      // Level 0: the zip is at least as big as the bytes it holds (a compressed zip would be tiny).
      expect(built.bytes.length).toBeGreaterThan(bytes.length)
      // No manifest change, so no schema bump for the folder alone.
      expect(manifest.schemaVersion).toBe(MISSION_ZIP_SCHEMA_VERSION)
    })

    it('a file in attachments/ is never mistaken for a ranger photo', async () => {
      const built = await buildHandoverFile(
        input({ attachments: [file(new Uint8Array([1, 2, 3]))] })
      )

      const { photos } = await openHandoverFile(built.bytes)

      expect(photos.map((p) => p.filename)).toEqual(['REW-1.jpg'])
    })

    it('a hand-over with none reads back an empty list', async () => {
      expect(
        (await openHandoverFile((await buildHandoverFile(input())).bytes)).attachments
      ).toEqual([])
    })

    it('round-trips through the passphrase envelope', async () => {
      const bytes = new Uint8Array([9, 8, 7, 6])
      const built = await buildHandoverFile(
        input({ attachments: [file(bytes)], passphrase: 'pw' })
      )

      const { attachments } = await openHandoverFile(built.bytes, 'pw')

      expect([...attachments[0].bytes]).toEqual([...bytes])
    })

    it('LARGE: a 64 MB attachment survives a plain and an encrypted hand-over byte for byte', async () => {
      const big = new Uint8Array(64 * 1024 * 1024)
      for (let i = 0; i < big.length; i += 4096) big[i] = (i / 4096) & 0xff
      const check = async (passphrase?: string) => {
        const built = await buildHandoverFile(
          input({
            attachments: [file(big, { type: 'video/mp4', name: 'run.mp4' })],
            passphrase,
          })
        )
        const { attachments } = await openHandoverFile(built.bytes, passphrase)
        expect(attachments[0].bytes.length).toBe(big.length)
        expect(attachments[0].bytes[4096 * 100]).toBe(100)
        return built.bytes.length
      }

      expect(await check()).toBeGreaterThan(big.length)
      expect(await check('pw')).toBeGreaterThan(big.length)
    }, 120000)
  })

  describe("encrypted hand-over (the backup's envelope around the zip)", () => {
    it('round-trips with the right passphrase', async () => {
      const file = await buildHandoverFile(input({ passphrase: 'correct horse' }))

      expect(file.encrypted).toBe(true)
      expect(file.filename).toContain('.rtenc.json')
      expect(readEnvelope(file.bytes)).not.toBeNull()
      // Nothing readable leaks into the envelope.
      expect(new TextDecoder().decode(file.bytes)).not.toContain('K7AAA')

      const { manifest } = await openHandoverFile(file.bytes, 'correct horse')
      expect(manifest.entries?.length).toBe(2)
    })

    it('a wrong passphrase says so, and a missing one asks for it', async () => {
      const file = await buildHandoverFile(input({ passphrase: 'correct horse' }))

      await expect(openHandoverFile(file.bytes, 'wrong')).rejects.toThrowError(
        DecryptionFailedError
      )
      await expect(openHandoverFile(file.bytes)).rejects.toThrowError(/passphrase/i)
    })

    it('encryptBytes / decryptBytes round-trip arbitrary bytes', async () => {
      const bytes = new Uint8Array([0, 1, 2, 250, 251, 255])

      const back = await decryptBytes(await encryptBytes(bytes, 'pw'), 'pw')

      expect([...back]).toEqual([...bytes])
    })
  })
  describe('classifyOpenedBytes (E-188 follow-up)', () => {
    it('tags an encrypted hand-over with hint.kind and classifies it without the passphrase', async () => {
      const file = await buildHandoverFile(input({ passphrase: 'pw' }))
      expect(readEnvelope(file.bytes)?.hint?.kind).toBe(HANDOVER_KIND)
      expect(classifyOpenedBytes(file.bytes).kind).toBe('encrypted-handover')
    })

    it('classifies a plain hand-over as a zip', async () => {
      const file = await buildHandoverFile(input())
      expect(classifyOpenedBytes(file.bytes).kind).toBe('zip')
    })

    it('classifies an old envelope with no kind (every backup so far) as another encrypted file', async () => {
      const env = await encryptBytes(
        new TextEncoder().encode('{}') as Uint8Array<ArrayBuffer>,
        'pw',
        { exportedAt: '2026-09-22' }
      )
      expect(
        classifyOpenedBytes(new TextEncoder().encode(JSON.stringify(env))).kind
      ).toBe('encrypted-other')
      const bare = await encryptBytes(
        new TextEncoder().encode('{}') as Uint8Array<ArrayBuffer>,
        'pw'
      )
      expect(
        classifyOpenedBytes(new TextEncoder().encode(JSON.stringify(bare))).kind
      ).toBe('encrypted-other')
    })

    it('classifies anything else as unknown', () => {
      expect(classifyOpenedBytes(new TextEncoder().encode('{"a":1}')).kind).toBe(
        'unknown'
      )
      expect(classifyOpenedBytes(new Uint8Array(0)).kind).toBe('unknown')
    })
  })
})
