import {
  createEncryptionMarker, decryptPhoto, decryptRecordValue, encryptPhoto, encryptRecordValue,
  isEncryptedEnvelope, isEncryptionMarker, unlockWithPassphrase,
} from './record-encryption'

/**
 * E-122 Phase 2b's actual cryptography, isolated from RecordStore/RangerPhotoService so a
 * failure here points straight at the primitive rather than at IndexedDB plumbing.
 */
describe('record-encryption', () => {
  const PASS = 'correct horse battery staple'

  describe('createEncryptionMarker / unlockWithPassphrase (key derivation round trip)', () => {
    it('derives a working key from the right passphrase', async () => {
      const { marker, key } = await createEncryptionMarker(PASS)
      const unlocked = await unlockWithPassphrase(marker, PASS)
      expect(unlocked).not.toBeNull()

      // Both keys should decrypt the same envelope interchangeably - proof they are the
      // same derived key, not just "some key that happens to also verify".
      const envelope = await encryptRecordValue(key, 'hello')
      expect(await decryptRecordValue(unlocked!, envelope)).toBe('hello')
    })

    it('rejects a wrong passphrase via the verifier, not a string compare', async () => {
      const { marker } = await createEncryptionMarker(PASS)
      expect(await unlockWithPassphrase(marker, 'wrong horse')).toBeNull()
    })

    it('rejects an empty-string wrong passphrase too', async () => {
      const { marker } = await createEncryptionMarker(PASS)
      expect(await unlockWithPassphrase(marker, '')).toBeNull()
    })

    it('marker carries the current PBKDF2 iteration count, stored so it can rise later', async () => {
      const { marker } = await createEncryptionMarker(PASS)
      expect(marker.iterations).toBeGreaterThan(0)
      expect(marker.version).toBe(1)
    })

    it('rejects a marker with a corrupted iteration count rather than throwing', async () => {
      const { marker } = await createEncryptionMarker(PASS)
      const corrupted = { ...marker, iterations: 0 }
      expect(await unlockWithPassphrase(corrupted, PASS)).toBeNull()
    })
  })

  describe('isEncryptionMarker', () => {
    it('recognises our own marker', async () => {
      const { marker } = await createEncryptionMarker(PASS)
      expect(isEncryptionMarker(marker)).toBe(true)
    })

    it('rejects null, junk, and a record envelope on its own', async () => {
      expect(isEncryptionMarker(null)).toBe(false)
      expect(isEncryptionMarker('a string')).toBe(false)
      expect(isEncryptionMarker({})).toBe(false)
      const { key } = await createEncryptionMarker(PASS)
      const envelope = await encryptRecordValue(key, 'x')
      expect(isEncryptionMarker(envelope)).toBe(false)
    })
  })

  describe('encryptRecordValue / decryptRecordValue', () => {
    it('round-trips a plaintext string', async () => {
      const { key } = await createEncryptionMarker(PASS)
      const envelope = await encryptRecordValue(key, JSON.stringify({ rangers: [{ callsign: 'ZZZ1' }] }))
      expect(await decryptRecordValue(key, envelope)).toBe(JSON.stringify({ rangers: [{ callsign: 'ZZZ1' }] }))
    })

    it('leaves no plaintext in the envelope', async () => {
      const { key } = await createEncryptionMarker(PASS)
      const envelope = await encryptRecordValue(key, 'super-secret-callsign-ZZZ9')
      expect(JSON.stringify(envelope)).not.toContain('super-secret-callsign-ZZZ9')
    })

    // AES-GCM's whole point: a wrong key must fail authentication, not decrypt to garbage.
    it('rejects decryption under a different key', async () => {
      const a = await createEncryptionMarker(PASS)
      const b = await createEncryptionMarker('a different passphrase entirely')
      const envelope = await encryptRecordValue(a.key, 'hello')
      await expectAsync(decryptRecordValue(b.key, envelope)).toBeRejected()
    })

    it('uses a fresh IV on every single write, even for the same plaintext and key', async () => {
      const { key } = await createEncryptionMarker(PASS)
      const ivs = new Set<string>()
      for (let i = 0; i < 20; i++) {
        const envelope = await encryptRecordValue(key, 'the same plaintext every time')
        ivs.add(envelope.iv)
      }
      expect(ivs.size).toBe(20)
    })
  })

  describe('isEncryptedEnvelope', () => {
    it('recognises our own envelope shape', async () => {
      const { key } = await createEncryptionMarker(PASS)
      expect(isEncryptedEnvelope(await encryptRecordValue(key, 'x'))).toBe(true)
    })

    // The whole point of this function: a plain RangerService/RadioLogService JSON blob must
    // never be mistaken for one of our envelopes.
    it('rejects plaintext record shapes, null and junk', () => {
      expect(isEncryptedEnvelope({ schemaVersion: 1, rangers: [] })).toBe(false)
      expect(isEncryptedEnvelope({ version: '1', logEntries: [] })).toBe(false)
      expect(isEncryptedEnvelope(null)).toBe(false)
      expect(isEncryptedEnvelope('a string')).toBe(false)
      expect(isEncryptedEnvelope({ iv: 'x' })).toBe(false) // missing ciphertext
      expect(isEncryptedEnvelope({ iv: 'x', ciphertext: 'y', extra: 'z' })).toBe(false) // extra field
    })
  })

  describe('encryptPhoto / decryptPhoto (binary, for RangerPhotoService)', () => {
    it('round-trips arbitrary bytes', async () => {
      const { key } = await createEncryptionMarker(PASS)
      const plaintext = new Uint8Array([1, 2, 3, 4, 250, 251, 252, 0, 255]).buffer
      const { iv, ciphertext } = await encryptPhoto(key, plaintext)
      const decrypted = await decryptPhoto(key, iv, ciphertext)
      expect(new Uint8Array(decrypted)).toEqual(new Uint8Array(plaintext))
    })

    it('uses a fresh IV per photo write too', async () => {
      const { key } = await createEncryptionMarker(PASS)
      const plaintext = new Uint8Array([9, 9, 9]).buffer
      const a = await encryptPhoto(key, plaintext)
      const b = await encryptPhoto(key, plaintext)
      expect(a.iv).not.toEqual(b.iv)
      expect(new Uint8Array(a.ciphertext)).not.toEqual(new Uint8Array(b.ciphertext))
    })
  })
})
