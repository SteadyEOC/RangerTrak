import { recordStore } from './record-store'

/**
 * Item 9 (2026-09-28, John): one active RangerTrak tab per browser.
 *
 * THE PROBLEM
 * -----------
 * RangerTrak has never coordinated between two tabs of the same browser - no
 * BroadcastChannel, no `storage` event listener, no Web Lock anywhere before this file.
 * RangerTrak/RadioLogService, RangerService and MissionLocationService each keep their whole
 * state in memory and persist it with one unconditional write - `recordStore.setItem(key,
 * JSON.stringify(wholeThing))` - on every mutation (see e.g. RadioLogService's own
 * `updateRadioLogAndPublish()`). Two tabs each load their own in-memory copy at boot. Tab A
 * adds a report and writes its whole (now-updated) copy to IndexedDB; tab B, still holding
 * its OWN in-memory copy from before that report existed, later adds a different report and
 * writes ITS whole copy - overwriting tab A's, silently discarding the report tab A just
 * filed. Same mechanism for the roster and locations. Different browsers, profiles or
 * devices each have their own separate storage and are unaffected - this is purely a
 * same-browser, same-origin, multiple-tabs problem.
 *
 * THE FIX
 * -------
 * A `navigator.locks` exclusive lock (`LOCK_NAME` below), requested `{ ifAvailable: true }`
 * at startup so a genuinely single-tab session (the overwhelming common case, and every
 * e2e/CDP run - only one tab is ever opened there) resolves near-instantly with no delay to
 * boot. Whichever tab holds it is the only one allowed to write:
 * `record-store.ts`'s `setItem()`/`removeItem()` check `RecordStoreImpl`'s own
 * `writesEnabled` flag before touching either the in-memory Map or IndexedDB, so nothing a
 * blocked/stopped tab still has in memory can ever reach storage and clobber what the active
 * tab has already written.
 *
 * A tab that does NOT get the lock never boots the app at all (see `main.ts`) - it shows a
 * full-page plain-DOM notice (same "no Angular, nothing here can accidentally touch encrypted
 * or in-flight data" reasoning `unlock-form.ts` already documents for the encryption gate)
 * offering "Use this tab instead", which forcibly `steal`s the lock away from whichever tab
 * currently holds it.
 *
 * A tab that WAS active and gets stolen from finds out via its own held `navigator.locks
 * .request()` call: per the Web Locks API, a `steal` forcibly ends the current holder's lock
 * and REJECTS that holder's own still-pending `request()` promise (MDN's own description of
 * `steal`: "hijacks a currently held lock... the current holder is aborted"). That rejection,
 * caught in `holdLockForever()` below, is this app's only signal that it has been stolen from
 * - there is no separate polling or heartbeat. It disables further writes and shows a second
 * plain-DOM notice with a Reload button (reloading tears down this tab's JS context, which
 * releases whatever lock state it had and lets a fresh boot try again cleanly).
 *
 * WHAT THIS DOES NOT DO
 * ----------------------
 * `navigator.locks` missing entirely (very old browsers) disables enforcement SILENTLY -
 * `acquireTabLock()` resolves `'unsupported'`, `main.ts` treats that exactly like `'active'`,
 * and nothing here ever runs again. This is not a sync/merge mechanism and does not attempt
 * one - it prevents the SILENT data loss of two tabs racing each other, nothing more. A
 * scribe who genuinely wants two tabs open (e.g. Radio Log in one, Map in another) can still
 * do that; only ONE of them may write, and switching which one is a single click away.
 */

const LOCK_NAME = 'rangertrak-active-tab'
const STYLE_ID = 'rt-tablock-styles'

/** Set once the "stopped saving" notice has been shown, so a tab already showing it (or one
 * that lost the lock before ever holding it, which cannot happen - see acquireTabLock()'s own
 * comment) never tries to show a second one. */
let stoppedNoticeShown = false

/**
 * Resolves whatever hold this JS context currently has on the lock - set by `holdLockForever()`
 * right before it returns its own never-resolving promise, so `resetTabLockForTests()` (the
 * only caller - see its own comment) has something to call.
 */
