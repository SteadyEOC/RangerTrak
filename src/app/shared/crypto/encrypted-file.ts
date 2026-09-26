/**
 * Encrypted export files (E-122 Phase 1).
 *
 * Wraps an arbitrary JSON payload in a self-describing envelope so a mission backup can
 * leave this device encrypted. Phase 1 deliberately covers **files that travel**, not data
 * at rest: `localStorage` is synchronous and Web Crypto is not, so encrypting storage means
 * making every service's write path async - see ARCHITECTURE.md's "Planned: encryption at
 * rest" for why that is paired with the IndexedDB migration instead.
 *
 * ## Choices, and why
 *
 * - **`crypto.subtle`, not `crypto-js`.** Native, audited, no dependency. The commented-out
 *   `crypto-js` fragments elsewhere in this codebase are an earlier abandoned attempt.
 * - **PBKDF2-SHA256, not Argon2.** Argon2 is the better KDF and is not available natively;
 *   adding a WASM dependency to an offline-first PWA that must stay small is not worth it
 *   here. Iterations are at the current OWASP guidance and are *stored in the envelope*, so
 *   raising them later does not strand files written today.
 * - **AES-GCM.** Authenticated: a corrupted or tampered file fails to decrypt rather than
 *   yielding plausible garbage that the import path would then try to apply.
 * - **Random salt and IV per file.** Never reused, never derived from the passphrase.
 *
 * ## What this does not protect against
 *
 * An attacker who has the app open and unlocked, or malicious code running in the page.
 * This defends a file that has left the device: a lost laptop, a USB stick, an email
 * forwarded further than intended.
 *
 * ## The dangerous failure
 *
 * There is no server, so there is no escrow and no reset. A forgotten passphrase destroys
 * that file permanently. Callers must confirm the passphrase before writing, and must say
 * plainly that it cannot be recovered.
 */

/** Marker + version. Present on every encrypted file this app writes. */
export const ENCRYPTED_FILE_FORMAT = 'rangertrak-encrypted-v1'

/** OWASP's current floor for PBKDF2-HMAC-SHA256. Stored per file, so this can rise later. */
export const PBKDF2_ITERATIONS = 310_000

const SALT_BYTES = 16
const IV_BYTES = 12   // 96 bits, the size AES-GCM is specified for

export type EncryptedFile = {
  format: typeof ENCRYPTED_FILE_FORMAT,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: number, salt: string },
  cipher: { name: 'AES-GCM', iv: string },
  /** Base64 AES-GCM output: ciphertext with its authentication tag appended. */
  ciphertext: string,
  /** Unencrypted, deliberately: lets a person identify a file without unlocking it. */
  hint?: { exportedAt?: string, appVersion?: string },
}

/**
 * True if `value` looks like one of our encrypted files.
 *
 * Structural, not a guess on file extension: the import path has to tell an encrypted
 * backup from a plain one after reading, whatever the file happens to be called.
 */
export function isEncryptedFile(value: unknown): value is EncryptedFile {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v['format'] === ENCRYPTED_FILE_FORMAT
    && typeof v['ciphertext'] === 'string'
    && typeof v['kdf'] === 'object' && v['kdf'] !== null
    && typeof v['cipher'] === 'object' && v['cipher'] !== null
}

/** Thrown when the passphrase is wrong, or the file has been altered. */
export class DecryptionFailedError extends Error {
  constructor() {
    super('Wrong passphrase, or the file has been altered or corrupted.')
    this.name = 'DecryptionFailedError'
  }
}

export async function encryptJson(
  payload: unknown, passphrase: string, hint?: EncryptedFile['hint'],
): Promise<EncryptedFile> {
  if (!passphrase) throw new Error('A passphrase is required to encrypt a file.')

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)

  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

  return {
    format: ENCRYPTED_FILE_FORMAT,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    ...(hint ? { hint } : {}),
  }
}

/**
 * Reverses encryptJson(). Throws DecryptionFailedError for a wrong passphrase or a tampered
 * file - AES-GCM's authentication makes those indistinguishable, which is the point.
 */
export async function decryptJson(file: EncryptedFile, passphrase: string): Promise<unknown> {
  if (!isEncryptedFile(file)) throw new Error('Not an encrypted RangerTrak file.')

  // Read the parameters from the FILE, not from our constants: a file written by an older
  // build (or a later one that raised the iteration count) must still open.
  const iterations = file.kdf.iterations
  if (!Number.isFinite(iterations) || iterations < 1) {
    throw new Error('Encrypted file declares an invalid iteration count.')
  }

  const key = await deriveKey(passphrase, fromBase64(file.kdf.salt), iterations)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(file.cipher.iv) }, key, fromBase64(file.ciphertext))
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new DecryptionFailedError()
  }
}

// Exported for shared/storage/record-encryption.ts (E-122 Phase 2b): it derives keys the
// same way (PBKDF2-SHA256, non-extractable AES-GCM-256) for encryption at rest, and reuses
// this rather than re-deciding the same parameters a second time. See that file's own doc
// comment for what is different about the at-rest case (many small records, one salt per
// device, a fresh IV per write rather than per file).
export async function deriveKey(
  passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'])
}

/**
 * Chunked on purpose. `btoa(String.fromCharCode(...bytes))` throws RangeError once the
 * spread exceeds the argument limit, and a mission backup with a photo-bearing roster gets
 * there easily - this only shows up on large real missions, never on a test fixture.
 */
// Exported for record-encryption.ts, same reasoning as deriveKey() above.
export function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

// Typed as Uint8Array<ArrayBuffer> rather than plain Uint8Array: since TS 5.7 the array is
// generic over ArrayBufferLike, and BufferSource - which crypto.subtle takes - excludes
// SharedArrayBuffer. The default parameterisation is not assignable.
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
