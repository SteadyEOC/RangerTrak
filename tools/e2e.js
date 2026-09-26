#!/usr/bin/env node
/**
 * End-to-end checks against a running RangerTrak, driven over the Chrome DevTools Protocol.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 96-spec unit suite passed continuously through 2026-08-15 while these defects were
 * live: an emptied roster silently refilling itself on reload; a roster import that stored
 * 286 people with 0 names; a zip import that reported success having saved no photos; three
 * Install buttons that did nothing; a navbar that drew on top of itself. Every one was found
 * by driving a real browser, and every harness that found them was written ad hoc and thrown
 * away with the session (PRIVATE-Roadmap.md E-39).
 *
 * Karma cannot catch these. They live in real navigation, real IndexedDB, real file inputs,
 * and real CSS layout.
 *
 * FIXTURES ARE SYNTHETIC ON PURPOSE
 * ---------------------------------
 * The roster and photos this generates are invented - fake callsigns, generated 1px PNGs.
 * Real rosters and photographs are operator data and never enter the repo (D-35). A fixture
 * that cannot be committed is a test that will not be run.
 *
 * USAGE
 *   npm run build && npm run server           # in one terminal (serves dist on :8080)
 *   node tools/e2e.js                         # in another
 *   node tools/e2e.js --base=https://rangertrak.org --read-only
 *
 *   --base=URL      what to test           (default http://localhost:8080)
 *   --read-only     skip anything that writes localStorage/IndexedDB. Use against
 *                   production unless you intend to clobber that browser profile's data.
 *   --full          also run the slow checks (map engine switch/nav, roster lifecycle,
 *                   field aliases, setup-file merge, mission round trip) - together these account
 *                   for most of the suite's wall-clock time via sleep()s and IndexedDB
 *                   polling. Default (no --full) skips them for a fast day-to-day run;
 *                   run --full at least once before pushing.
 *   --keep-open     leave Chrome running for inspection
 *   --real-geocoding  hit the real Nominatim service instead of the built-in mock (see
 *                   MOCK_NOMINATIM_SCRIPT below). Only for an occasional deliberate check
 *                   that the real integration still works - never the default, since a full
 *                   run visits Entry (and so triggers a reverse-geocode) many times over,
 *                   and this suite running repeatedly in CI is exactly the kind of automated
 *                   traffic that got this app's own requests rate-limited by Nominatim.
 *
 * Exits non-zero if any check fails, so CI can gate on it.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execSync } = require('child_process')

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const hit = args.find(a => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const BASE = (arg('base', 'http://localhost:8080')).replace(/\/$/, '')
const READ_ONLY = args.includes('--read-only')
const FULL = args.includes('--full')
const KEEP_OPEN = args.includes('--keep-open')
const REAL_GEOCODING = args.includes('--real-geocoding')
const PORT = 9444

/**
 * 2026-08-29: this suite's own traffic got Nominatim's rate limit (~1 req/sec, see
 * nominatim-geocoder.ts) tripped - every visit to Entry fires a reverse-geocode for the
 * mission's default position, and a full run visits Entry repeatedly, so a suite that
 * exercises the app at all thoroughly is, on its own, exactly the automated-traffic pattern
 * Nominatim's usage policy exists to catch.
 *
 * Installed via Page.addScriptToEvaluateOnNewDocument, so it is in place before ANY app
 * script runs on every navigation (a fresh `goto()` reload included, not just the first
 * page load). Wraps window.fetch rather than reaching into geocoding-provider internals -
 * this way the app's own retry/error-handling code in NominatimGeocoder still runs for
 * real, only the network hop underneath it is faked. Real display_name text does not
 * matter to any check here; every one only asserts non-empty / found, never exact wording.
 */
const MOCK_NOMINATIM_SCRIPT = `(() => {
  const REAL_FETCH = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('nominatim.openstreetmap.org')) {
      const body = url.includes('/reverse')
        ? { display_name: 'E2E Mock Address, Vashon Island, Washington, USA' }
        : [{ lat: '47.4472', lon: '-122.4627', display_name: 'E2E Mock Address, Vashon Island, Washington, USA' }]
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    }
    return REAL_FETCH(input, init)
  }
})()`

// ── tiny CDP client ──────────────────────────────────────────────────────────

let nextId = 1
const pending = new Map()
let ws
const consoleErrors = []
const dialogs = []

const send = (method, params = {}) => {
  const id = nextId++
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
  }
  return r.result.value
}

/**
 * E-122 Phase 2a: rangers/radioLog/radioLog-BAD/locations moved off localStorage onto
 * IndexedDB behind RecordStore (database 'rangertrak-records', object store 'kv' - see
 * shared/storage/record-store.ts). These three helpers are this file's replacement for the
 * `localStorage.getItem/setItem/removeItem(key)` calls checks used to make directly: they run
 * the equivalent IndexedDB access as its own small `evaluate()` round trip against the SAME
 * live page (Runtime.evaluate always executes in the current page, so this is exactly as real
 * as reading localStorage directly was), and hand back a plain value/string. A key genuinely
 * missing from the store resolves to `null`, matching `localStorage.getItem()`'s own contract.
 *
 * A check that also drives the DOM (types into a field, clicks Submit) still does that in its
 * own `evaluate()` call as before; it just no longer folds a storage read into that SAME
 * call. Splitting them costs one extra (fast, local) CDP round trip per check and, in
 * exchange, keeps every storage access reading through one identical, easy-to-audit path
 * rather than the `indexedDB.open()`/transaction boilerplate hand-written at each call site
 * (the pre-existing photo-store poll a little further down in this file is exactly that
 * boilerplate, kept there rather than migrated onto these helpers since it targets a
 * different database, `rangertrak-photos`, that E-122 does not touch).
 */
async function idbGetRaw(key) {
  return evaluate(`(new Promise(res => {
    const req = indexedDB.open('rangertrak-records');
    // A read must never CREATE the database: an empty v1 database with no 'kv' store
    // would stop the app's own open() from ever running its upgrade.
    req.onupgradeneeded = () => req.transaction.abort();
    req.onsuccess = () => { const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); return res(null); }
      const g = db.transaction('kv', 'readonly').objectStore('kv').get(${JSON.stringify(key)});
      g.onsuccess = () => { db.close(); res(g.result ?? null); };
      g.onerror = () => { db.close(); res(null); };
    };
    req.onerror = () => res(null);
  }))`)
}
async function idbSetRaw(key, value) {
  return evaluate(`(new Promise(res => {
    const req = indexedDB.open('rangertrak-records');
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv'); };
    req.onsuccess = () => { const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(${JSON.stringify(value)}, ${JSON.stringify(key)});
      tx.oncomplete = () => { db.close(); res(null); };
      tx.onerror = () => { db.close(); res(null); };
    };
    req.onerror = () => res(null);
  }))`)
}
async function idbRemoveRaw(key) {
  return evaluate(`(new Promise(res => {
    const req = indexedDB.open('rangertrak-records');
    // A read must never CREATE the database: an empty v1 database with no 'kv' store
    // would stop the app's own open() from ever running its upgrade.
    req.onupgradeneeded = () => req.transaction.abort();
    req.onsuccess = () => { const db = req.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); return res(null); }
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(${JSON.stringify(key)});
      tx.oncomplete = () => { db.close(); res(null); };
      tx.onerror = () => { db.close(); res(null); };
    };
    req.onerror = () => res(null);
  }))`)
}
/**
 * Deletes every key RecordStore manages (rangers/radioLog/radioLog-BAD/locations - must match
 * `MIGRATED_KEYS` in shared/storage/record-store.ts) - this file's replacement for a bare
 * `localStorage.clear()` wherever a check needs a genuinely blank roster/radioLog/locations
 * state. Many checks run one after another in the same long-lived browser session/profile
 * (see main()), so `localStorage.clear()` alone stopped being enough the moment these keys
 * moved off localStorage - a later check would otherwise still see whatever an earlier one
 * left in IndexedDB.
 *
 * Deliberately NOT `indexedDB.deleteDatabase()`: the page open at the time this runs already
 * has its own live RecordStore connection to this same database (opened at boot, never
 * closed), and `deleteDatabase()` only actually completes once every connection open AT THE
 * TIME OF THE CALL has closed - it fires `blocked` instead of `success` while one is still
 * open, and this file's own next `goto()` closing that connection doesn't happen until well
 * after this call has already returned. Treating `blocked` as "done" (an earlier version of
 * this helper did) meant the delete was silently still pending when the very next check
 * assumed a clean slate - exactly the kind of async-storage flake this suite's own
 * "run e2e:full twice" rule exists to catch. Deleting each key with an ordinary transaction
 * has no such exclusivity requirement: it runs immediately alongside whatever connection the
 * open page already holds.
 */
async function idbClearAll() {
  for (const key of ['rangers', 'radioLog', 'radioLog-BAD', 'locations']) {
    await idbRemoveRaw(key)
  }
}

/**
 * Polls `readFn` (typically an `idbGetRaw()` read, possibly parsed/computed further) until
 * `isReady` accepts its result, rather than a flat `sleep()` before a single read. RecordStore
 * writes commit to IndexedDB asynchronously (a microtask-coalesced queue, not the synchronous
 * `localStorage.setItem()` write this suite could previously assume completed before its own
 * next line ran) - a fixed sleep long enough in the common case still isn't a guarantee, and
 * this is exactly the "async storage: pass-then-fail" flake class the project's own notes
 * warn about. Same reasoning, same shape, as the pre-existing IndexedDB photo poll in
 * checkSetupFileMerge() a little further down this file - this generalizes it for RecordStore
 * reads rather than duplicating the loop at every call site.
 */
async function pollUntil(readFn, isReady, tries = 20, intervalMs = 300) {
  let value
  for (let i = 0; i < tries; i++) {
    value = await readFn()
    if (isReady(value)) return value
    await sleep(intervalMs)
  }
  return value
}

async function goto(route, settleMs = 3500) {
  consoleErrors.length = 0
  await send('Page.navigate', { url: BASE + route })
  await sleep(settleMs)
}

/**
 * Navigates by CLICKING a nav link, i.e. Angular client-side routing - not a page load.
 *
 * This distinction turned out to be load-bearing. goto() issues Page.navigate, which is a
 * full reload: every service is reconstructed and re-reads localStorage, so state is always
 * fresh. Users don't do that - they click the nav, services stay alive, and stale in-memory
 * state survives. Two production bugs reported on 2026-08-19 reproduce ONLY this way and
 * were invisible to a suite that navigated exclusively by reload.
 */
async function navigateInApp(linkText, settleMs = 2500) {
  consoleErrors.length = 0
  const clicked = await evaluate(`(() => {
    const link = [...document.querySelectorAll('.main-nav ul a')]
      .find(a => a.textContent.trim().toLowerCase() === ${JSON.stringify(linkText)}.toLowerCase());
    if (!link) return false;
    link.click();
    return true;
  })()`)
  if (!clicked) throw new Error(`no nav link labelled "${linkText}"`)
  await sleep(settleMs)
}

/**
 * Attaches a file to an <input type=file>.
 *
 * Polls rather than looking the node up once. DOM.getDocument/DOM.querySelector work
 * against the DOM agent's snapshot of the document, which goes stale across a navigation -
 * so a single lookup issued too soon after goto() can return nodeId 0 for an element that
 * is present and about to be found on the very next try. That produced an intermittent
 * "no element matching #importRosterFile" in checkFieldNameAliases, on a page where the
 * check immediately before it had just used the same selector successfully - i.e. the page
 * was fine and the lookup was early.
 *
 * Same fix, and same reasoning, as the three fixed sleep()s Sprint E replaced with polls:
 * wait for the real condition, don't guess a duration.
 */
async function setFileInput(selector, filePath) {
  let nodeId = 0
  for (let i = 0; i < 20 && !nodeId; i++) {
    if (i) await sleep(250)
    // Re-fetch the document each attempt: after a navigation the previous root nodeId is
    // itself stale, so reusing it would keep querying a document that no longer exists.
    const doc = await send('DOM.getDocument', { depth: -1 })
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })
    nodeId = node.nodeId
  }
  if (!nodeId) throw new Error(`no element matching ${selector}`)
  await send('DOM.setFileInputFiles', { files: [filePath], nodeId })
}

// ── result tracking ──────────────────────────────────────────────────────────

const results = []

/**
 * Bugs KNOWN to be open and not yet fixed.
 *
 * A permanently red suite is one people stop reading, so these are tracked separately:
 * reported as KNOWN rather than FAIL, and they do not fail the run. If one starts PASSING
 * that is announced loudly - it means the fix landed and the entry should be deleted from
 * here. See the Sprint E plan's "Known-open production bugs" section for diagnoses.
 */
// All three 2026-08-19 production bugs are fixed as of this commit - see the Sprint E plan's
// "Known-open production bugs" section for the (now-historical) diagnoses. Empty rather than
// deleted: the mechanism stays ready for whatever's found next.
const KNOWN_OPEN = new Set([])

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  const known = KNOWN_OPEN.has(label)
  results.push({ pass, label, actual, expected, known })
  console.log(`  ${pass ? (known ? 'FIXED!' : 'PASS  ') : (known ? 'KNOWN ' : 'FAIL  ')}${label}`)
  if (!pass && !known) console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  if (pass && known) console.log(`        ^ on the KNOWN_OPEN list but passing - delete it from that list`)
  return pass
}
function note(text) { console.log(`  ....  ${text}`) }

// ── synthetic fixtures ───────────────────────────────────────────────────────

/** Smallest valid PNG: 1x1, opaque. Enough for "did this become a blob URL". */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')

