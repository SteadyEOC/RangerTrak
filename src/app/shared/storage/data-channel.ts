/**
 * E-313 / ADR D-71: how a pop-out keeps up with the main window. The main window announces each
 * stored key it has just flushed on one BroadcastChannel; a pop-out hears it and re-reads that key.
 *
 * The message is the KEY NAME ONLY: `{ key: 'radioLog' }`. Never the value, never anything from it:
 * the roster and radio log hold names, addresses and phone numbers, and the channel is not the place
 * for them. Same browser, same origin, same device: nothing here leaves the machine (rule 2).
 *
 * localStorage keys (the mission settings) need no message: the browser's own `storage` event reaches
 * the other windows by itself. See PopOutSyncService, which listens to both.
 */

export const DATA_CHANNEL = 'rangertrak-data'

export interface DataMessage { readonly key: string }

let channel: BroadcastChannel | null | undefined

function open(): BroadcastChannel | null {
  if (channel === undefined) {
    try { channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DATA_CHANNEL) } catch { channel = null }
  }
  return channel
}

/** The main window, right after a key reached IndexedDB. Never throws: syncing is never the reason a save fails. */
export function announceWrite(key: string): void {
  try { open()?.postMessage({ key } satisfies DataMessage) } catch { /* a closed channel: nobody is listening */ }
}

/** A pop-out: calls `onKey` for each announced key. Returns a function that stops listening. */
export function listenForWrites(onKey: (key: string) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  // A channel of its own: a BroadcastChannel never hears its own posts, but the main window's announcer must not be closed with this one.
  const mine = new BroadcastChannel(DATA_CHANNEL)
  mine.onmessage = (e: MessageEvent<DataMessage>) => {
    const key = e.data?.key
    if (typeof key === 'string') onKey(key)
  }
  return () => mine.close()
}
