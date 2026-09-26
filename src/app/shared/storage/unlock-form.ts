import { recordStore } from './record-store'
import { RANGER_PHOTOS_DB_NAME } from '../services/ranger-photo.service'

/**
 * E-122 Phase 2b: the passphrase gate `main.ts` shows before Angular boots, whenever
 * `recordStore.checkEncryption()` says this device's roster/field reports are encrypted.
 *
 * WHY PLAIN DOM, NOT ANGULAR
 * ---------------------------
 * Angular does not exist yet at this point in boot (see main.ts's own comment) - there is no
 * injector, no change detection, no component tree. That is also the point of doing it this
 * way: nothing here has to trust any Angular service or template not to touch encrypted data
 * before it is decrypted, because nothing Angular exists yet to do so.
 *
 * TWO WAYS OUT, NOTHING ELSE
 * ---------------------------
 * The right passphrase, or "Forgot it" - which erases the encrypted records (roster, field
 * reports, ranger photos) on THIS device rather than leaving it permanently unusable. There
 * is no retry lockout and no hint: a life-safety field tool cannot afford to lock a scribe out
 * indefinitely over a typo, but it also promises no recovery path beyond the passphrase itself
 * - see ARCHITECTURE.md's "The dangerous failure".
 *
 * NEVER LETS A FAILURE HERE BRICK THE APP
 * -------------------------------------------
 * Every branch below - a thrown error from unlock(), from the erase itself - is caught and
 * turned into an on-screen retry rather than an unhandled rejection that would leave the page
 * blank forever with no way forward.
 */

const STYLE_ID = 'rt-unlock-styles'

/** Resolves once the app is safe to boot: either unlocked, or the operator chose to erase. */
export function runUnlockGate(): Promise<void> {
  injectStyles()

  return new Promise<void>(resolve => {
    const root = document.createElement('div')
    root.className = 'rt-unlock'
    root.innerHTML = `
      <form class="rt-unlock__card" novalidate>
        <h1 class="rt-unlock__title">RangerTrak is locked</h1>
        <p class="rt-unlock__text">
          This device&rsquo;s roster and field reports are encrypted. Enter the passphrase to
          unlock them.
        </p>
        <label class="rt-unlock__label" for="rt-unlock-passphrase">Passphrase</label>
        <input class="rt-unlock__input" id="rt-unlock-passphrase" name="passphrase"
          type="password" autocomplete="current-password" autocapitalize="off"
          autocorrect="off" spellcheck="false" aria-describedby="rt-unlock-error" />
        <div id="rt-unlock-error" class="rt-unlock__error" role="alert" aria-live="assertive"></div>
        <button class="rt-unlock__button rt-unlock__button--primary" type="submit">Unlock</button>
        <button class="rt-unlock__button rt-unlock__button--text" type="button" id="rt-unlock-forgot">
          Forgot it: erase this device&rsquo;s mission data
        </button>
      </form>
    `
    document.body.appendChild(root)

    const form = root.querySelector('form')!
    const input = root.querySelector<HTMLInputElement>('#rt-unlock-passphrase')!
    const error = root.querySelector<HTMLDivElement>('#rt-unlock-error')!
    const forgotBtn = root.querySelector<HTMLButtonElement>('#rt-unlock-forgot')!
    const submitBtn = root.querySelector<HTMLButtonElement>('.rt-unlock__button--primary')!

    // Enter submits for free (a real <form>/submit button); this just gets initial focus
    // there without the operator having to click first.
    input.focus()

    const finish = () => { root.remove(); resolve() }

    form.addEventListener('submit', event => {
      event.preventDefault()
      const passphrase = input.value
      error.textContent = ''
      submitBtn.disabled = true
      recordStore.unlock(passphrase)
        .then(ok => {
          if (ok) { finish(); return }
          error.textContent = 'Wrong passphrase. Try again.'
          input.value = ''
          input.focus()
        })
        .catch(err => {
          // No retry lockout, and no way for an unexpected error here to strand the operator
          // on a form that no longer responds - treat it the same as a wrong passphrase.
          console.error('RecordStore.unlock() failed unexpectedly:', err)
          error.textContent = 'Wrong passphrase. Try again.'
        })
        .finally(() => { submitBtn.disabled = false })
    })

    forgotBtn.addEventListener('click', () => {
      const confirmed = confirm(
        'Erase this device’s mission data?\n\n'
        + 'This deletes the roster, field reports and ranger photos stored on THIS device - '
        + 'not any backup file you have elsewhere. There is no undo.\n\n'
        + 'Afterward, restore a backup from Mission > Danger zone if you have one.')
      if (!confirmed) return

      forgotBtn.disabled = true
      Promise.all([recordStore.eraseEncryptedRecords(), eraseRangerPhotosDb()])
        .catch(err => {
          // Still proceed to boot: an empty, unlocked device beats a permanently stuck one.
          console.error('RecordStore: erase-on-forgot did not fully complete:', err)
        })
        .then(() => {
          alert('This device’s mission data has been erased. '
            + 'Restore a backup from Mission > Danger zone if you have one.')
          finish()
        })
    })
  })
}