function makeFixtures(dir) {
  fs.mkdirSync(dir, { recursive: true })

  const rangers = [
    { callsign: 'E2E-AA1', fullName: 'Fixture Alpha', team: 'CERT', rew: 'VI-9001', role: 'REW / Active' },
    { callsign: 'E2E-BB2', fullName: 'Fixture Bravo', team: 'EOC', rew: 'VI-9002', role: 'REW / Active' },
    { callsign: 'E2E-CC3', fullName: 'Fixture Charlie', team: 'Radio', rew: 'VI-9003', role: 'TEW / Active' },
  ]
  const rosterPath = path.join(dir, 'roster.json')
  fs.writeFileSync(rosterPath, JSON.stringify({ rangers }, null, 2))

  // A roster in an alias-using shape, to pin the licensee/icon/status mapping.
  const aliasPath = path.join(dir, 'roster-aliases.json')
  fs.writeFileSync(aliasPath, JSON.stringify(
    [{ callsign: 'E2E-AA1', licensee: 'Aliased Name', icon: 'x.png', status: 'Licensed' }], null, 2))

  // A Setup file (E-109 v2) carrying a rangers category - what /prep itself builds, and what
  // Rangers' own "Import roster" now reads for a .zip (rangers.component.ts's
  // importRosterFromZip(), retired the old bespoke roster.json+photos/ bundle shape
  // 2026-08-31). Uses BACKSLASH separators deliberately: PowerShell's Compress-Archive writes
  // them, they violate APPNOTE 4.4.17.1, and tolerating them is a fix this suite exists to
  // defend (0.15.6) - extractMissionZip()'s own basename() already tolerates them.
  const { zipSync } = require('fflate')
  const setupFileManifest = {
    schemaVersion: 2, exportedAt: '2026-08-31T00:00:00.000Z', appVersion: '0.90.0', rangers,
  }
  const setupFilePath = path.join(dir, 'setup-rangers.zip')
  fs.writeFileSync(setupFilePath, Buffer.from(zipSync({
    'mission-zip.json': new Uint8Array(Buffer.from(JSON.stringify(setupFileManifest))),
    'photos\\E2E-AA1.png': new Uint8Array(PNG_1PX),
    'photos\\E2E-CC3.png': new Uint8Array(PNG_1PX),
  })))

  return { rangers, rosterPath, aliasPath, setupFilePath }
}

// ── the checks ───────────────────────────────────────────────────────────────

const ROUTES = ['/', '/map', '/radio-log', '/messages', '/rangers', '/mission', '/help', '/log', '/prep']

async function checkRoutesRender() {
  console.log('\nEvery route renders, with no console errors')
  for (const route of ROUTES) {
    await goto(route)
    const shell = await evaluate(`(() => {
      const page = document.querySelector('rangertrak-page');
      return {
        shell: !!page,
        main: !!document.querySelector('rangertrak-page .main'),
        strip: !!document.querySelector('.header'),
      };
    })()`)
    check(`${route} renders the page shell`, shell.shell && shell.main, true)
    check(`${route} has no console errors`, consoleErrors.slice(0, 2), [])
  }
}

async function checkNavbarLayout() {
  console.log('\nNavbar does not overlap itself (regression: .rightAlign was position:absolute)')
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false })
  await goto('/')
  const nav = await evaluate(`(() => {
    const links = [...document.querySelectorAll('.main-nav ul a')];
    const right = document.querySelector('.rightAlign');
    const rb = right && right.getBoundingClientRect();
    const hit = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    let overlaps = 0;
    links.forEach(a => { if (rb && hit(a.getBoundingClientRect(), rb)) overlaps++ });
    for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++)
      if (hit(links[i].getBoundingClientRect(), links[j].getBoundingClientRect())) overlaps++;
    return { overlaps, labels: links.map(a => a.textContent.trim()) };
  })()`)
  check('no overlapping nav items at 1360px', nav.overlaps, 0)
  // E-64: the two engines collapsed onto one page/one nav item. This asserts BOTH halves
  // of that collapse deliberately - by design this fails if a future change reintroduces a
  // second map nav item, the exact regression a copy-paste revert could reintroduce.
  check('D-31/E-64: a single Map nav item, not two', nav.labels.filter(l => /map/i.test(l)), ['Map'])
  await send('Emulation.clearDeviceMetricsOverride')
}

async function checkMapEngineSwitch() {
  console.log('\nMap page: the switch mounts exactly one engine at a time, never both (E-64)')
  await goto('/map')
  const before = await evaluate(`(() => ({
    leaflet: !!document.querySelector('.mapLeaflet-container'),
    maplibre: !!document.querySelector('.map-container'),
    // E-85: the base-layer switcher (L.control.layers) on the MAIN map specifically -
    // scoped past #mapLeaflet-main for the same reason E-80's trail check is: the
    // overview mini-map is a second, separate Leaflet instance on this same page. The
    // control's expanded panel is CSS-hidden until hover/focus, but its <input> elements
    // exist in the DOM regardless, so no interaction is needed to count them.
    layersControl: !!document.querySelector('#mapLeaflet-main .leaflet-control-layers'),
    baseLayerCount: document.querySelectorAll('#mapLeaflet-main .leaflet-control-layers-base input').length,
  }))()`)
  check('Leaflet is the default engine on load', before.leaflet && !before.maplibre, true)
  check('E-85: the base-layer switcher control renders on the main map', before.layersControl, true)
  check('E-85 phase 2: at least one alternate base layer is offered alongside OSM', before.baseLayerCount >= 2, true)

  await evaluate(`(() => {
    document.querySelector('[data-testid="mapEngineSwitch"] button').click()
  })()`)
  await sleep(2500) // dynamic import() of the MapLibre chunk + map construction

  const afterSwitch = await evaluate(`(() => ({
    leaflet: !!document.querySelector('.mapLeaflet-container'),
    maplibre: !!document.querySelector('.map-container'),
  }))()`)
  check('flipping the switch mounts MapLibre and unmounts Leaflet', !afterSwitch.leaflet && afterSwitch.maplibre, true)

  await evaluate(`(() => {
    document.querySelector('[data-testid="mapEngineSwitch"] button').click()
  })()`)
  await sleep(1500)

  const afterFlipBack = await evaluate(`(() => ({
    leaflet: !!document.querySelector('.mapLeaflet-container'),
    maplibre: !!document.querySelector('.map-container'),
  }))()`)
  check('flipping back mounts Leaflet and unmounts MapLibre', afterFlipBack.leaflet && !afterFlipBack.maplibre, true)
  check('no console errors across the round trip', consoleErrors.slice(0, 2), [])
}

/**
 * E-77 (found and fixed 2026-08-25): MapEngineService.engine is a root singleton that
 * deliberately survives navigating away from /map and back - but MapPageComponent (and its
 * maplibreComponentType signal) is recreated fresh on every visit to the route. A returning
 * visit with 'maplibre' already selected landed on neither branch of the page's @if/@else
 * if: engine() wasn't 'leaflet', and maplibreComponentType() was null again because nothing
 * had re-triggered the dynamic import for the new instance - the switch showed checked over
 * an empty page (no canvas at all, not literally a black one, but exactly what a scribe
 * expecting a map and getting a blank area would describe that way). Confirmed red against
 * the pre-fix build - canvasCount was 0 and no MapLibre element existed - before trusting
 * this, per verify-the-measurement-itself.
 */
async function checkMapEngineSurvivesNavigation() {
  console.log('\nMap page: MapLibre stays mounted across a navigate-away-and-back, not just a fresh visit (E-77)')
  await goto('/map')

  await evaluate(`(() => {
    document.querySelector('[data-testid="mapEngineSwitch"] button').click()
  })()`)
  await sleep(2500)

  // Navigate away and back the way a scribe actually would - client-side routing, not a
  // reload (a reload would reset MapEngineService too, which would hide this exact bug).
  await navigateInApp('Radio Log', 2000)
  await navigateInApp('Map', 2500)

  const state = await evaluate(`(() => ({
    switchChecked: document.querySelector('[data-testid="mapEngineSwitch"] button')?.getAttribute('aria-checked') === 'true',
    maplibre: !!document.querySelector('.map-container'),
    leaflet: !!document.querySelector('.mapLeaflet-container'),
    canvasCount: document.querySelectorAll('canvas').length,
  }))()`)
  check('the engine switch still shows MapLibre checked', state.switchChecked, true)
  check('MapLibre is actually mounted, not just the switch', state.maplibre, true)
  check('Leaflet is not also/instead mounted', state.leaflet, false)
  check('both the main and overview canvases rendered', state.canvasCount, 2)
}

async function checkRosterLifecycle(fx) {
  console.log('\nRoster: import JSON, empty it, confirm it stays empty, re-import')
  await goto('/')
  await evaluate(`localStorage.clear()`)
  await idbClearAll()
  await goto('/rangers')

  // 2026-08-26: this asserted the OPPOSITE until 0.55.0 - a fresh browser used to auto-seed
  // the 18 hardcoded Vashon station callsigns. That was removed deliberately ("Rangers should
  // start blank. That should indicate a new mission!"), and this check was missed in that
  // change's own verification, so it went red on the next full run. Inverted rather than
  // deleted: a blank first run is now a real, deliberate guarantee worth pinning - it is what
  // MissionReadinessService's roster signal keys off (isRealRosterLoaded is now a plain
  // length check), so a regression here would silently light the readiness dot green on a
  // brand-new install with no roster.
  const seeded = (JSON.parse((await idbGetRaw('rangers'))||'{"rangers":[]}').rangers||[]).length
  check('a fresh browser starts with a BLANK roster, not the built-in stations', seeded, 0)

  await setFileInput('#importRosterFile', fx.rosterPath)
  await sleep(2000)
  const imported = await pollUntil(
    async () => {
      const r = (JSON.parse((await idbGetRaw('rangers'))||'{"rangers":[]}').rangers||[]);
      return { count: r.length, named: r.filter(x => (x.fullName||'').trim()).length,
               teams: r.filter(x => x.team).length, id: r.filter(x => x.id).length };
    },
    v => v.count >= fx.rangers.length)
  check('roster JSON imports every entry', imported.count, fx.rangers.length)
  check('...with names', imported.named, fx.rangers.length)
  check('...with teams', imported.teams, fx.rangers.length)
  // D-42 phase 8: rew is retired as a stored field - parseRosterJson() folds the fixture's
  // rew values into id on the way in, so this now checks id, not rew.
  check('...with ids seeded from rew', imported.id, fx.rangers.length)

  await goto('/rangers')
  // Advanced is a plain always-visible section now (2026-08-25: collapsible sections
  // removed app-wide), so there's no summary to click open before reaching the button.
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete all rangers')?.click()`)
  await sleep(1500)
  // ADR D-42/D-43: asserts the CONTENT is an empty list, not that the raw value is the
  // literal string '[]' - the roster is stored as a versioned { schemaVersion, rangers }
  // wrapper now. The point of the check is unchanged: the key must still exist holding an
  // empty roster, which is what makes a deliberate delete survive a reload.
  const afterDelete = await pollUntil(
    () => idbGetRaw('rangers'),
    raw => JSON.stringify(JSON.parse(raw||'{}').rangers ?? null) === '[]')
  check('deleting stores an empty list, keeping the key',
    JSON.stringify(JSON.parse(afterDelete||'{}').rangers ?? null), '[]')

  await goto('/rangers')
  check('an emptied roster STAYS empty across a reload', (JSON.parse((await idbGetRaw('rangers'))||'{"rangers":[]}').rangers||[]).length, 0)

  await setFileInput('#importRosterFile', fx.rosterPath)
  await sleep(2000)
  const reimported = await pollUntil(
    async () => (JSON.parse((await idbGetRaw('rangers'))||'{"rangers":[]}').rangers||[]).length,
    n => n >= fx.rangers.length)
  check('roster re-imports after being emptied', reimported, fx.rangers.length)
}

async function checkFieldNameAliases(fx) {
  console.log('\nRoster aliases: a real FCC-derived file calls the person "licensee"')
  await goto('/rangers')
  await setFileInput('#importRosterFile', fx.aliasPath)
  await sleep(4000)
  const aliasRaw = await idbGetRaw('rangers')
  const r = (() => {
    const a = (JSON.parse(aliasRaw||'{"rangers":[]}').rangers||[]);
    return { count: a.length, name: a[0] && a[0].fullName, role: a[0] && a[0].role };
  })()
  check('licensee maps to fullName', r.name, 'Aliased Name')
  check('status maps to role', r.role, 'Licensed')
}

async function checkSetupFileMerge(fx) {
  console.log('\nSetup file (Rangers, E-109 v2): MERGES into the roster already on the device, with BACKSLASH photo paths')
  await goto('/rangers')
  await setFileInput('#importRosterFile', fx.setupFilePath)

  // Poll for both photo keys rather than a flat sleep(7000): two IndexedDB photo writes
  // sometimes take longer than that under load. This check passed reliably earlier in this
  // same session, then failed twice in a row later, always missing exactly the SECOND
  // photo - the classic signature of a timeout that is usually enough but not tied to the
  // real completion condition. Same fix already applied twice elsewhere in this file.
  //
  // E-122 Phase 2a: the roster is now IndexedDB too (a different database, 'rangertrak-
  // records' rather than 'rangertrak-photos'), so this reads both the same way - inline
  // indexedDB access inside the SAME evaluate() round trip as the photo poll, rather than a
  // separate idbGetRaw() call, so the two stay read together as one consistent snapshot.
  const readState = `(async () => {
    const rangers = await new Promise(res => {
      const req = indexedDB.open('rangertrak-records');
      // A read must never CREATE the database: an empty v1 database with no 'kv' store
      // would stop the app's own open() from ever running its upgrade.
      req.onupgradeneeded = () => req.transaction.abort();
      req.onsuccess = () => { const db = req.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); return res([]); }
        const g = db.transaction('kv','readonly').objectStore('kv').get('rangers');
        g.onsuccess = () => { db.close(); res((JSON.parse(g.result||'{"rangers":[]}').rangers)||[]); };
        g.onerror = () => { db.close(); res([]); };
      };
      req.onerror = () => res([]);
    });
    const photos = await new Promise(res => {
      const req = indexedDB.open('rangertrak-photos');
      req.onsuccess = () => { const db = req.result;
        if (!db.objectStoreNames.contains('photos')) return res([]);
        const k = db.transaction('photos','readonly').objectStore('photos').getAllKeys();
        k.onsuccess = () => res(k.result); k.onerror = () => res([]); };
      req.onerror = () => res([]);
    });
    return {
      rangers: rangers.length,
      photoKeys: photos.sort(),
      // E2E-AA1 is already on the device with fullName "Aliased Name", left there by the
      // PRECEDING checkFieldNameAliases() run - this setup file also carries an E2E-AA1, with
      // its ORIGINAL fullName "Fixture Alpha". Asserting this proves the matching row was
      // actually OVERWRITTEN by the merge, not just coincidentally landing on the right total
      // COUNT (review findings R-6 - that coincidence is exactly what a bare count would hide).
      aa1Name: (rangers.find(r => r.callsign === 'E2E-AA1') || {}).fullName,
    };
  })()`

  let r = { rangers: 0, photoKeys: [], aa1Name: undefined }
  for (let i = 0; i < 20 && r.photoKeys.length < 2; i++) {
    await sleep(500)
    r = await evaluate(readState)
  }
  check('setup file MERGES rangers (existing + new), not a wholesale replace', r.rangers, fx.rangers.length)
  check('...and the matching row was actually overwritten, not just coincidentally counted', r.aa1Name, 'Fixture Alpha')
  // The 0.15.6 regression: backslash paths made every photo "unmatched" while the roster
  // imported fine, and the dialog reported success.
  check('setup file stores photos despite backslash paths', r.photoKeys, ['E2E-AA1', 'E2E-CC3'])
}

