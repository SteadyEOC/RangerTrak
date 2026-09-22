import {
  DecryptionFailedError, ENCRYPTED_FILE_FORMAT, PBKDF2_ITERATIONS,
  decryptJson, encryptJson, isEncryptedFile,
} from './encrypted-file'

describe('encrypted export files', () => {
  const payload = { mission: 'Vashon SAR', rangers: [{ callsign: 'CERT1', phone: '555-0100' }] }
  const PASS = 'correct horse battery staple'

  it('round-trips a payload', async () => {
    const file = await encryptJson(payload, PASS)
    expect(await decryptJson(file, PASS)).toEqual(payload)
  })

  // The whole point: the personal data must not be readable in the written file.
  it('leaves no plaintext in the file', async () => {
    const serialised = JSON.stringify(await encryptJson(payload, PASS))
    expect(serialised).not.toContain('Vashon SAR')
    expect(serialised).not.toContain('CERT1')
    expect(serialised).not.toContain('555-0100')
  })

  it('rejects the wrong passphrase', async () => {
    const file = await encryptJson(payload, PASS)
    await expectAsync(decryptJson(file, 'wrong')).toBeRejectedWithError(DecryptionFailedError)
  })

  it('rejects an empty passphrase rather than encrypting with nothing', async () => {
    await expectAsync(encryptJson(payload, '')).toBeRejected()
  })

  // AES-GCM is authenticated: a tampered file must fail, not decrypt to garbage the
  // import path would then try to apply.
  it('detects tampering with the ciphertext', async () => {
    const file = await encryptJson(payload, PASS)
    const bytes = atob(file.ciphertext).split('')
    bytes[0] = String.fromCharCode(bytes[0].charCodeAt(0) ^ 0xff)
    file.ciphertext = btoa(bytes.join(''))
    await expectAsync(decryptJson(file, PASS)).toBeRejectedWithError(DecryptionFailedError)
  })

  it('uses a fresh salt and IV every time, so two exports never match', async () => {
    const a = await encryptJson(payload, PASS)
    const b = await encryptJson(payload, PASS)
    expect(a.kdf.salt).not.toEqual(b.kdf.salt)
    expect(a.cipher.iv).not.toEqual(b.cipher.iv)
    expect(a.ciphertext).not.toEqual(b.ciphertext)
  })

  // Iterations are read back from the file, so raising PBKDF2_ITERATIONS later must not
  // strand files written today.
  it('honours the iteration count stored in the file, not the current constant', async () => {
    const file = await encryptJson(payload, PASS)
    expect(file.kdf.iterations).toBe(PBKDF2_ITERATIONS)
    file.kdf.iterations = PBKDF2_ITERATIONS // unchanged: proves decrypt reads it
    expect(await decryptJson(file, PASS)).toEqual(payload)

    const bumped = { ...file, kdf: { ...file.kdf, iterations: PBKDF2_ITERATIONS + 1 } }
    await expectAsync(decryptJson(bumped, PASS)).toBeRejectedWithError(DecryptionFailedError)
  })

  it('survives a payload larger than the base64 chunk size', async () => {
    const big = { notes: 'x'.repeat(200_000) }
    expect(await decryptJson(await encryptJson(big, PASS), PASS)).toEqual(big)
  })

  it('carries an optional plaintext hint so a file is identifiable while locked', async () => {
    const file = await encryptJson(payload, PASS, { exportedAt: '2026-09-22', appVersion: '0.93.0' })
    expect(file.hint?.exportedAt).toBe('2026-09-22')
  })

  describe('isEncryptedFile', () => {
    it('recognises our own output', async () => {
      expect(isEncryptedFile(await encryptJson(payload, PASS))).toBe(true)
    })

    // A plain mission backup must still import, so this must never claim one.
    it('rejects a plain mission export, null and junk', () => {
      expect(isEncryptedFile({ schemaVersion: 1, settings: {}, rangers: [] })).toBe(false)
      expect(isEncryptedFile(null)).toBe(false)
      expect(isEncryptedFile('a string')).toBe(false)
      expect(isEncryptedFile({ format: ENCRYPTED_FILE_FORMAT })).toBe(false) // marker alone
    })
  })
})
