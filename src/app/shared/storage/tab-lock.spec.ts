import { acquireTabLock, resetTabLockForTests, showBlockedGate, stealTabLock } from './tab-lock';
import { recordStore } from './record-store';

/**
 * Item 9 (2026-09-28, John): one active RangerTrak tab per browser - the pure/DOM-level parts
 * of tab-lock.ts this file can exercise within a single Karma browsing context. The real
 * two-tabs scenario (a genuinely separate tab actually blocked, stealing, and the ORIGINAL
 * tab showing the stopped-writing notice) is tools/e2e.js's checkOneActiveTab() instead - it
 * needs a second real browser tab, which Karma has no way to open.
 *
 * Every `it()` below runs in the SAME browsing context (Karma does not reload the page
 * between specs), so acquiring the lock in one test would otherwise starve every test after
 * it - `resetTabLockForTests()` (test-only, see its own doc comment) releases it between
 * tests, the same role `recordStore.resetForTests()` plays for RecordStore's own spec file.
 */
describe('tab-lock (item 9: one active tab per browser)', () => {
  afterEach(async () => {
    resetTabLockForTests();
    // Web Locks releases asynchronously inside the browser; a tick lets it actually clear
    // before the next test's own acquireTabLock() call checks availability.
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('resolves "active" when nothing else holds the lock', async () => {
    expect(await acquireTabLock()).toBe('active');
  });

  it('resolves "blocked" for a second acquisition attempt while the first is still held', async () => {
    expect(await acquireTabLock()).toBe('active');
    expect(await acquireTabLock()).toBe('blocked');
  });

  it('stealTabLock() takes the lock from the current holder and disables its RecordStore writes', async () => {
    const disableSpy = spyOn(recordStore, 'disableWrites');
    expect(await acquireTabLock()).toBe('active');

    await stealTabLock();
    // onLockLost() runs from the ORIGINAL holder's rejected request() promise, which settles
    // asynchronously relative to stealTabLock()'s own resolution - poll briefly rather than
    // assert immediately, same reasoning as this suite's other async-storage checks.
    for (let i = 0; i < 20 && !disableSpy.calls.any(); i++) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }

    expect(disableSpy).toHaveBeenCalled();
  });

  it('a lock this context never held is never reported lost - only an actual steal triggers disableWrites()', async () => {
    const disableSpy = spyOn(recordStore, 'disableWrites');
    const outcome = await acquireTabLock();
    expect(outcome).toBe('active');

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(disableSpy).not.toHaveBeenCalled();
  });

  it('showBlockedGate() renders the notice with a working "Use this tab instead" button, and resolves once it is clicked', async () => {
    // Deliberately does NOT pre-acquire the lock in this same context first: in production,
    // showBlockedGate() only ever runs in a tab that does NOT hold the lock (that is the
    // whole point - it is the blocked one), stealing it from a genuinely DIFFERENT tab/
    // context. Holding it here first would make this context steal from ITSELF, which fires
    // this file's own onLockLost() (a real steal was detected) and pops the SECOND, stopped-
    // writing notice right back up - a self-inflicted false failure that has nothing to do
    // with what this test is actually checking (the gate renders and its button works).
    // That "a steal notifies the previous holder" behaviour has its own dedicated test above.
    const gatePromise = showBlockedGate();
    const root = document.querySelector('.rt-tablock');
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain('already open');

    const button = document.querySelector<HTMLButtonElement>('#rt-tablock-use-here');
    expect(button).not.toBeNull();
    button!.click();

    await gatePromise; // resolves once the click's own stealTabLock() call is granted
    expect(document.querySelector('.rt-tablock')).toBeNull(); // removes itself
  });
});