// ── Sprint D's keyboard-first pass and phone-width fix, retro-fitted with the checks its
// own plan specified but never committed. Written at the START of Sprint E, before any
// layout work, so they capture current-good behaviour rather than whatever Sprint E leaves
// behind. See the Sprint E plan, Step 0.
//
// NOTE for all synthetic edits below: Signal Forms' [formField] listens for the 'input' DOM
// event ONLY, never 'change' (nativeControlCreate in @angular/forms/fesm2022/signals.mjs).
// A real click/keystroke fires both; a dispatched 'change' alone silently does nothing.

/**
 * E-67: the Entry mini-map fills the box it's given, at every screen size, not ~36% of it.
 *
 * Root cause was a genuinely surprising one, worth guarding precisely rather than just
 * "the map looks about right": #Entry__LMinimap-subhead floats right inside the "Current
 * Location" heading (.Entry__MapLeaflet-head), and without `display: flow-root` containing it,
 * the float escaped past the heading's own bottom edge into the FOLLOWING sibling
 * (.mapLeaflet-frame)'s formatting context - shrinking the space Leaflet measured for its
 * container at construction time. Leaflet measures once and never re-measures without an
 * explicit invalidateSize(), so the wrong width was permanent for the life of the page,
 * not a transient layout hiccup - confirmed present at desktop and tablet width too, not
 * just phone, despite being found while investigating E-57(1)'s phone-only question.
 */
async function checkMiniMapFillsItsBox() {
  console.log('\nEntry mini-map fills its box; the "Current Location" subhead float stays contained (E-67)')
  await goto('/')
  const r = await evaluate(`(() => {
    const frame = document.querySelector('.mapLeaflet-frame')
    const minimap = document.getElementById('entry-minimap')
    const subhead = document.getElementById('Entry__LMinimap-subhead')
    const head = document.querySelector('.Entry__MapLeaflet-head')
    return {
      frameW: frame ? Math.round(frame.getBoundingClientRect().width) : null,
      minimapW: minimap ? Math.round(minimap.getBoundingClientRect().width) : null,
      subheadBottom: subhead ? Math.round(subhead.getBoundingClientRect().bottom) : null,
      headBottom: head ? Math.round(head.getBoundingClientRect().bottom) : null,
    }
  })()`)
  check('the mini-map div is as wide as the frame that holds it', r.minimapW, r.frameW)
  check('the subhead float does not escape past its own heading', r.subheadBottom <= r.headBottom + 1, true)
  if (r.minimapW !== r.frameW) note(`mini-map ${r.minimapW}px vs frame ${r.frameW}px`)
}

async function checkEntryTabOrder() {
  console.log('\nEntry form: tab order is a strictly increasing sequence (Sprint D keyboard-first)')
  await goto('/')
  const r = await evaluate(`(() => {
    const form = document.querySelector('.enter__form');
    if (!form) return { error: 'no .enter__form' };
    // Only positive, explicitly-assigned tabindexes participate in the keyboard-first
    // sequence; -1 (programmatic focus only) and 0 (natural order) are deliberately excluded.
    const idx = [...form.querySelectorAll('[tabindex]')]
      .map(el => Number(el.getAttribute('tabindex')))
      .filter(n => Number.isFinite(n) && n > 0);
    const dupes = idx.filter((n, i) => idx.indexOf(n) !== i);
    let ascending = true;
    for (let i = 1; i < idx.length; i++) if (idx[i] <= idx[i - 1]) ascending = false;
    const contiguous = idx.length > 0 && idx.every((n, i) => n === i + 1);
    return { count: idx.length, first: idx[0], last: idx[idx.length - 1], dupes, ascending, contiguous };
  })()`)
  if (r.error) { check('Entry form present for tab-order check', r.error, null); return }
  check('every Entry tabindex is unique', r.dupes, [])
  check('Entry tabindexes ascend in DOM order', r.ascending, true)
  check('the sequence starts at callsign (tabindex 1)', r.first, 1)
  // This comment previously described an ordering (evidence-location AFTER the whole 213
  // section) that no longer matches entry.component.ts's actual chain - evidence-location
  // was moved into the Where section on 2026-08-26 (see showEvidenceLocationTabIndex's own
  // comment there) without this comment being updated to match. Rewritten 2026-09-22 (auto-
  // print-213 scoping, found stale again while inserting autoPrint213TabIndex - the previous
  // rewrite, 2026-08-26/E-103, had already fallen behind F29-47's subject213/operator
  // insertion three days later and was never corrected) to follow the real declaration order
  // in entry.component.ts, kept current as of THIS change:
  // callsign(1) + Location's 26 DD/DDM/DMS+MGRS+UTM+address fields(2-27, Sprint H grew
  // this from 19 when MGRS/UTM were added - see LocationComponent.TAB_SLOT_COUNT) +
  // showEvidenceLocation checkbox(28, 2026-08-26 architecture decision, moved here as part
  // of the Where section) + its own three conditional fields, EvidenceLocationComponent's
  // distance/unit/bearing(29-31) + date(32) + time's own hour/minute segments(33-34; a third,
  // AM/PM, existed until 2026-08-30 when the picker switched to 24-hour display - see
  // TimePickerComponent.TIME_TAB_SLOT_COUNT) + status(35) + source(36, E-41 phase 1,
  // 2026-08-26 - gathered on every report) + notes(37) + generates213 checkbox(38) +
  // its conditional fields in DOM order: reply-requested(39), E-103's (2026-08-26) per-
  // mission recipients213 checkbox group's own single reserved slot(40, the group wrapper,
  // not one stop per checkbox - see recipients213CheckboxesTabIndex's own comment in
  // entry.component.ts for why a runtime-variable-length list can't get a per-item slot the
  // way the fixed 213 fields do), the recipients213 "Additional" free-text field(41),
  // message(42), F29-47's (2026-08-29) subject213(43), and this change's own
  // autoPrint213(44, 2026-09-22 - "Print this ICS-213 as soon as I submit", last in the 213
  // box per the maintainer's own placement ask, same as every 213-box addition before it) +
  // operator(45, OUTSIDE the 213 box - applies to every report, not only 213s) + reset(46) +
  // submit(47). Every conditional block ALWAYS reserves its tab stops even though only
  // reachable once its own checkbox is ticked - see the [hidden]-not-@if comment on
  // entry.component.html's .enter__213-details/.enter__evidence for why this grows the count
  // instead of leaving those fields unreserved. Asserting CONTIGUITY rather than just a
  // count: a gap means a field was removed without renumbering, and a changed total means
  // one was added without re-planning the sequence - exactly what entry.component.ts's
  // computed tabindex chain (locationTabIndexStart -> dateTabIndex -> ... -> submitTabIndex)
  // exists to get right automatically instead of hardcoded literals.
  //
  // Fixed alongside E-103/E-11 (2026-08-26, found while verifying them): location.component
  // .html's DD/DDM/DMS/MGRS/UTM blocks used to be wrapped in @if (isVisible(...)), which
  // REMOVES their tabindex-bearing elements from the DOM entirely when a system is toggled
  // off - unlike every conditional section added since (213 fields, evidence-location, the
  // recipients213 checklist), which deliberately use [hidden] instead specifically so
  // hidden-but-reserved tab stops don't break this contiguity check. This was always
  // latently true but stayed invisible as long as all six systems defaulted to visible; the
  // "MGRS/UTM off by default" fix (0.57.0, same day) was the first time any of them ever
  // defaulted off for a fresh install, and this check is what caught it. Now [hidden]
  // throughout, matching every other conditional section.
  check('Entry tab stops are contiguous 1..N with no gaps', r.contiguous, true)
  // 47, not 46: autoPrint213TabIndex (2026-09-22, the "Print this ICS-213 as soon as I
  // submit" checkbox, last in the 213 box) inserted one new stop into the chain, same as
  // F29-47's subject213/operator insertion (2026-08-29) and the AM/PM segment's removal
  // (2026-08-30) each moved this number before it - see entry.component.ts's own comments on
  // all three changes, and the walkthrough just above for the full, current 1..47 accounting.
  check('Entry exposes the expected number of keyboard stops', r.count, 47)
}

async function checkEntryAutofocusAndReset() {
  console.log('\nEntry form: callsign holds focus on load and again after submit (no mouse needed)')
  await goto('/')
  const onLoad = await evaluate(`(document.activeElement && document.activeElement.id) || ''`)
  check('callsign is focused on load', onLoad, 'enter__Callsign-input')

  const submitted = await evaluate(`(async () => {
    const input = document.getElementById('enter__Callsign-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'E2E-AA1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const btn = document.querySelector('.enter__Submit-button');
    const wasDisabled = btn.disabled;
    btn.click();
    await new Promise(r => setTimeout(r, 1200)); // let resetEntryForm() settle before reading focus
    return {
      wasDisabled,
      focusedAfter: (document.activeElement && document.activeElement.id) || '',
      callsignCleared: document.getElementById('enter__Callsign-input').value === '',
    };
  })()`)
  check('Submit is enabled for a minimal valid entry', submitted.wasDisabled, false)
  check('callsign is re-focused after submit+reset', submitted.focusedAfter, 'enter__Callsign-input')
  check('callsign is cleared for the next report', submitted.callsignCleared, true)
}

/**
 * Architecture decision, 2026-08-26: evidence/clue location, entered as range-and-bearing
 * from the reporter's own position (evidence-location.component.ts), computed into an
 * absolute lat/lng, and drawn as its own marker on the Entry mini-map. Real risk surface
 * this guards: the computed location is a `computed()` reading a signal `input()` plus a
 * plain model signal, emitted via an `effect()` - if either wiring broke, the preview/marker
 * would silently never appear, or worse, silently go stale when the reporter's own position
 * changes after a range/bearing was already entered.
 */
async function checkEvidenceLocation() {
  console.log('\nEvidence/clue location: range-and-bearing computes a marker and survives to storage (2026-08-26)')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')
  await sleep(1500) // let the mini-map + default position settle

  const before = await evaluate(`(() => {
    const section = document.querySelector('.enter__evidence > div:last-child');
    return { hiddenByDefault: section?.hasAttribute('hidden'), markerExists: !!document.querySelector('.rt-evidence-marker') };
  })()`)
  check('evidence section is hidden by default', before.hiddenByDefault, true)
  check('no evidence marker before the section is used', before.markerExists, false)

  // 2026-08-26 (Material-M3 pass): was a structural
  // '.enter__evidence > label > input[type=checkbox]' selector, requiring the checkbox to
  // be a DIRECT child of a <label> that is a DIRECT child of .enter__evidence. The control
  // is a <mat-checkbox> now (no wrapping <label> at all in the template - mat-checkbox
  // renders its own internal one, several DOM levels deep), so that exact structural path
  // no longer exists; a data-testid on the mat-checkbox host is the stable hook, matching
  // the [[verify-the-measurement-itself]] lesson from the earlier Settings e2e repair (a
  // class/structural selector is the wrong thing to hang a test hook on - it breaks on a
  // purely visual/markup change with no warning).
  await evaluate(`(async () => {
    document.querySelector('[data-testid="evidence-toggle"] input[type=checkbox]').click();
    await new Promise(r => setTimeout(r, 300));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const set = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
    const [distInput, bearingInput] = [...document.querySelectorAll('rangertrak-evidence-location input[type=number]')];
    set(distInput, '200');
    set(bearingInput, '0'); // due north: latitude increases, longitude unchanged
    await new Promise(r => setTimeout(r, 500));
  })()`)

  const afterEntry = await evaluate(`(() => {
    const preview = document.querySelector('.evidence-location__preview')?.textContent || '';
    return { hasMarker: !!document.querySelector('.rt-evidence-marker'), previewShowsCoords: /-?\\d+\\.\\d+, -?\\d+\\.\\d+/.test(preview) };
  })()`)
  check('a marker appears once distance+bearing are entered', afterEntry.hasMarker, true)
  check('the live preview shows computed coordinates', afterEntry.previewShowsCoords, true)

  await evaluate(`(async () => {
    const cs = document.getElementById('enter__Callsign-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(cs, 'E2E-EVID');
    cs.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('.enter__Submit-button')?.click();
    await new Promise(r => setTimeout(r, 1200));
  })()`)

  const evidenceLogRaw = await idbGetRaw('radioLog')
  const stored = (() => {
    const r = JSON.parse(evidenceLogRaw || '{}');
    const report = (r.logEntries || []).find(f => f.callsign === 'E2E-EVID');
    return report?.evidenceLocation ?? null;
  })()
  check('the submitted report stored a real evidenceLocation', !!stored && typeof stored.lat === 'number', true)
  check('the stored latitude moved north (bearing 0 = due north)', stored ? stored.lat > 47.4472 : false, true)

  const afterReset = await evaluate(`(() => {
    const section = document.querySelector('.enter__evidence > div:last-child');
    return { hiddenAfterReset: section?.hasAttribute('hidden'), markerGone: !document.querySelector('.rt-evidence-marker') };
  })()`)
  check('the section collapses again after submit+reset', afterReset.hiddenAfterReset, true)
  check('the evidence marker is removed after submit+reset', afterReset.markerGone, true)
}