let releaseCurrentHold: (() => void) | null = null

/**
 * Requests the lock and, if granted, holds it until this tab's JS context goes away
 * (navigation, reload, close) or another tab steals it. Shared by acquireTabLock() (the
 * `ifAvailable` startup attempt) and stealTabLock() (the blocked-tab notice's own button) -
 * both need the exact same "hold forever, react to being stolen from" behaviour once granted,
 * they differ only in HOW they ask for the lock.
 */
function holdLockForever(requestOptions: { ifAvailable?: boolean; steal?: boolean }): Promise<boolean> {
  return new Promise<boolean>(resolveGranted => {
    navigator.locks.request(LOCK_NAME, requestOptions, lock => {
      if (!lock) {
        // Only reachable via the `ifAvailable` path - `steal` always grants (or the browser
        // has no lock support at all, handled before this function is ever called).
        resolveGranted(false)
        return Promise.resolve()
      }
      resolveGranted(true)
      // Held forever: this inner promise only settles if the browser forcibly ends the lock
      // (stolen by a newer tab - see the outer .catch() below), this tab's own context is
      // torn down (navigation/reload/close), or a test explicitly releases it (see
      // resetTabLockForTests()) - production code never calls the resolver itself.
      return new Promise<void>(resolve => { releaseCurrentHold = resolve })
    }).catch(() => {
      // Reachable only once this tab actually held the lock and it was then stolen - see
      // this file's own header comment on why a `steal` rejects the ORIGINAL holder's
      // `request()` promise. The `ifAvailable`/never-granted branch above resolves cleanly
      // and never reaches here.
      onLockLost()
    })
  })
}

/**
 * Call once, at startup, before loading or rendering anything that could write - see
 * `main.ts`. Resolves once the outcome is known; does NOT wait for a lock already held
 * elsewhere.
 *
 *   'active'      - this tab holds the lock. Writes proceed normally; boot continues.
 *   'blocked'     - another tab already holds it. This tab must show the "already open"
 *                    notice (`showBlockedGate()`) and must not boot the rest of the app
 *                    until that notice's own "Use this tab instead" steals the lock.
 *   'unsupported' - `navigator.locks` does not exist. No enforcement: treat exactly like
 *                    'active'.
 */
export async function acquireTabLock(): Promise<'active' | 'blocked' | 'unsupported'> {
  if (!('locks' in navigator)) {
    return 'unsupported'
  }
  const granted = await holdLockForever({ ifAvailable: true })
  return granted ? 'active' : 'blocked'
}

/**
 * "Use this tab instead" (the blocked-tab notice's own button). Forcibly takes the lock away
 * from whichever tab currently holds it - that tab's own `holdLockForever()` call sees its
 * `request()` rejected and reacts via `onLockLost()`, same as if a third tab had stolen it
 * from THIS one. Resolves once this tab holds the lock (steal always grants).
 */
export async function stealTabLock(): Promise<void> {
  await holdLockForever({ steal: true })
}

/**
 * This tab is no longer allowed to write - either it just got stolen from (was active,
 * mid-session), or - not reachable today, since a blocked tab never boots far enough to call
 * this on its own behalf, but kept as the single choke point regardless of how a caller gets
 * here - it should never have been writing in the first place. Disables `RecordStore` writes
 * FIRST, then shows the notice: the disable must never depend on the DOM update succeeding.
 */
function onLockLost(): void {
  recordStore.disableWrites()
  if (stoppedNoticeShown) return
  stoppedNoticeShown = true
  showStoppedWritingNotice()
}

/**
 * The blocked-tab gate: shown BEFORE Angular boots (main.ts) when `acquireTabLock()` resolves
 * `'blocked'`. Resolves once the operator clicks "Use this tab instead" and this tab actually
 * holds the lock - `main.ts` awaits this, then continues its normal boot sequence exactly as
 * if this tab had been the one to get the lock in the first place.
 */
