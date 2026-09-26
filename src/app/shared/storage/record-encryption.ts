import { PBKDF2_ITERATIONS, deriveKey, fromBase64, toBase64 } from '../crypto/encrypted-file'

/**
 * E-122 Phase 2b: the encryption primitives `RecordStore` (roster/field reports) and
 * `RangerPhotoService` (photos) both build on. Deliberately thin - the actual AES-GCM/PBKDF2
 * choices already live in `shared/crypto/encrypted-file.ts` (Phase 1, encrypted exports) and
 * are reused here rather than re-decided, so "how this app encrypts something" has one
 * answer, not two that happen to agree today.
 *
 * WHAT'S DIFFERENT FROM encrypted-file.ts
 * -----------------------------------------
 * Phase 1 encrypts a whole FILE once, with its own salt and IV, and the passphrase is asked
 * for at that moment. Phase 2b encrypts many small RECORDS over a whole session with one
 * passphrase: one salt per device (carried in the marker below, spent once at unlock to
 * derive the session key) but a FRESH random IV on every single write - AES-GCM's security
 * depends on an IV never repeating under the same key, and a session that writes the same
 * record key hundreds of times (a busy Radio Log) would repeat a per-file IV strategy
 * immediately.
 *
 * THE MARKER
 * -----------
 * A plaintext record - never itself encrypted, never in `MIGRATED_KEYS`/`ENCRYPTED_KEYS` -
 * that lets `RecordStore.load()` (called before Angular exists, see main.ts) tell "ask for a
 * passphrase" apart from "nothing to unlock" without decrypting anything first. `verifier` is
 * this marker's own tiny encrypted record: a fixed, known plaintext encrypted under the
 * derived key. A wrong passphrase derives a DIFFERENT key, and AES-GCM's authentication tag
 * makes decrypting under the wrong key fail outright rather than produce plausible garbage -
 * so the passphrase check is "did this decrypt", never a string compare of anything secret.
 *
 * SELF-DESCRIBING RECORDS, NOT MARKER-DRIVEN DECISIONS
 * -------------------------------------------------------
 * `isEncryptedEnvelope()` lets `RecordStore.load()`/`drain()` decide PER RECORD whether it
 * needs decrypting/encrypting, the same structural-detection idea `encrypted-file.ts` already
 * uses for whole files (`isEncryptedFile()`). That means a half-migrated state - some records
 * already re-encrypted after "Enable", some not yet - never has to be reasoned about
 * specially: each record just carries its own answer.
 */

/** Reserved `kv`-store key. Never in `MIGRATED_KEYS`/`ENCRYPTED_KEYS` - always plaintext. */
export const ENCRYPTION_MARKER_KEY = '__encryption'

/**
 * The only RecordStore keys Phase 2b ever encrypts (maintainer's decision, 2026-09-26): the
 * roster and field reports carry the concentrated PII risk. `locations` and every
 * localStorage-only key (settings, UI prefs) stay in the clear - see ARCHITECTURE.md's
 * "Encryption: exports today, storage later".
 */
export const ENCRYPTED_KEYS = ['rangers', 'radioLog', 'radioLog-BAD'] as const

const VERIFIER_PLAINTEXT = 'rangertrak-encryption-verifier-v1'
const SALT_BYTES = 16
const IV_BYTES = 12 // 96 bits, the size AES-GCM is specified for - same as encrypted-file.ts

export type EncryptedEnvelope = { iv: string, ciphertext: string }

export type EncryptionMarker = {
  version: 1,
  salt: string,
  iterations: number,
  verifier: EncryptedEnvelope,
}

/** Structural check, same reasoning as encrypted-file.ts's isEncryptedFile(). */
export function isEncryptionMarker(value: unknown): value is EncryptionMarker {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const verifier = v['verifier'] as Record<string, unknown> | undefined
  return v['version'] === 1
    && typeof v['salt'] === 'string'
    && typeof v['iterations'] === 'number'
    && typeof verifier === 'object' && verifier !== null
    && typeof verifier['iv'] === 'string' && typeof verifier['ciphertext'] === 'string'
}

/**
 * True if `value` is one of this file's own record envelopes, as opposed to a plaintext
 * RangerService/RadioLogService JSON blob - the two are structurally distinguishable because
 * neither service's own JSON shape is an object with exactly (and only) an `iv`/`ciphertext`
 * pair of strings. See this file's header comment for why this - not the marker - is what
 * `RecordStore.load()`/`drain()` actually branch on per record.
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const keys = Object.keys(value)
  if (keys.length !== 2) return false
  const v = value as Record<string, unknown>
  return typeof v['iv'] === 'string' && typeof v['ciphertext'] === 'string'
}

/** Fresh salt, fresh derived (non-extractable) key, and a marker ready to write to `kv`. */
export async function createEncryptionMarker(
  passphrase: string,
): Promise<{ marker: EncryptionMarker, key: CryptoKey }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const verifier = await encryptRecordValue(key, VERIFIER_PLAINTEXT)
  return {
    marker: { version: 1, salt: toBase64(salt), iterations: PBKDF2_ITERATIONS, verifier },
    key,
  }
}

/**
 * Re-derives the key from `passphrase` using the marker's own stored salt/iterations, then
 * checks it by decrypting the verifier. Returns the derived (non-extractable) key on a match,
 * or null - never throws - on a wrong passphrase or a corrupted marker, so every caller can
 * treat this as a plain yes/no.
 */
export async function unlockWithPassphrase(
  marker: EncryptionMarker, passphrase: string,
): Promise<CryptoKey | null> {
  if (!Number.isFinite(marker.iterations) || marker.iterations < 1) return null
  const key = await deriveKey(passphrase, fromBase64(marker.salt), marker.iterations)
  try {
    const plaintext = await decryptRecordValue(key, marker.verifier)
    return plaintext === VERIFIER_PLAINTEXT ? key : null
  } catch {
    // AES-GCM's authentication tag fails under the wrong key - this IS the "wrong passphrase"
    // signal, not a side channel that needs guarding. See this file's header comment.
    return null
  }
}

/**
 * Encrypts one record's plaintext JSON string with a FRESH random IV - see this file's header
 * comment for why every write gets its own, never a per-store or per-record fixed one.
 */
export async function encryptRecordValue(key: CryptoKey, plaintext: string): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

/**
 * Reverses encryptRecordValue(). Throws (AES-GCM authentication failure) on a wrong key or
 * tampering - callers treat that as "this one record is unreadable," never as a boot or write
 * failure for the whole store.
 */
export async function decryptRecordValue(key: CryptoKey, envelope: EncryptedEnvelope): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ciphertext))
  return new TextDecoder().decode(plaintext)
}

/**
 * Binary counterparts of the two functions above, for `RangerPhotoService`. A photo is
 * already a Blob/ArrayBuffer, and base64-encoding one (the way the string envelope above
 * does) would both bloat it by a third and hit encrypted-file.ts's own chunked-base64
 * workaround for nothing: IndexedDB stores binary natively, so the IV and ciphertext travel
 * as themselves rather than as text.
 */
export async function encryptPhoto(
  key: CryptoKey, plaintext: ArrayBuffer,
): Promise<{ iv: Uint8Array<ArrayBuffer>, ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv, ciphertext }
}

/** Reverses encryptPhoto(). Same failure semantics as decryptRecordValue() above. */
export async function decryptPhoto(
  key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ciphertext: ArrayBuffer,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
}