/**
 * Messages page (ICS-309/213 IA restructuring, scoped and built 2026-08-27): a field report
 * with "Also generate an ICS-213" checked should show up here, in full, with a working
 * Print as ICS-213 button - not just render an empty page.
 */
async function checkMessagesPage() {
  console.log('\nMessages: a generates213 report shows up, in full, with a working Print as ICS-213 button')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')
  await sleep(1200)

  await evaluate(`(() => {
    document.querySelector('[data-testid="generates213-toggle"] input[type=checkbox]').click();
  })()`)
  await sleep(300)

  await evaluate(`(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    const setInput = (el, v) => { setter.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };
    const setTextarea = (el, v) => { taSetter.call(el, v); el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); };

    const msg = document.querySelector('.enter__213-message textarea');
    setTextarea(msg, 'E2E-MSG test message body');

    // mat-chip-option's host element has no click listener of its own - the real one is on
    // its internal .mat-mdc-chip-action element (confirmed by reading Angular Material's own
    // chips.mjs template before guessing, same lesson as this file's mat-slide-toggle fix).
    const firstChipAction = document.querySelector('.enter__213 mat-chip-option .mat-mdc-chip-action');
    firstChipAction?.click();

    const cs = document.getElementById('enter__Callsign-input');
    setInput(cs, 'E2E-MSG');
    await new Promise(r => setTimeout(r, 900));
    document.querySelector('.enter__Submit-button')?.click();
    await new Promise(r => setTimeout(r, 1200));
  })()`)

  const msgLogRaw = await idbGetRaw('radioLog')
  const stored = (() => {
    const r = JSON.parse(msgLogRaw || '{}');
    const report = (r.logEntries || []).find(f => f.callsign === 'E2E-MSG');
    return report ?? null;
  })()
  check('the submitted report has generates213 set', stored?.generates213, true)
  check('the submitted report stored the message text', stored?.message213, 'E2E-MSG test message body')
  check('the submitted report stored at least one recipient', (stored?.recipients213 || []).length > 0, true)

  await goto('/messages')
  await sleep(500)
  const page = await evaluate(`(() => {
    const items = [...document.querySelectorAll('.messages__list-item')];
    const selectedText = document.querySelector('.messages__detail')?.textContent || '';
    return {
      listCount: items.length,
      hasE2EItem: items.some(el => el.textContent.includes('E2E-MSG')),
      detailShowsMessage: selectedText.includes('E2E-MSG test message body'),
    };
  })()`)
  check('the message appears in the list', page.hasE2EItem, true)
  check('the newest message is selected and shown in the detail pane by default', page.detailShowsMessage, true)

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.messages__detail button')].find(b => b.textContent.includes('Print as ICS-213'));
    btn?.click();
  })()`)
  await sleep(1500) // fetch the template + fill the PDF
  check('printing as ICS-213 raised no console errors', consoleErrors.slice(0, 2), [])
}

async function checkEntryPhoneWidth() {
  console.log('\nEntry form fits a phone (regression: .enter__Callsign min-width:350px beat width:35%)')
  // 390x844 = iPhone 12/13/14 class. mobile:true so the layout viewport behaves like a phone's.
  const PHONE_WIDTH = 390
  await send('Emulation.setDeviceMetricsOverride', { width: PHONE_WIDTH, height: 844, deviceScaleFactor: 3, mobile: true })

  // 2026-08-30: polls during load rather than measuring once after settling. Root-causing a
  // real instance of this failure (a hidden position:absolute panel that still counted
  // toward document scrollWidth despite opacity:0/visibility:hidden - CSS hides paint, not
  // layout) showed the mobile layout viewport can widen from a purely TRANSIENT event and
  // then never shrink back, even after whatever caused it self-corrects a moment later. A
  // single post-settle snapshot can therefore report the width regression while finding zero
  // currently-overflowing elements - true but useless for diagnosis. Polling catches the
  // offending element while it still exists.
  const findOffenders = () => `(() => {
    const client = document.documentElement.clientWidth;
    const all = [...document.querySelectorAll('*')];
    const overflowing = all.filter(el => el.getBoundingClientRect().right > client + 1);
    // Keep only elements with no overflowing DESCENDANT of their own - the leaves of the
    // overflow tree, i.e. the actual culprits rather than every ancestor they also widen.
    const leaves = overflowing.filter(el => !overflowing.some(other => other !== el && el.contains(other)));
    leaves.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    return leaves.slice(0, 5).map(el => ({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className : '',
      id: el.id || '',
      right: Math.round(el.getBoundingClientRect().right),
    }));
  })()`
  consoleErrors.length = 0
  await send('Page.navigate', { url: BASE + '/' })
  let firstBadTick = null
  for (let i = 0; i < 30 && !firstBadTick; i++) {
    await sleep(100)
    const offenders = await evaluate(findOffenders())
    if (offenders.length > 0) {
      firstBadTick = { ms: (i + 1) * 100, offenders }
    }
  }
  if (firstBadTick) {
    note(`first overflow at ~${firstBadTick.ms}ms into load:`)
    for (const o of firstBadTick.offenders) {
      note(`  <${o.tag}${o.id ? '#' + o.id : ''}${o.cls ? '.' + o.cls.split(' ').join('.') : ''}> right=${o.right}px`)
    }
  }

  const r = await evaluate(`(() => {
    const form = document.querySelector('.enter__form');
    return {
      formScroll: form ? Math.ceil(form.scrollWidth) : -1,
      docScroll: Math.ceil(document.documentElement.scrollWidth),
      // E-65: BOTH of these are needed, and they are not interchangeable.
      //   innerWidth  = the LAYOUT viewport, which a mobile browser WIDENS when content
      //                 overflows, so it inflates in lockstep with the very bug this
      //                 check exists to catch.
      //   clientWidth = the emulated device width, which does not move.
      // Comparing content against innerWidth alone is what let Entry render ~1085px wide
      // inside a "390px" phone for several releases while this check reported PASS: the
      // form was 1085, innerWidth had been dragged out to 1101, 1085 <= 1101, green.
      inner: window.innerWidth,
      client: document.documentElement.clientWidth,
    };
  })()`)
  // The real assertion: content fits the DEVICE, not the viewport the content itself moved.
  check('the Entry form does not exceed a phone viewport', r.formScroll <= r.client, true)
  check('the page itself does not scroll horizontally on a phone', r.docScroll <= r.client, true)
  // Independent of the two above: if the layout viewport had to grow past the device width
  // at all, something overflowed, even if every element then "fits" that widened viewport.
  check('the layout viewport was not widened past the device width', r.inner <= r.client, true)
  if (r.formScroll > r.client || r.docScroll > r.client || r.inner > r.client) {
    note(`widths: form ${r.formScroll}px, document ${r.docScroll}px, layout viewport ${r.inner}px, device ${r.client}px`)
    if (!firstBadTick) {
      // The post-settle snapshot still has nothing to show for itself - see this
      // function's own comment above for why that can happen (viewport already stuck wide,
      // offending element already gone). Nothing more to add here in that case.
      note('  (no longer-overflowing element found post-settle either - see the poll above, or re-run: this can be a one-shot transient)')
    }
  }
  await send('Emulation.clearDeviceMetricsOverride')
}

/**
 * E-65: the same "does it fit a phone" question as checkEntryPhoneWidth above, asked of
 * EVERY route rather than just Entry.
 *
 * Entry-only coverage was half of why E-65 survived so long: Settings had been forcing the
 * page to ~466px since before Sprint C (the roadmap recorded the number and the culprit and
 * deferred it), and nothing failed, because nothing looked. The other half was comparing
 * against window.innerWidth - see the note in checkEntryPhoneWidth.
 *
 * What this deliberately does NOT assert: that no element anywhere is wider than the phone.
 * A grid scrolling horizontally INSIDE its own container is the accepted outcome for
 * Rangers and the Settings status grid (see the roadmap's deferred phone-layout decision).
 * The line this draws is that the PAGE must not be dragged wider - that moves every element
 * on it, which is a different and worse thing than an opt-in scroll inside one panel.
 */
async function checkAllRoutesPhoneWidth() {
  console.log('\nEvery route fits a phone: no route drags the layout viewport wider (E-65)')
  const PHONE_WIDTH = 390
  await send('Emulation.setDeviceMetricsOverride', { width: PHONE_WIDTH, height: 844, deviceScaleFactor: 3, mobile: true })
  for (const route of ROUTES) {
    await goto(route)
    const r = await evaluate(`({
      device: document.documentElement.clientWidth,
      inner: window.innerWidth,
      docScroll: Math.ceil(document.documentElement.scrollWidth),
    })`)
    const ok = r.inner <= r.device && r.docScroll <= r.device + 1
    check(`${route} does not widen the page past the device`, ok, true)
    if (!ok) note(`${route}: device ${r.device}px, layout viewport ${r.inner}px, document ${r.docScroll}px`)
  }
  await send('Emulation.clearDeviceMetricsOverride')
}

/**
 * E-57(3): the back-to-top control appears only when it should, and works.
 *
 * The interesting assertion is the NEGATIVE one - a floating button that shows up on a
 * short, unscrolled page is worse than no button, because it covers content for no reason.
 */
async function checkBackToTop() {
  console.log('\nBack-to-top appears only on a tall, scrolled page - and returns to the top (E-57)')
  await goto('/')
  check('hidden on a page that has not been scrolled', await evaluate(`!!document.querySelector('.back-to-top')`), false)

  await goto('/log')
  // Force real height rather than depending on how much log a fresh profile happens to hold.
  await evaluate(`(() => {
    const f = document.createElement('div'); f.style.height = '4000px'; f.id = 'e2e-tall-filler';
    document.querySelector('.content')?.appendChild(f);
  })()`)
  check('still hidden while at the top of a tall page', await evaluate(`!!document.querySelector('.back-to-top')`), false)

  await evaluate(`window.scrollTo(0, 1200)`)
  await sleep(600)
  const shown = await evaluate(`(() => {
    const b = document.querySelector('.back-to-top')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { tag: b.tagName, w: Math.round(r.width), h: Math.round(r.height), named: !!b.getAttribute('aria-label') }
  })()`)
  check('appears once scrolled down a tall page', shown !== null, true)
  if (shown) {
    check('is a real, accessibly-named button', shown.tag === 'BUTTON' && shown.named, true)
    // D-33 / --rt-tap-min: gloved hands outdoors.
    check('meets the 44px field tap minimum', shown.w >= 44 && shown.h >= 44, true)
  }

  await evaluate(`document.querySelector('.back-to-top')?.click()`)
  await sleep(1200)
  const after = await evaluate(`({ y: Math.round(window.scrollY), still: !!document.querySelector('.back-to-top') })`)
  check('clicking it returns to the top', after.y, 0)
  check('and it hides itself again once there', after.still, false)
}

/**
 * E-83: the Entry welcome panel is visible by default, dismissing it persists (a fresh
 * navigation to Entry doesn't bring it back), and clicking the header's status-cluster
 * pill from anywhere else in the app navigates to Entry and reopens it. Also guards that
 * clicking the readiness dot INSIDE the pill still goes to its own destination (/mission)
 * rather than being hijacked by the pill's own click handler - the two are easy to get
 * fighting over the same click if the guard in onStatusClusterClick() ever regresses.
 */
async function checkWelcomePanelDismissAndReopen() {
  console.log('\nE-83: Entry welcome panel dismisses, persists dismissed, and reopens via the header pill')
  await goto('/')
  await evaluate(`localStorage.removeItem('entryWelcomeDismissed')`)
  await goto('/')

  check('the welcome panel is visible by default', await evaluate(`!!document.querySelector('.entry-welcome')`), true)

  await evaluate(`document.querySelector('.entry-welcome__dismiss')?.click()`)
  await sleep(300)
  check('dismissing it hides the panel', await evaluate(`!!document.querySelector('.entry-welcome')`), false)
  check('the dismissed flag persisted', await evaluate(`localStorage.getItem('entryWelcomeDismissed')`), 'true')

  await goto('/')
  check('stays hidden after a fresh navigation to Entry', await evaluate(`!!document.querySelector('.entry-welcome')`), false)

  await navigateInApp('Rangers')
  await evaluate(`document.querySelector('.status-cluster')?.click()`)
  await sleep(1500)
  check('clicking the status-cluster pill navigates to Entry', await evaluate(`location.pathname`), '/')
  check('...and reopens the welcome panel', await evaluate(`!!document.querySelector('.entry-welcome')`), true)
  check('...and cleared the dismissed flag', await evaluate(`localStorage.getItem('entryWelcomeDismissed')`), null)

  // The readiness dot inside the pill must still reach its own destination, not be
  // hijacked by the pill's own click handler.
  await evaluate(`document.querySelector('.readiness-dot')?.click()`)
  await sleep(1500)
  check('clicking the readiness dot inside the pill still goes to Mission, not hijacked', await evaluate(`location.pathname`), '/mission')
}

/**
 * E-84: the Help page is tabs, and is the app's canonical user documentation.
 *
 * Scoped deliberately to '.help-tabs' rather than to Material's tab chrome generally: a
 * selector like '.mat-mdc-tab' would match a tab strip anywhere in the app, so this check
 * would pass on a page that has tabs for some other reason and keep passing if Help itself
 * regressed to one long scroll. Confirmed red before the tabs existed.
 *
 * Asserts the bodies actually swap, not just that the labels render - a tab strip whose
 * panels all show the same content is the plausible-looking failure here.
 *
 * 2026-08-27: "Start here" split into a separate About tab (was doing two jobs at once -
 * describing what RangerTrak is, and walking through the first five minutes on a new
 * device), and a Log tab was added so the Log page (deliberately absent from the main nav)
 * is still easy to find - eight tabs now, not six.
 *
 * 2026-08-29 (D-d, F29-32, F29-33): reordered/relabelled again - "Mission setup" merged
 * into "Start here" as one onboarding checklist, FAQ moved up, "After mission" split out of
 * "Your data" (the merge and the split cancel out - still eight), and "Log" renamed
 * "Feedback" - it now also carries the feedback form, so the Log link moved with it, off
 * the About tab.
 *
 * 2026-08-30 (live request): "Entering reports" and "Maps" moved out entirely, into the
 * Entry and Map pages' own Guide drawers - both were screen-specific operating instructions,
 * which is what the Guide (not general Help) is for. Six tabs now.
 */
async function checkHelpTabs() {
  console.log('\nE-84: Help renders six tabs and switching them changes the body')
  await goto('/help')

  const labels = await evaluate(`(() => {
    const group = document.querySelector('.help-tabs');
    if (!group) return 'NO .help-tabs';
    return [...group.querySelectorAll('.mat-mdc-tab .mdc-tab__text-label')]
      .map(el => el.textContent.trim()).join('|');
  })()`)
  // 2026-08-30: "Entering reports" and "Maps" moved into the Entry/Map pages' own Guide
  // drawers (screen-specific operating instructions, not general Help) - see guide-content.ts.
  check('six tabs, in the planned order', labels,
    'Start here|About|FAQ|Your data|After mission|Feedback')

  const firstBody = await evaluate(`document.querySelector('.help-tabs rangertrak-help-start') ? 'start' : 'missing'`)
  check('the first tab shows the Start here body', firstBody, 'start')

  // Click the FAQ tab and confirm a different component is now mounted.
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.help-tabs .mat-mdc-tab')]
      .find(t => t.textContent.trim() === 'FAQ');
    tab?.click();
  })()`)
  await sleep(600)
  check('switching to FAQ mounts the FAQ body', await evaluate(`!!document.querySelector('.help-tabs rangertrak-help-faq')`), true)
  check('...and the Start here body is gone', await evaluate(`!!document.querySelector('.help-tabs rangertrak-help-start')`), false)

  // The Log link started in the prose (E-57(1)), then moved to the About strip below the
  // tab group (E-84), then into the About tab itself (F29-25, 2026-08-29). D-d (same day,
  // later) moved it again, into the new Feedback tab (renamed from Log, which now also
  // carries the feedback form) - it must survive each move, since it's the path a bug
  // reporter is told to follow.
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.help-tabs .mat-mdc-tab')]
      .find(t => t.textContent.trim() === 'Feedback');
    tab?.click();
  })()`)
  await sleep(600)
  check('the Feedback tab links to the Log page',
    await evaluate(`!!document.querySelector('.help-tabs rangertrak-help-feedback a[href="/log"]')`), true)
}

/**
 * E-48(1): the derived Address / +Codes / What3Words block belongs to the report being
 * entered right now, not the previous one.
 *
 * Worth a permanent check because the failure is silent and plausible-looking: the block
 * shows a real, correctly-formatted address - just the *last* report's. A scribe confirming
 * a position against it would be confirming against the wrong thing, which is worse than
 * showing nothing. The fix (a formGeneration counter, since the position deliberately does
 * NOT reset between reports) is also the kind of indirection a later edit could quietly
 * sever without any test noticing.
 */
async function checkDerivedValuesDoNotCarryOver() {
  console.log('\nDerived address/+Codes belong to the CURRENT report, not the previous one (E-48)')
  await goto('/')

  const hiddenAtFirst = await evaluate(`(() => {
    const b = document.querySelector('.enter__Where-Results')
    return b ? b.classList.contains('enter__Where-Results--hidden') : null
  })()`)
  // Not asserted as a hard true: on a fast machine the initial reverse-geocode for the
  // default position may already have resolved by now, which legitimately reveals it.
  note(`derived block hidden immediately after load: ${hiddenAtFirst}`)

  // Wait for the initial derivation to actually land, then confirm it is populated.
  let populated = false
  for (let i = 0; i < 20 && !populated; i++) {
    await sleep(500)
    populated = await evaluate(`!!document.getElementById('derivedAddress')?.textContent?.trim()`)
  }
  check('derived values populate once a position resolves', populated, true)
  const firstAddress = await evaluate(`document.getElementById('derivedAddress')?.textContent?.trim()`)

  // Submit a report. resetAll() bumps formGeneration, which must clear and re-derive.
  await evaluate(`(() => {
    const cs = document.getElementById('enter__Callsign-input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(cs, 'E2E-DERIVED')
    cs.dispatchEvent(new Event('input', { bubbles: true }))
    cs.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await sleep(900)
  await evaluate(`document.querySelector('.enter__Submit-button')?.click()`)
  await sleep(1500)

  // The requirement, in the reporter's words, is that these "clear once the report is
  // submitted". The position deliberately survives a reset (consecutive reports from one
  // spot are normal), which makes re-deriving them tempting - but anything auto-refilled
  // before the NEW report has a position of its own reproduces the original complaint,
  // just one step later. So: cleared, and staying cleared, is the pass condition.
  await sleep(2500) // long enough that a stray re-derivation would have landed
  const after = await evaluate(`(() => {
    const block = document.querySelector('.enter__Where-Results')
    return {
      address: document.getElementById('derivedAddress')?.textContent?.trim(),
      pCodes: document.getElementById('pCodes')?.textContent?.trim(),
      hidden: block ? block.classList.contains('enter__Where-Results--hidden') : null,
    }
  })()`)
  note(`after submit: ${JSON.stringify(after)}`)
  check('the derived block is hidden again after submit', after.hidden, true)
  check('the previous report address does not survive the submit', after.address, '')
  check('...nor its +Codes', after.pCodes, '')
  // Guards the specific regression this replaced: text left in a hidden element flashes
  // back the instant the block is shown again for the next report.
  check('firstAddress was genuinely non-empty, so the above means something', !!firstAddress, true)
}

async function checkLocationDdDdmDmsSync() {
  console.log('\nLocation: DD / DDM / DMS stay in sync, including a rapid second edit')
  await goto('/')
  // Vashon EOC-ish: 47.4472, -122.4627 -> 47deg 26.832' N / 47deg 26' 49.9" N
  const settled = await evaluate(`(async () => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); // (change) handlers drive the conversion
    };
    set('enter__Where-latI', 47); set('enter__Where-latF', 4472);
    await new Promise(r => setTimeout(r, 900));
    const g = id => document.getElementById(id).value;
    return { ddmDeg: g('enter__Where-latDdmD'), ddmMin: g('enter__Where-latDdmM'), dmsDeg: g('enter__Where-latD') };
  })()`)
  check('DDM degrees follow a DD edit', Number(settled.ddmDeg), 47)
  check('DMS degrees follow a DD edit', Number(settled.dmsDeg), 47)
  check('DDM minutes are ~26.8 for .4472 degrees', Math.abs(Number(settled.ddmMin) - 26.832) < 0.2, true)

  // The regression this guards is an edit being LOST - the old debounce/merge dispatcher
  // swallowed a second field change that arrived inside its ~300ms window.
  //
  // Deliberately NOT asserted: two edits inside the same microtask. That genuinely does drop
  // the second, because the first edit's canonical->linkedSignal recompute writes model-derived
  // values back to the DOM before change detection has seen the second. It is also not
  // reachable by a human - every real keystroke gets its own task with CD in between - and an
  // earlier draft of this check that fired both edits ~60ms apart sat right on the CD boundary
  // and failed intermittently. So: drive each edit the way a fast typist would (wait for the
  // first to be visibly reflected, then immediately make the second), and assert the thing that
  // actually matters - that neither field clobbered the other.
  //
  // Sprint H note: canonical() now also drives mgrsModel/utmModel (real UTM-projection math,
  // heavier than DD/DDM/DMS's arithmetic), which measurably increased how often this specific
  // check lands on that same CD boundary (~1 in 5 runs locally, vs. effectively never before).
  // Verified separately (a standalone CDP round-trip of DD<->MGRS<->UTM<->Maidenhead, all
  // exact, zero console errors) that this is test timing, not a real reactivity bug - if it
  // starts failing routinely rather than occasionally, that budget is worth revisiting.
  const rapid = await evaluate(`(async () => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const g = id => document.getElementById(id).value;
    const until = async (id, want) => {
      for (let i = 0; i < 40; i++) {
        if (Number(g(id)) === want) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    };

    set('enter__Where-latI', 45);
    const latLanded = await until('enter__Where-latDdmD', 45);
    set('enter__Where-lngI', -120);           // immediately follows, no artificial pause
    const lngLanded = await until('enter__Where-lngDdmD', -120) || await until('enter__Where-lngDdmD', 120);

    await new Promise(r => setTimeout(r, 400));  // let everything settle, then re-read BOTH
    return { latLanded, lngLanded, latFinal: g('enter__Where-latDdmD'), lngFinal: g('enter__Where-lngDdmD') };
  })()`)
  check('a lat edit lands', rapid.latLanded, true)
  check('a lng edit immediately after it also lands', rapid.lngLanded, true)
  // The real prize: the second edit must not have reverted the first.
  check('the lat edit survives the lng edit that followed it', Number(rapid.latFinal), 45)
  check('the lng edit is still there too', Math.abs(Number(rapid.lngFinal)), 120)
}

async function checkFieldReportsPhoneLayout() {
  console.log('\nField Reports: phone width shows cards not the grid, tablet-up shows the grid not cards (Sprint F carve-out)')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
  await goto('/radio-log')
  const phone = await evaluate(`(() => ({
    grid: !!document.querySelector('#reportsgrid ag-grid-angular .ag-root-wrapper'),
    cards: !!document.querySelector('.radio-log-cards'),
  }))()`)
  check('phone width: no ag-grid root is constructed', phone.grid, false)
  check('phone width: the card list renders instead', phone.cards, true)
  await send('Emulation.clearDeviceMetricsOverride')

  // Tablet-up (D-33): a folding-table command post, not a phone.
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 800, deviceScaleFactor: 1, mobile: false })
  await goto('/radio-log')
  const tablet = await evaluate(`(() => ({
    grid: !!document.querySelector('#reportsgrid ag-grid-angular .ag-root-wrapper'),
    cards: !!document.querySelector('.radio-log-cards'),
  }))()`)
  check('tablet-up: the grid renders', tablet.grid, true)
  check('tablet-up: no card list is present', tablet.cards, false)
  await send('Emulation.clearDeviceMetricsOverride')
}