/**
 * Ranger photos are a separate IndexedDB database owned by `RangerPhotoService` - a service
 * that does not exist yet at this point in boot (see this file's own header comment), so
 * there is nothing to inject and call. Deleting the whole database directly is equivalent to
 * `RangerPhotoService.clear()` and needs no instance to do it.
 */
function eraseRangerPhotosDb(): Promise<void> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(); return }
    const req = indexedDB.deleteDatabase(RANGER_PHOTOS_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

/**
 * Inline styles only, no stylesheet import: this form has to render correctly before
 * Angular's (or any) CSS has necessarily loaded, and it has to be legible in both a light and
 * a dark system theme with no app theming to lean on. Plain, high-contrast, deliberately not
 * trying to look like the rest of the app.
 */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    .rt-unlock {
      position: fixed; inset: 0; z-index: 999999; display: flex; align-items: center;
      justify-content: center; background: #f5f5f5; color: #1a1a1a;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px;
      box-sizing: border-box;
    }
    .rt-unlock__card {
      max-width: 360px; width: 100%; background: #ffffff; border: 1px solid #ccc;
      border-radius: 8px; padding: 24px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      box-sizing: border-box;
    }
    .rt-unlock__title { margin: 0 0 8px; font-size: 1.25rem; }
    .rt-unlock__text { margin: 0 0 16px; font-size: 0.95rem; line-height: 1.4; }
    .rt-unlock__label { display: block; margin-bottom: 4px; font-size: 0.9rem; }
    .rt-unlock__input {
      width: 100%; box-sizing: border-box; padding: 8px; font-size: 1rem;
      border: 1px solid #999; border-radius: 4px; margin-bottom: 8px;
    }
    .rt-unlock__error { min-height: 1.2em; color: #b3261e; font-size: 0.875rem; margin-bottom: 8px; }
    .rt-unlock__button {
      display: block; width: 100%; box-sizing: border-box; padding: 10px; font-size: 1rem;
      border-radius: 4px; margin-top: 8px; cursor: pointer;
    }
    .rt-unlock__button--primary { background: #12263f; color: #fff; border: none; }
    .rt-unlock__button--primary:disabled { opacity: 0.6; cursor: default; }
    .rt-unlock__button--text {
      background: transparent; color: #12263f; border: 1px solid transparent;
      text-decoration: underline;
    }
    @media (prefers-color-scheme: dark) {
      .rt-unlock { background: #121212; color: #e8e8e8; }
      .rt-unlock__card { background: #1e1e1e; border-color: #444; }
      .rt-unlock__input { background: #2a2a2a; color: #e8e8e8; border-color: #666; }
      .rt-unlock__button--primary { background: #6f9bd6; color: #0a0a0a; }
      .rt-unlock__button--text { color: #9dc0ee; }
    }
  `
  document.head.appendChild(style)
}
