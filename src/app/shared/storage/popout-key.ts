import { recordStore } from './record-store'

/**
 * E-313 (Q77, John 2026-11-16): on an encrypted device a pop-out never asks for the passphrase. The
 * main window, which already unlocked, hands its `CryptoKey` to the window it opened by `postMessage`.
 *
 * The key travels in memory only: it is never put in the URL, localStorage, IndexedDB or the data
 * channel (shared/storage/data-channel.ts), and the passphrase never leaves the main window at all.
 * Both ends check that the message came from this origin, and the main window answers only a window
 * it opened itself (`source.opener === window`), so another page on the same site cannot ask for it.
 *
 * A read-only window with no opener (the blocked-tab gate's "Open a read-only view here") has nobody
 * to ask, and falls back to the passphrase form.
 */

const REQUEST = 'rangertrak-popout-key-request'
const REPLY = 'rangertrak-popout-key'

/** The main window: answers a key request from a window it opened. Call once at boot, not in a read-only window. */
export function installKeyHandover(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== location.origin) return
    if ((event.data as { type?: string } | null)?.type !== REQUEST) return
    const source = event.source as Window | null
    if (!source || source.opener !== window) return
    const key = recordStore.getEncryptionKey()
    if (!key) return // not encrypted, or still locked: nothing to hand over
    source.postMessage({ type: REPLY, key }, location.origin)
  })
}

/**
 * A pop-out: asks the window that opened it for the key. Resolves null when there is no opener, it
 * does not answer within `timeoutMs`, or it has no key; the caller then shows the passphrase form.
 */
export function requestKeyFromOpener(timeoutMs = 3000): Promise<CryptoKey | null> {
  const opener = window.opener as Window | null
  if (!opener || opener === window) return Promise.resolve(null)
  return new Promise<CryptoKey | null>(resolve => {
    const finish = (key: CryptoKey | null) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(key)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== opener) return
      const data = event.data as { type?: string, key?: unknown } | null
      if (data?.type === REPLY && typeof CryptoKey !== 'undefined' && data.key instanceof CryptoKey) finish(data.key)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    window.addEventListener('message', onMessage)
    try { opener.postMessage({ type: REQUEST }, location.origin) } catch { finish(null) }
  })
}