async function checkGridThemeUsesTokens() {
  console.log('\nAG Grid Theming API resolves through --rt-* tokens (Sprint F: legacy ag-theme-alpine.css is gone)')
  const read = async () => {
    await goto('/radio-log')
    // AG Grid v36's Theming API (cacfeb3, the ag-grid 35->36 bump) paints the header
    // background on .ag-header-row's ::after pseudo-element, not directly on .ag-header
    // as v35 did - .ag-header itself now has no background-color at all. Confirmed live
    // via CDP (2026-08-24) before changing this: --ag-header-background-color resolves
    // correctly to the --rt-surface-2 token in both schemes, the paint is just on a
    // different element. See verify-the-measurement-itself memory.
    return evaluate(`(() => {
      const root = getComputedStyle(document.documentElement);
      const row = document.querySelector('#reportsgrid .ag-header-row');
      return {
        tokenSurface2: root.getPropertyValue('--rt-surface-2').trim(),
        headerBg: row ? getComputedStyle(row, '::after').backgroundColor : null,
      };
    })()`)
  }
  const light = await withColorScheme('light', read)
  const dark = await withColorScheme('dark', read)

  // The token and the grid header must both be readable, and - the actual point of Sprint F -
  // the header must not be sitting at ag-theme-alpine's old hardcoded default, and must change
  // between schemes exactly as the token does (light-dark() resolves per scheme with no separate
  // AG Grid dark-mode config, per ag-grid-theme.ts).
  check('a header cell is present in both schemes', !!light.headerBg && !!dark.headerBg, true)
  check('the grid header colour changes between light and dark, tracking the token', light.headerBg !== dark.headerBg, true)
  if (light.headerBg) note(`--rt-surface-2 light=${light.tokenSurface2} dark=${dark.tokenSurface2} | header bg light=${light.headerBg} dark=${dark.headerBg}`)
}

/**
 * Runs `body` with the browser emulating a given prefers-color-scheme, then restores.
 *
 * ADR D-24 requires verifying both colour schemes, but until Sprint E nothing in this harness
 * actually exercised them - every check ran in whatever scheme the headless default happened
 * to be. Light/dark is exactly where the token layer can silently fail (a colour defined in
 * one scheme and not the other is how the pre-Sprint-A dark mode broke).
 */
async function withColorScheme(scheme, body) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] })
  try {
    return await body()
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] })
  }
}

async function checkStatusColorsBothSchemes() {
  console.log(String.fromCharCode(10) + 'Status colours resolve per colour scheme (the point of storing keys, not hex)')
  const read = async () => {
    await goto('/')
    return evaluate(`[...document.querySelectorAll('.Enter__status-value')].map(s => getComputedStyle(s).color)`)
  }
  const light = await withColorScheme('light', read)
  const dark = await withColorScheme('dark', read)

  check('status labels render in light scheme', light.length > 0, true)
  check('status labels render in dark scheme', dark.length, light.length)

  // checkStatusColorMigration() above seeds six token-backed statuses plus ONE deliberately
  // customised hex (#FF00FF on Urgent). That split is the whole design in miniature, so assert
  // both halves of it: keys adapt per scheme, a custom colour is left exactly as the user set
  // it. A stored hex simply cannot adapt - it is one colour - which is why the migration moved
  // the defaults to keys and why keeping a custom override means accepting this tradeoff.
  const tokenBacked = light.slice(0, 6)
  check('every token-backed status colour changes with the scheme',
    tokenBacked.length === 6 && tokenBacked.every((c, i) => c !== dark[i]), true)
  check('a user-chosen custom colour stays put across schemes', light[6], dark[6])
  if (light.length) note(`token light[0]=${light[0]} dark[0]=${dark[0]} | custom light[6]=${light[6]} dark[6]=${dark[6]}`)
}

// ─────────────────────────────────────────────────────────────────────────────
//  KNOWN-OPEN BUGS, reported from production v0.15.8 on 2026-08-19.
//
//  These three checks are EXPECTED TO FAIL until the fixes land. They are committed
//  failing on purpose: each one reproduces a real defect a user hit on rangertrak.org that
//  this suite did not catch, and a red check is the only honest record of that. See the
//  Sprint E plan's "Known-open production bugs" section for the diagnosis and fix plan.
// ─────────────────────────────────────────────────────────────────────────────