export function showBlockedGate(): Promise<void> {
  injectStyles()
  return new Promise<void>(resolve => {
    const root = document.createElement('div')
    root.className = 'rt-tablock'
    root.innerHTML = `
      <div class="rt-tablock__card">
        <h1 class="rt-tablock__title">RangerTrak is already open</h1>
        <p class="rt-tablock__text">
          RangerTrak is already open in another tab or window of this browser. Use that one,
          or use this one instead.
        </p>
        <button class="rt-tablock__button" type="button" id="rt-tablock-use-here">
          Use this tab instead
        </button>
      </div>
    `
    document.body.appendChild(root)

    const btn = root.querySelector<HTMLButtonElement>('#rt-tablock-use-here')!
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = 'Switching…'
      await stealTabLock()
      root.remove()
      resolve()
    })
  })
}

/**
 * The stolen-from notice: shown on a tab that WAS active (already fully booted, mid-session -
 * this is why it is plain DOM appended straight to `document.body` rather than anything
 * Angular-rendered, same reasoning as `unlock-form.ts`'s own gate: it has to work regardless
 * of whatever state the already-running app is in). No promise to resolve - the only way out
 * is Reload, which tears down this tab's JS context entirely.
 */
function showStoppedWritingNotice(): void {
  injectStyles()
  const root = document.createElement('div')
  root.className = 'rt-tablock'
  root.innerHTML = `
    <div class="rt-tablock__card">
      <h1 class="rt-tablock__title">This tab has stopped saving</h1>
      <p class="rt-tablock__text">
        RangerTrak was opened in another tab. This tab has stopped saving.
      </p>
      <button class="rt-tablock__button" type="button" id="rt-tablock-reload">Reload</button>
    </div>
  `
  document.body.appendChild(root)
  root.querySelector<HTMLButtonElement>('#rt-tablock-reload')!
    .addEventListener('click', () => window.location.reload())
}

/**
 * Inline styles only, no stylesheet import - same reasoning as `unlock-form.ts`'s own
 * `injectStyles()`: the blocked-tab gate in particular has to render correctly before
 * Angular's (or any) CSS has necessarily loaded, and both notices have to be legible with no
 * app theming to lean on. Deliberately the same visual language as `unlock-form.ts` (same
 * class-name shape, same z-index) - both are "nothing else on this page matters right now"
 * full-page gates, and should read as the same KIND of interruption.
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .rt-tablock {
      position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center;
      justify-content: center; background: #f5f5f5; color: #1a1a1a;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px;
      box-sizing: border-box;
    }
    .rt-tablock__card {
      max-width: 360px; width: 100%; background: #ffffff; border: 1px solid #ccc;
      border-radius: 8px; padding: 24px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      box-sizing: border-box;
    }
    .rt-tablock__title { margin: 0 0 8px; font-size: 1.25rem; }
    .rt-tablock__text { margin: 0 0 16px; font-size: 0.95rem; line-height: 1.4; }
    .rt-tablock__button {
      display: block; width: 100%; box-sizing: border-box; padding: 10px; font-size: 1rem;
      border-radius: 4px; cursor: pointer; background: #12263f; color: #fff; border: none;
    }
    .rt-tablock__button:disabled { opacity: 0.6; cursor: default; }
    @media (prefers-color-scheme: dark) {
      .rt-tablock { background: #121212; color: #e8e8e8; }
      .rt-tablock__card { background: #1e1e1e; border-color: #444; }
      .rt-tablock__button { background: #6f9bd6; color: #0a0a0a; }
    }
  `
  document.head.appendChild(style)
}

/**
 * Test-only. Production code never voluntarily releases the lock (see `holdLockForever()`'s
 * own comment) - a real tab's hold ends only when its JS context is torn down. Karma, in
 * contrast, runs every spec `it()` in this file against the SAME browsing context (no reload
 * between them), so a lock acquired in one test would otherwise stay held forever and starve
 * every test after it. Releases whatever hold this context has (a no-op if it has none),
 * resets the "already shown" guard on the stopped-writing notice, and removes any notice left
 * in the DOM - the three pieces of module state a spec run could otherwise leak between tests.
 */
export function resetTabLockForTests(): void {
  releaseCurrentHold?.()
  releaseCurrentHold = null
  stoppedNoticeShown = false
  document.querySelectorAll('.rt-tablock').forEach(el => el.remove())
}
