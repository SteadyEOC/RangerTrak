import { installKeyHandover, requestKeyFromOpener } from './popout-key'
import { recordStore } from './record-store'

type WithEval = Window & { eval: (script: string) => unknown }

/** E-313 (Q77): the unlocked key goes to a window this one opened, by postMessage, in memory only. */
describe('pop-out key hand-over (E-313)', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await recordStore.resetForTests()
  })

  it('a window with no opener has nobody to ask', async () => {
    expect(await requestKeyFromOpener(50)).toBeNull()
  })

  it('the main window answers a window it opened, with the key it holds', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    recordStore.adoptEncryptionKey(key)
    installKeyHandover()

    const popup = window.open('about:blank', 'rt-popout-key-spec', 'popup,width=200,height=200')
    if (!popup) {
      console.warn('popup blocked in this test browser: the hand-over positive path was skipped')
      return
    }
    try {
      const reply = new Promise<{ type?: string, key?: unknown }>(resolve => {
        popup.addEventListener('message', (e: MessageEvent) => resolve(e.data))
      })
      // The popup is same-origin about:blank: it asks the way a pop-out's boot does.
      ;(popup as WithEval).eval(
        `window.opener.postMessage({ type: 'rangertrak-popout-key-request' }, ${JSON.stringify(location.origin)})`)
      const timeout = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 2000))
      const data = await Promise.race([reply, timeout])
      expect(data).not.toBe('timeout')
      expect((data as { type?: string }).type).toBe('rangertrak-popout-key')
      expect((data as { key?: unknown }).key).toBeInstanceOf((popup as unknown as { CryptoKey: typeof CryptoKey }).CryptoKey)
    } finally {
      popup.close()
    }
  })

  it('does not answer a window it did not open', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    recordStore.adoptEncryptionKey(key)
    installKeyHandover()
    // An iframe is same-origin but was not opened by window.open: its opener is null.
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    try {
      const reply = new Promise<boolean>(resolve => {
        frame.contentWindow!.addEventListener('message', () => resolve(true))
        setTimeout(() => resolve(false), 300)
      })
      ;(frame.contentWindow as WithEval).eval(
        `window.parent.postMessage({ type: 'rangertrak-popout-key-request' }, ${JSON.stringify(location.origin)})`)
      expect(await reply).toBe(false)
    } finally {
      frame.remove()
    }
  })
})