async function checkCallsignIsSaved() {
  console.log('\nBUG-1 (open): the callsign chosen on Entry must reach the saved report')
  await goto('/')
  await evaluate(`(async () => {
    const input = document.getElementById('enter__Callsign-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'E2E-AA1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1200));   // past the 700ms autocomplete debounce
    document.querySelector('.enter__Submit-button').click();
    await new Promise(r => setTimeout(r, 1200));
  })()`)
  // E-122 Phase 2a: radioLog/rangers moved off localStorage - read separately, after the DOM
  // round trip above already waited out the submit's own settle time.
  const reports = JSON.parse((await idbGetRaw('radioLog')) || '{}');
  const roster = (JSON.parse((await idbGetRaw('rangers')) || '{"rangers":[]}').rangers) || [];
  const saved = (() => {
    const list = reports.logEntries || [];
    const last = list[list.length - 1] || {};
    // ADR D-42/D-43: the report should also carry rangerUid, resolved from the typed
    // callsign, and it must equal that ranger's uid in the roster.
    const match = roster.find(r => r.callsign === 'E2E-AA1') || {};
    return {
      count: list.length, callsign: last.callsign, typedInto: 'E2E-AA1',
      rangerUid: last.rangerUid || '', rosterUid: match.uid || '',
      schemaVersion: reports.schemaVersion,
    };
  })()
  check('a report was actually stored', saved.count > 0, true)
  // ADR D-42/D-43 phase 4: the whole chain, end to end - typed callsign resolves to a ranger,
  // and the report is attributed by the surrogate key rather than by a string match done
  // again later. A unit test cannot cover this; the resolution happens in the live form.
  check('the report is attributed by rangerUid, not just a callsign string',
    saved.rangerUid !== '' && saved.rangerUid === saved.rosterUid, true)
  check('the field-report store carries a schemaVersion', typeof saved.schemaVersion, 'number')
  // The input has BOTH [formControl]="callsignCtrl" AND formControlName="callsign"; only one
  // can be the value accessor, so entryControlsForm.callsign never receives what was typed
  // and mergedFormValue() saves ''. The ICS-309 log is worthless without who filed the report.
  check('the saved report carries the callsign that was entered', saved.callsign, 'E2E-AA1')
}

async function checkReportsSurviveNavigation() {
  console.log('\nBUG-2 (open): reports entered on Entry must be visible on the Reports page')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')

  for (const note of ['E2E-FIRST', 'E2E-SECOND']) {
    await evaluate(`(async () => {
      const ta = document.querySelector('textarea[placeholder="Enter Any Notes"]');
      if (ta) {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(note)});
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 300));
      document.querySelector('.enter__Submit-button').click();
      await new Promise(r => setTimeout(r, 1200));
    })()`)
  }

  const stored = (JSON.parse((await idbGetRaw('radioLog')) || '{}').logEntries || []).length
  check('both reports reached storage', stored, 2)

  // Click through, do NOT reload: a reload rebuilds every service and hides the bug.
  await navigateInApp('Radio Log', 3500)
  // .ag-center-cols-container is gone in AG Grid v36 (cacfeb3) - the row-container
  // structure was rebuilt (.ag-grid-scrolling-rows and friends replace it). .ag-row itself
  // is still the real row class, scoped to #reportsgrid so it can't pick up another grid.
  // Confirmed live via CDP (2026-08-24): this selector finds both submitted rows and AG
  // Grid's own pagination summary independently reports "1 to 2 of 2".
  const shown = await evaluate(`(() => {
    const rows = document.querySelectorAll('#reportsgrid .ag-row');
    return rows.length;
  })()`)
  check('the Reports grid shows the reports that were just entered', shown, 2)
}

/**
 * E-80 phase 1: a callsign with two check-ins at different positions should draw a route
 * trail on the map. Not asserting colour/team here (that's a join against the roster, not
 * the geometry) - this guards the thing the Definition of Done actually requires: a trail
 * renders for a multi-report callsign. Per verify-the-measurement-itself, confirmed this
 * fails on the pre-E-80 build (no .leaflet-overlay-pane path existed at all) before the
 * feature landed.
 */
async function checkTeamTrailsRender() {
  console.log('\nE-80: a route trail renders for a callsign with multiple check-ins')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')

  // Two distinct positions near the default Vashon EOC location, submitted under the same
  // callsign - drawn via the DD lat/lng fields, the same technique checkLocationDdDdmDmsSync
  // uses, rather than hand-building the FieldReportsType wrapper (bounds/maxId/filter are
  // easy to get subtly wrong by hand; driving the real form exercises the real save path).
  for (const [lat, lng] of [[47.40, -122.46], [47.45, -122.40]]) {
    await evaluate(`(async () => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('enter__Where-latI', Math.trunc(${lat}));
      set('enter__Where-latF', Math.round((Math.abs(${lat}) % 1) * 10000));
      set('enter__Where-lngI', Math.trunc(${lng}));
      set('enter__Where-lngF', Math.round((Math.abs(${lng}) % 1) * 10000));
      await new Promise(r => setTimeout(r, 900));

      const cs = document.getElementById('enter__Callsign-input');
      const csSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      csSet.call(cs, 'E2E-TRAIL');
      cs.dispatchEvent(new Event('input', { bubbles: true }));
      cs.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));

      document.querySelector('.enter__Submit-button')?.click();
      await new Promise(r => setTimeout(r, 1200));
    })()`)
  }

  const stored = (JSON.parse((await idbGetRaw('radioLog')) || '{}').logEntries || [])
    .filter(f => f.callsign === 'E2E-TRAIL').length
  check('both E2E-TRAIL reports reached storage', stored, 2)

  await navigateInApp('Map', 3500)
  // Scoped to the MAIN map container (#mapLeaflet-main), not the whole document: the
  // overview mini-map (#mapLeaflet-overview) always draws its own current-view rectangle
  // as an SVG path in its own .leaflet-overlay-pane, regardless of trails - an unscoped
  // selector here passed vacuously even with the trail feature reverted (caught by running
  // this check red-before-fix, per verify-the-measurement-itself).
  let pathCount = 0
  for (let i = 0; i < 10 && pathCount === 0; i++) {
    await sleep(300)
    pathCount = await evaluate(`document.querySelectorAll('#mapLeaflet-main .leaflet-overlay-pane path').length`)
  }
  check('a route trail renders on the map for a multi-report callsign', pathCount > 0, true)

  // Elapsed-time follow-on (2026-08-24, redone 2026-08-26 as a bare number with a
  // staleness-banded background): a static minutes-elapsed label at the trail's newest
  // point - not a live clock, see the feature's own doc comment in drawTrails().
  const elapsedText = await evaluate(`document.querySelector('#mapLeaflet-main .rt-trail-elapsed')?.textContent || ''`)
  check('the trail shows a static elapsed-time label at its newest point', /^\d+$/.test(elapsedText.trim()), true)
}

/**
 * E-86 (narrowed 2026-08-24: "ignore the team concept for now, just make ranger markers
 * unique"): two different callsigns should render two visibly distinct markers (shape and
 * colour both derived from the callsign - see rangerIconFor() in
 * shared/mapping/ranger-icon.ts). The two check-in positions are deliberately far apart
 * (~150 miles) so Leaflet.markercluster's pixel-proximity clustering can't merge them into
 * one cluster bubble after the map's own fitBounds() zooms to show both - a nearby pair
 * like E-80's trail check uses would risk masking two real markers behind one cluster icon.
 */
async function checkRangerMarkersAreDistinct() {
  console.log('\nE-86: two different callsigns get visibly distinct map markers')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')

  for (const { callsign, lat, lng } of [
    { callsign: 'E2E-MARKER-A', lat: 47.60, lng: -122.30 },
    { callsign: 'E2E-MARKER-B', lat: 45.50, lng: -122.70 },
  ]) {
    await evaluate(`(async () => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('enter__Where-latI', Math.trunc(${lat}));
      set('enter__Where-latF', Math.round((Math.abs(${lat}) % 1) * 10000));
      set('enter__Where-lngI', Math.trunc(${lng}));
      set('enter__Where-lngF', Math.round((Math.abs(${lng}) % 1) * 10000));
      await new Promise(r => setTimeout(r, 900));

      const cs = document.getElementById('enter__Callsign-input');
      const csSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      csSet.call(cs, ${JSON.stringify(callsign)});
      cs.dispatchEvent(new Event('input', { bubbles: true }));
      cs.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));

      document.querySelector('.enter__Submit-button')?.click();
      await new Promise(r => setTimeout(r, 1200));
    })()`)
  }

  const stored = (JSON.parse((await idbGetRaw('radioLog')) || '{}').logEntries || [])
    .filter(f => f.callsign === 'E2E-MARKER-A' || f.callsign === 'E2E-MARKER-B').length
  check('both E2E-MARKER reports reached storage', stored, 2)

  await navigateInApp('Map', 3500)
  let markers = []
  for (let i = 0; i < 10 && markers.length < 2; i++) {
    await sleep(300)
    // Scoped to #mapLeaflet-main for the same reason E-80/E-85's checks are: the overview
    // mini-map is a second, separate Leaflet instance on this same page.
    markers = await evaluate(`[...document.querySelectorAll('#mapLeaflet-main .rt-ranger-marker svg')].map(svg => svg.innerHTML)`)
  }
  check('two distinct ranger markers render for two different callsigns', markers.length >= 2, true)
  if (markers.length >= 2) {
    check('the two markers are not visually identical', markers[0] !== markers[1], true)
  }
}

/**
 * ADR D-42 phase 5: two DIFFERENT rangers with NO callsign - the population D-42 exists to
 * serve - must not collapse into one indistinguishable identity. Before this phase,
 * `rangerIconFor()`/`rangerColorFor()` hashed `callsign`, so every callsignless ranger's
 * reports hashed the same empty string: identical markers, and `drawTrails()` grouped them
 * under one shared '' key so two unrelated people's positions could be joined by a single
 * bogus trail. Seeds two rangers directly into the versioned `rangers` store (bypassing the
 * roster-import path, which still throws on a blank callsign until Phase 7) with distinct
 * `id`s and no `callsign`, attributes two check-ins each by typing their `fullName` into the
 * same callsign box Phase 4 widened, and checks both halves of the fix: markers differ (the
 * `id` hash) and trails don't cross rangers (the `rangerUid` grouping key). Per
 * verify-the-measurement-itself, confirmed this fails on the pre-phase-5 build - 3 path
 * segments (one bogus trail spanning both rangers) and two identical UNASSIGNED_MARKER svgs.
 */
async function checkNoCallsignRangersGetDistinctIdentity() {
  console.log('\nD-42 phase 5: two callsignless rangers get distinct markers and separate trails')
  const uidA = 'e2e-uid-nocs-1', uidB = 'e2e-uid-nocs-2'
  const nameA = 'Fixture NoCallsign One', nameB = 'Fixture NoCallsign Two'

  await goto('/')
  // E-122 Phase 2a: rangers moved off localStorage - written straight into IndexedDB here
  // (bypassing the app entirely, same as the old direct localStorage.setItem() did) so the
  // NEXT goto('/') below boots with this roster already in place.
  {
    const cur = JSON.parse((await idbGetRaw('rangers')) || '{"schemaVersion":1,"rangers":[]}');
    cur.rangers = (cur.rangers || []).concat([
      { uid: uidA, id: 'REW-9101', callsign: '', fullName: nameA, phone: '', image: '', rew: '', team: '', role: '', note: '' },
      { uid: uidB, id: 'REW-9102', callsign: '', fullName: nameB, phone: '', image: '', rew: '', team: '', role: '', note: '' },
    ]);
    cur.schemaVersion = cur.schemaVersion ?? 1;
    await idbSetRaw('rangers', JSON.stringify(cur));
  }
  await idbRemoveRaw('radioLog')
  await goto('/')

  // Two check-ins each, close together within a ranger (so a real trail has something to
  // draw) but the two rangers far apart (so markercluster can't merge their marker icons -
  // same margin checkRangerMarkersAreDistinct uses).
  const checkIns = [
    { name: nameA, lat: 47.60, lng: -122.30 },
    { name: nameA, lat: 47.62, lng: -122.28 },
    { name: nameB, lat: 45.50, lng: -122.70 },
    { name: nameB, lat: 45.52, lng: -122.68 },
  ]
  for (const { name, lat, lng } of checkIns) {
    await evaluate(`(async () => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('enter__Where-latI', Math.trunc(${lat}));
      set('enter__Where-latF', Math.round((Math.abs(${lat}) % 1) * 10000));
      set('enter__Where-lngI', Math.trunc(${lng}));
      set('enter__Where-lngF', Math.round((Math.abs(${lng}) % 1) * 10000));
      await new Promise(r => setTimeout(r, 900));

      // No callsign to type - the ranger is identified by fullName, the exact case Phase 4's
      // widened _filterRangers()/matchRanger() exist to handle.
      const cs = document.getElementById('enter__Callsign-input');
      const csSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      csSet.call(cs, ${JSON.stringify(name)});
      cs.dispatchEvent(new Event('input', { bubbles: true }));
      cs.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));

      document.querySelector('.enter__Submit-button')?.click();
      await new Promise(r => setTimeout(r, 1200));
    })()`)
  }

  const nocsLogRaw = await idbGetRaw('radioLog')
  const stored = (() => {
    const r = JSON.parse(nocsLogRaw || '{}');
    const list = r.logEntries || [];
    return {
      countA: list.filter(f => f.rangerUid === uidA).length,
      countB: list.filter(f => f.rangerUid === uidB).length,
      blankCallsigns: list.filter(f => (f.rangerUid === uidA || f.rangerUid === uidB) && f.callsign === '').length,
    };
  })()
  check('both check-ins for the first callsignless ranger resolved by rangerUid', stored.countA, 2)
  check('both check-ins for the second callsignless ranger resolved by rangerUid', stored.countB, 2)
  check('all four reports correctly kept a blank callsign (identified by name, not radio)', stored.blankCallsigns, 4)

  await navigateInApp('Map', 3500)

  let pathCount = 0
  for (let i = 0; i < 10 && pathCount === 0; i++) {
    await sleep(300)
    pathCount = await evaluate(`document.querySelectorAll('#mapLeaflet-main .leaflet-overlay-pane path').length`)
  }
  // One segment per ranger (2 check-ins = 1 segment each) = 2 paths. The pre-fix grouping
  // (by blank callsign) would lump all four into one group of 4, sorted by date, drawing 3
  // segments - one of them a bogus line connecting the two different rangers' positions.
  check('exactly one trail segment per callsignless ranger, not one crossing both', pathCount, 2)

  // Marker distinctness needs its OWN, single-check-in-per-ranger scenario, deliberately NOT
  // reusing the trail check-ins above: those pair two close-together points per ranger so a
  // trail has something to draw, and at the zoom fitBounds() picks to show a ~250-mile span,
  // markercluster merges each ranger's own close pair into one cluster bubble - hiding the
  // individual '.rt-ranger-marker' svgs regardless of whether the identity fix works. One
  // report per ranger, at the same separation checkRangerMarkersAreDistinct() uses, removes
  // that confound.
  await idbRemoveRaw('radioLog')
  await goto('/')
  for (const { name, lat, lng } of [
    { name: nameA, lat: 47.60, lng: -122.30 },
    { name: nameB, lat: 45.50, lng: -122.70 },
  ]) {
    await evaluate(`(async () => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('enter__Where-latI', Math.trunc(${lat}));
      set('enter__Where-latF', Math.round((Math.abs(${lat}) % 1) * 10000));
      set('enter__Where-lngI', Math.trunc(${lng}));
      set('enter__Where-lngF', Math.round((Math.abs(${lng}) % 1) * 10000));
      await new Promise(r => setTimeout(r, 900));

      const cs = document.getElementById('enter__Callsign-input');
      const csSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      csSet.call(cs, ${JSON.stringify(name)});
      cs.dispatchEvent(new Event('input', { bubbles: true }));
      cs.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 900));

      document.querySelector('.enter__Submit-button')?.click();
      await new Promise(r => setTimeout(r, 1200));
    })()`)
  }

  await navigateInApp('Map', 3500)
  let markers = []
  for (let i = 0; i < 10 && markers.length < 2; i++) {
    await sleep(300)
    markers = await evaluate(`[...document.querySelectorAll('#mapLeaflet-main .rt-ranger-marker svg')].map(svg => svg.innerHTML)`)
  }
  check('markers render for both callsignless rangers', markers.length >= 2, true)
  if (markers.length >= 2) {
    check('the two callsignless rangers get visually distinct markers (hashed on id, not the shared blank callsign)',
      markers[0] !== markers[1], true)
  }
}

async function checkMissionWithPersistedSettings() {
  console.log('\nBUG-3 (open): /mission must not throw for a RETURNING user (dates as ISO strings)')
  // A fresh browser gets initSettings() with real Date objects and never reproduces this.
  // A returning user's settings have round-tripped through JSON, so opPeriodStart/End come
  // back as STRINGS - which is the case the Settings page actually fails on. Seed that shape.
  await goto('/mission')
  await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('appSettings'));
    s.opPeriodStart = new Date('2025-08-24T17:34:40.396Z').toISOString();
    s.opPeriodEnd = new Date('2025-08-25T05:34:40.396Z').toISOString();
    s.settingsDate = new Date('2025-08-24T17:34:40.396Z').toISOString();
    // The reporter's stored settings PREDATE googleGeocodingApiKey, so the key is simply
    // absent. settings-maps-section binds [formField]="form.googleGeocodingApiKey", and
    // Signal Forms cannot build a field for a property the model does not have. Reproduce
    // the real shape by removing it, not just by ageing the dates.
    delete s.googleGeocodingApiKey;
    delete s.schemaVersion;
    localStorage.setItem('appSettings', JSON.stringify(s));
  })()`)

  // Reached by CLICKING through, as the reporter did - the failure needs the live services
  // and the router, not a fresh page load.
  await goto('/')
  await navigateInApp('Rangers')
  await navigateInApp('Mission', 6000)   // the error repeats about once a second; give it room
  const errs = consoleErrors.slice(0, 3)
  check('the Mission page throws nothing for a returning user', errs, [])
  if (errs.length) note(`first error: ${String(errs[0]).slice(0, 160)}`)
}

async function checkStatusColorMigration() {
  console.log('\nMission migration: v0 status colours upgrade to accessible semantic keys')

  // Seed a genuine pre-Sprint-E settings object: no schemaVersion, CSS named colours, and a
  // deliberately customised one that migration must NOT touch.
  await goto('/mission')
  await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('appSettings'));
    delete s.schemaVersion;
    s.radioLogStatuses = [
      { status: 'Normal', color: 'LightYellow', icon: 'a.png' },
      { status: 'Location Report', color: 'Aquamarine', icon: 'b.png' },
      { status: 'Evidence Report', color: 'DarkGoldenrod', icon: 'c.png' },
      { status: 'Need Rest/Food', color: 'Chartreuse', icon: 'd.png' },
      { status: 'Incident Check-in', color: 'Silver', icon: 'e.png' },
      { status: 'Incident Check-out', color: 'DimGray', icon: 'f.png' },
      { status: 'Urgent', color: '#FF00FF', icon: 'g.png' },
    ];
    s.defRadioLogStatus = 3;
    localStorage.setItem('appSettings', JSON.stringify(s));
  })()`)

  await goto('/mission')
  const migrated = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('appSettings'));
    return {
      schemaVersion: s.schemaVersion,
      colors: s.radioLogStatuses.map(x => x.color),
      defaultStatus: s.radioLogStatuses[s.defRadioLogStatus].status,
    };
  })()`)
  // Not pinned to a literal: SETTINGS_SCHEMA_VERSION moves as migration steps are added
  // (it went 1 -> 2 for BUG-3, 2026-08-19), and this check has no way to import the TS
  // constant from a page evaluate() string. The real assertion is just "some migration ran".
  check('a v0 settings object is stamped with a schema version', migrated.schemaVersion >= 1, true)
  check('legacy default colours become semantic keys', migrated.colors.slice(0, 6),
    ['normal', 'location-report', 'evidence-report', 'need-rest-food', 'incident-check-in', 'incident-check-out'])
  check('a user-customised colour survives migration', migrated.colors[6], '#FF00FF')
  // defRadioLogStatus is an index, so a reordering migration would silently repoint it.
  check('defRadioLogStatus still points at the same status', migrated.defaultStatus, 'Need Rest/Food')

  // The whole point of the exercise: the Entry radios must now paint from the token layer.
  await goto('/')
  const painted = await evaluate(`(() => {
    const spans = [...document.querySelectorAll('.Enter__status-value')];
    const styles = spans.map(s => getComputedStyle(s).color);
    return {
      count: spans.length,
      // 'LightYellow' would compute to rgb(255,255,224); a resolved token will not.
      anyLightYellow: styles.includes('rgb(255, 255, 224)'),
      allResolved: styles.every(c => c.indexOf('rgb') === 0),
      inlineAttrs: spans.filter(s => (s.getAttribute('style') || '').includes('text-shadow')).length,
    };
  })()`)
  check('every status radio label renders', painted.count > 0, true)
  check('no radio label is still painted LightYellow (1.07:1 on white)', painted.anyLightYellow, false)
  check('every radio label resolves to a real colour', painted.allResolved, true)
  check('the contrast-rescue text-shadow is gone', painted.inlineAttrs, 0)
}

async function checkEntryPhoto() {
  console.log('\nEntry form: the photo that confirms who a report is about (E-38)')
  for (const [callsign, expectDevicePhoto] of [['E2E-AA1', true], ['E2E-BB2', false]]) {
    await goto('/')
    const r = await evaluate(`(async () => {
      // #enter__Callsign-input is a stable id in the template; formcontrolname="callsign" was
      // REMOVED from this element as part of the BUG-1 fix (2026-08-19, callsignCtrl became
      // the single source of truth) and the old selector's querySelector('input') fallback
      // was silently grabbing the wrong element - first <input> in DOM order, not callsign.
      const input = document.getElementById('enter__Callsign-input');
      if (!input) return { error: 'no callsign input' };
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(input, ${JSON.stringify(callsign)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1600));
      const img = (document.getElementById('enter__Callsign-image')||{}).querySelector
        ? document.getElementById('enter__Callsign-image').querySelector('img') : null;
      const src = img ? (img.getAttribute('src')||'') : '';
      return { present: !!img, isDevicePhoto: src.startsWith('blob:'), isSilhouette: src.includes('androgynous') };
    })()`)
    check(`${callsign}: a photo element renders`, r.present, true)
    if (expectDevicePhoto) check(`${callsign}: uses the device photo`, r.isDevicePhoto, true)
    else check(`${callsign}: falls back to the silhouette, not a broken image`, r.isSilhouette, true)
  }
}

async function checkMissionFormSave() {
  console.log('\nMission form (Sprint D, Signal Forms): edit fields in the UI, Save, reload, values persisted')
  await goto('/mission')
  // 2026-08-26 (Material-M3 pass): all three selectors below changed, and TWO of them were
  // already broken before this suite ever noticed.
  //
  //  - debugMode was `input[placeholder="debugMode"]`. It is a <mat-checkbox> now, which
  //    renders its own nested native input, so the control is reached through a
  //    data-testid on the host. The old line then did `debugMode.checked = ...` on null.
  //  - the Save button was looked up as `.mission__Save-button` - capital S - while the
  //    template has always rendered `mission__save-button`, lowercase. Class selectors are
  //    case-sensitive, so that querySelector returned null on every run this check has ever
  //    made; `hasSaveBtn` was false and the assertion below could not have passed. It never
  //    surfaced because the debugMode line above threw first and aborted the function. Both
  //    now use data-testid, which a purely visual rename cannot silently break.
  //  - the checkbox is toggled with a real .click() on the nested input rather than by
  //    assigning .checked and dispatching a synthetic event: MatCheckbox emits its own
  //    change event from the native input's, and that is the path a real user takes.
  const before = await evaluate(`(() => {
    const mission = document.querySelector('input[placeholder="Mission #"]');
    const debugBox = document.querySelector('[data-testid="debug-mode"] input[type="checkbox"]');
    const setNative = (el, value) => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (mission) setNative(mission, 'E2E-SIGNAL-FORMS');
    const wasChecked = debugBox ? debugBox.checked : null;
    if (debugBox) debugBox.click();
    const saveBtn = document.querySelector('[data-testid="mission-save"]');
    return {
      hasMission: !!mission,
      hasDebugMode: !!debugBox,
      hasSaveBtn: !!saveBtn,
      saveDisabled: saveBtn ? saveBtn.disabled : null,
      debugModeSet: debugBox ? debugBox.checked : null,
      debugModeFlipped: debugBox ? (debugBox.checked !== wasChecked) : false
    };
  })()`)
  check('mission input found', before.hasMission, true)
  check('debugMode checkbox found', before.hasDebugMode, true)
  check('Save button found and not disabled by required-field validation', before.hasSaveBtn && !before.saveDisabled, true)
  // Guards the assertion below from passing vacuously: if the click never actually moved
  // the checkbox, "the saved value matches what we set" is trivially true and proves nothing.
  check('the debugMode checkbox actually toggled', before.debugModeFlipped, true)

  await evaluate(`document.querySelector('[data-testid="mission-save"]').click()`)
  await sleep(3000) // onFormSubmit() writes localStorage synchronously, then window.location.reload()

  const after = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
    return { mission: s.mission, debugMode: s.debugMode };
  })()`)
  check('edited mission value survived Save + reload', after.mission, 'E2E-SIGNAL-FORMS')
  check('edited debugMode value survived Save + reload', after.debugMode, before.debugModeSet)
}

/**
 * F29-23 (2026-08-30): the shared unsavedChangesGuard (src/app/shared/guards/
 * unsaved-changes.guard.ts), wired onto the /mission route. Confirms it actually prompts -
 * dialogs[] already logs every dialog this harness auto-accepts (see the CDP client at the
 * top of this file), so a confirm() firing shows up there even though nothing here has to
 * handle it manually. Also confirms the Cancel button (only rendered while dirty) both
 * clears dirty AND lets navigation through with no prompt at all - the two halves of "Cancel
 * discarding edits" and "the guard only fires when there's something to discard."
 */
async function checkMissionUnsavedChangesGuard() {
  console.log('\nMission: the unsaved-changes guard prompts before leaving a dirty form (F29-23)')
  await goto('/mission')

  const cancelBeforeEdit = await evaluate(`!!document.querySelector('[data-testid="mission-save"].mission__save-button--dirty')`)
  check('Save is not marked dirty before any edit', cancelBeforeEdit, false)

  await evaluate(`(() => {
    const mission = document.querySelector('input[placeholder="Mission #"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(mission, 'E2E-GUARD-TEST');
    mission.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  check('Save is marked dirty after an edit', await evaluate(`document.querySelector('[data-testid="mission-save"]').classList.contains('mission__save-button--dirty')`), true)
  check('Cancel appears once the form is dirty', await evaluate(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel')`), true)

  // navigateInApp (a real routerLink click), not goto() - CanDeactivate only ever runs for
  // in-app Router navigation. goto()'s Page.navigate is a hard reload that bypasses the
  // Router entirely, same gap navigateInApp's own doc comment already names ("Users don't do
  // that - they click the nav... production bugs reproduce ONLY this way").
  const dialogsBefore = dialogs.length
  await navigateInApp('Rangers')
  check('leaving a dirty Mission form triggers a confirm dialog', dialogs.length > dialogsBefore, true)
  check('...and (auto-accepted) navigation actually proceeded', await evaluate(`location.pathname`), '/rangers')

  // Cancel: dirty -> clean, and the guard lets a clean form go with no prompt.
  await goto('/mission')
  await evaluate(`(() => {
    const mission = document.querySelector('input[placeholder="Mission #"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(mission, 'E2E-GUARD-TEST-2');
    mission.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await sleep(200)
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel')?.click()`)
  await sleep(200)
  check('Cancel clears the dirty state', await evaluate(`document.querySelector('[data-testid="mission-save"]').classList.contains('mission__save-button--dirty')`), false)

  const dialogsBeforeClean = dialogs.length
  await navigateInApp('Rangers')
  check('leaving a CLEAN Mission form triggers no dialog', dialogs.length, dialogsBeforeClean)
}

async function checkMissionRoundTrip(downloads) {
  console.log('\nMission backup -> wipe all storage -> restore: the disaster path')
  await goto('/mission')
  await evaluate(`(() => { const s = JSON.parse(localStorage.getItem('appSettings')); s.mission = 'E2E-MISSION'; localStorage.setItem('appSettings', JSON.stringify(s)); })()`)
  await goto('/mission')
  // "Export mission" was renamed "Back up mission" (E-109 Setup files / Style A terminology
  // pass, 2026-08-31) - matched by regex here, same as every other button-text lookup in this
  // file, so a future label tweak doesn't silently break this selector again.
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Back up mission/i.test(b.textContent))?.click()`)

  // Poll rather than sleep a fixed 3s: the download is disk+Chrome timing, and a flat wait
  // made this check fail intermittently on an otherwise-green run. Waiting for the condition
  // is both faster in the normal case and stable in the slow one. (.crdownload is Chrome's
  // in-progress marker, so only settled files count.)
  let files = []
  for (let i = 0; i < 40 && files.length === 0; i++) {
    await sleep(250)
    files = fs.readdirSync(downloads).filter(f => f.endsWith('.json') && !f.endsWith('.crdownload'))
  }
  if (!check('Back up mission produced a file', files.length > 0, true)) return
  const missionFile = path.join(downloads, files[0])

  await goto('/mission')
  await evaluate(`localStorage.clear()`)
  await idbClearAll()
  await goto('/mission')
  await setFileInput('#importMissionFile', missionFile)
  await sleep(2000)

  // Poll rather than a flat sleep+single-read - RecordStore's write to IndexedDB is
  // asynchronous (microtask-coalesced), unlike the synchronous localStorage.setItem() this
  // check could previously assume had already landed. See pollUntil()'s own doc comment.
  const rosterAfterImportRaw = await pollUntil(
    () => idbGetRaw('rangers'),
    raw => (JSON.parse(raw||'{"rangers":[]}').rangers||[]).length > 0)
  const restored = await evaluate(`(() => {
    const s = JSON.parse(localStorage.getItem('appSettings')||'{}');
    return { mission: s.mission };
  })()`)
  restored.rangers = (JSON.parse(rosterAfterImportRaw||'{"rangers":[]}').rangers||[]).length
  check('mission import restores the roster after a wipe', restored.rangers > 0, true)
  check('mission import restores the mission name', restored.mission, 'E2E-MISSION')
}

/**
 * E-114 Phase 1 (2026-08-31): the Report Packet round trip, DoD's own stated property -
 * "importing the same packet twice changes nothing." A single browser session covers this
 * without simulating a second device: build a packet of this device's own current log
 * (Radio Log's "Build Report Packet"), then import that SAME downloaded file back into this
 * SAME device TWICE. The FIRST import is expected to genuinely add the entry - a device's
 * own original entries carry no `sourceUid` (that field is only ever stamped on an entry that
 * arrives BY merge - see `RadioLogEntryType`'s own doc comment), so re-importing your own
 * freshly-built packet the first time is indistinguishable, on this device, from a second
 * device's packet arriving for the first time. It is the SECOND import of the identical file
 * that exercises the real idempotency guarantee - the newly-merged copy now carries a
 * `sourceUid`, so `mergeIncomingEntries()` recognizes and skips it.
 */
async function checkReportPacketRoundTrip(downloads) {
  console.log('\nReport Packet (E-114 Phase 1): build -> re-import twice, second import is a no-op')
  await goto('/')
  await idbRemoveRaw('radioLog')
  await goto('/')

  await evaluate(`(async () => {
    const ta = document.querySelector('textarea[placeholder="Enter Any Notes"]');
    if (ta) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, 'E2E-PACKET');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('.enter__Submit-button').click();
    await new Promise(r => setTimeout(r, 1200));
  })()`)

  await navigateInApp('Radio Log', 3500)
  await evaluate(`[...document.querySelectorAll('button')].find(b => /Build Report Packet/i.test(b.textContent))?.click()`)

  // Same polling reasoning as checkMissionRoundTrip above - download timing, not app timing.
  let files = []
  for (let i = 0; i < 40 && files.length === 0; i++) {
    await sleep(250)
    files = fs.readdirSync(downloads).filter(f => /report-packet/.test(f) && f.endsWith('.txt') && !f.endsWith('.crdownload'))
  }
  if (!check('Build Report Packet produced a file', files.length > 0, true)) return
  const packetFile = path.join(downloads, files[0])

  // Only one <input type="file"> exists on this route (the roster/mission import inputs are
  // elsewhere) - see radio-log.component.html's own Report Packet action bar.
  await setFileInput('input[type="file"]', packetFile)
  await sleep(1500)
  const afterFirstImport = (JSON.parse((await idbGetRaw('radioLog'))||'{}').logEntries||[]).length
  check('the packet\'s entry is merged in on the first import', afterFirstImport, 2)

  await setFileInput('input[type="file"]', packetFile)
  await sleep(1500)
  const afterSecondImport = (JSON.parse((await idbGetRaw('radioLog'))||'{}').logEntries||[]).length
  check('importing the exact same packet a second time changes nothing', afterSecondImport, afterFirstImport)
}

/**
 * F29-11 (2026-08-30): the sample mission's roster/report content was substantially rewritten
 * (an ICS role spread, walking-distance park clusters, real ICS-213 messages) - this check
 * verifies the new counts land correctly, not just that the button still exists. Also a real
 * regression net for F29-18's danger-zone collapse (Batch 3): "Load sample mission" sits
 * inside Mission Advanced Options' now-collapsed ExpandableSectionComponent, so this is the
 * first check to click that section open before reaching a button inside it - confirms the
 * pattern other danger-zone buttons (Rangers' "Delete all rangers") rely on in --read-only
 * mode, which this suite's read-only runs never actually exercise.
 */
async function checkSampleMissionLoads() {
  console.log('\nMission: Load sample mission seeds the ICS-structured roster/reports/messages (F29-11)')
  await goto('/mission')
  await evaluate(`localStorage.clear()`)
  await idbClearAll()
  await goto('/mission')

  // Open the collapsed danger-zone section before reaching the button inside it.
  await evaluate(`(() => {
    const header = [...document.querySelectorAll('.mat-expansion-panel-header')]
      .find(h => h.textContent.includes('Danger zone'));
    header?.click();
  })()`)
  await sleep(400)

  await evaluate(`(() => {
    [...document.querySelectorAll('button')].find(b => /Load sample mission/i.test(b.textContent))?.click();
  })()`)
  await sleep(1500) // confirm()/alert() auto-accepted, then onBtnLoadSampleData()'s own reload

  // Poll (see pollUntil()'s own doc comment) rather than a single read after a flat sleep -
  // the reload this button triggers races against RecordStore's own async IndexedDB commit.
  const seeded = await pollUntil(
    async () => {
      const rangers = (JSON.parse((await idbGetRaw('rangers'))||'{"rangers":[]}').rangers||[]);
      const reports = (JSON.parse((await idbGetRaw('radioLog'))||'{"logEntries":[]}').logEntries||[]);
      return {
        rangerCount: rangers.length,
        reportCount: reports.length,
        roles: rangers.map(r => r.role),
        messages: reports.filter(r => r.generates213).length,
        operatorsSet: reports.every(r => !!r.operator),
      };
    },
    v => v.rangerCount >= 12 && v.reportCount > 20)
  check('sample mission seeds 12 rangers', seeded.rangerCount, 12)
  check('...including an Incident Commander', seeded.roles.includes('Incident Commander'), true)
  check('...and at least one Section Chief', seeded.roles.some(r => (r || '').includes('Section Chief')), true)
  check('sample mission seeds field reports', seeded.reportCount > 20, true)
  check('sample mission includes 2 ICS-213 messages', seeded.messages, 2)
  check('every sample report has an operator stamped', seeded.operatorsSet, true)

  await goto('/messages')
  await sleep(800)
  const messageRows = await evaluate(`document.querySelectorAll('.messages__list-item').length`)
  check('the Messages page renders both sample messages', messageRows, 2)
}

// ── runner ───────────────────────────────────────────────────────────────────

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const candidates = process.platform === 'win32'
    ? [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  const hit = candidates.find(p => p && fs.existsSync(p))
  if (!hit) throw new Error('Chrome not found. Set CHROME_BIN.')
  return hit
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangertrak-e2e-'))
  const profile = path.join(tmp, 'profile')
  const downloads = path.join(tmp, 'downloads')
  fs.mkdirSync(downloads, { recursive: true })

  console.log(`RangerTrak e2e`)
  console.log(`  target : ${BASE}`)
  console.log(`  mode   : ${READ_ONLY ? 'read-only' : 'read-write (will clear this profile\'s storage)'}`)

  const chrome = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000', 'about:blank',
  ], { stdio: 'ignore' })

  const cleanup = () => {
    if (!KEEP_OPEN) { try { chrome.kill() } catch { } }
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { }
  }

  try {
    // Wait for the debugger, rather than sleeping a guessed amount.
    let target
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250)
      try {
        const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json()
        target = list.find(t => t.type === 'page')
      } catch { }
    }
    if (!target) throw new Error('Chrome did not expose a debugging target')

    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    ws.onmessage = async ev => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
        return
      }
      if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text)
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
      } else if (m.method === 'Page.javascriptDialogOpening') {
        dialogs.push(m.params.message.split('\n')[0].slice(0, 100))
        await send('Page.handleJavaScriptDialog', { accept: true })
      }
    }

    await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable')
    if (REAL_GEOCODING) {
      note('--real-geocoding: hitting the real Nominatim service, not the mock')
    } else {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK_NOMINATIM_SCRIPT })
    }
    await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })

    await checkRoutesRender()
    await checkNavbarLayout()
    if (FULL) {
      await checkMapEngineSwitch()
      await checkMapEngineSurvivesNavigation()
    } else {
      note('fast run: skipping checkMapEngineSwitch, checkMapEngineSurvivesNavigation (pass --full to include)')
    }
    // Read-only: pure DOM/layout reads and in-memory form edits, nothing persisted - so these
    // are safe against production too, which is where phone-width regressions actually bite.
    await checkEntryTabOrder()
    await checkMiniMapFillsItsBox()
    await checkEntryPhoneWidth()
    await checkAllRoutesPhoneWidth()
    await checkBackToTop()
    await checkWelcomePanelDismissAndReopen()
    await checkLocationDdDdmDmsSync()
    await checkFieldReportsPhoneLayout()
    await checkGridThemeUsesTokens()
    await checkHelpTabs()

    if (READ_ONLY) {
      note('read-only: skipping roster, photo, submit and mission checks')
    } else {
      const fx = makeFixtures(path.join(tmp, 'fixtures'))
      if (FULL) {
        await checkRosterLifecycle(fx)
        await checkFieldNameAliases(fx)
        await checkSetupFileMerge(fx)
      } else {
        note('fast run: skipping checkRosterLifecycle, checkFieldNameAliases, checkSetupFileMerge (pass --full to include)')
      }
      await checkEntryPhoto()
      await checkEntryAutofocusAndReset() // submits a real report, so read-write only
      if (FULL) {
        await checkEvidenceLocation()
        await checkMessagesPage()
      } else {
        note('fast run: skipping checkEvidenceLocation, checkMessagesPage (pass --full to include)')
      }
      await checkDerivedValuesDoNotCarryOver() // also submits, same reason
      await checkMissionFormSave()
      await checkMissionUnsavedChangesGuard()
      await checkStatusColorMigration()
      await checkStatusColorsBothSchemes()

      // Known-open production bugs - see the banner above these three.
      if (FULL) {
        await checkCallsignIsSaved()
      } else {
        note('fast run: skipping checkCallsignIsSaved (pass --full to include)')
      }
      await checkReportsSurviveNavigation()
      if (FULL) {
        await checkTeamTrailsRender()
        await checkRangerMarkersAreDistinct()
        await checkNoCallsignRangersGetDistinctIdentity()
      } else {
        note('fast run: skipping checkTeamTrailsRender, checkRangerMarkersAreDistinct, checkNoCallsignRangersGetDistinctIdentity (pass --full to include)')
      }
      await checkMissionWithPersistedSettings()
      if (FULL) {
        await checkMissionRoundTrip(downloads)
        await checkReportPacketRoundTrip(downloads)
        await checkSampleMissionLoads()
      } else {
        note('fast run: skipping checkMissionRoundTrip, checkReportPacketRoundTrip, checkSampleMissionLoads (pass --full to include)')
      }
      await goto('/'); await evaluate(`localStorage.clear()`); await idbClearAll()
    }
  } catch (e) {
    // Without this, a throw inside any check (a bad selector, a malformed evaluate()) was
    // silently swallowed: the finally below calls process.exit() before main()'s own .catch()
    // can run, so the suite reported PASS while quietly skipping every remaining check. Found
    // exactly that way - a broken regex ate checkStatusColorMigration and checkMissionRoundTrip
    // and the run still exited 0.
    check(`harness completed without throwing (${e && e.message ? e.message : e})`, false, true)
  } finally {
    const failed = results.filter(r => !r.pass && !r.known)
    const knownOpen = results.filter(r => !r.pass && r.known)
    const fixed = results.filter(r => r.pass && r.known)
    console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`)
    if (knownOpen.length) {
      console.log(`\nKNOWN-OPEN (${knownOpen.length}) - already reported, not yet fixed; does not fail the run:`)
      knownOpen.forEach(f => console.log(`  - ${f.label}`))
    }
    if (fixed.length) {
      console.log(`\nNOW FIXED (${fixed.length}) - delete these from KNOWN_OPEN:`)
      fixed.forEach(f => console.log(`  - ${f.label}`))
    }
    if (failed.length) {
      console.log('\nFAILURES:')
      failed.forEach(f => console.log(`  - ${f.label}: expected ${JSON.stringify(f.expected)}, got ${JSON.stringify(f.actual)}`))
    }
    try { ws && ws.close() } catch { }
    cleanup()
    process.exit(failed.length ? 1 : 0)
  }
}

main().catch(e => { console.error(`\nHARNESS ERROR: ${e.message}`); process.exit(2) })
