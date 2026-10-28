#!/usr/bin/env node
/**
 * E-126: makes the fixture backups that prove "a backup made in an earlier release still
 * restores in this one" - the 1.0.0-rc.1 gate is that a backup made in the alpha restores in
 * the rc. Run it ON THE DAY A RELEASE IS TAGGED, against that release's build:
 *
 *   npm run build && npm run backup-fixture -- 1.0.0-beta.N
 *
 * then commit the new tools/backup-fixtures/<version>/ folder. tools/e2e.js
 * (checkBackupFixturesRestore, in --full) restores every folder there into the current build.
 *
 * WHAT IT DOES, through the real UI of a served build (its own server on :8092 and its own
 * throwaway Chrome profile - never yours):
 *   1. Loads the Grand Canyon demo (Mission > Danger zone > Load sample mission). FAKE DATA
 *      ONLY: the roster holds PII in real use, and these files are committed to a public repo.
 *   2. Names the mission FIXTURE-<version> and saves.
 *   2b. E-194 (D-53, ADR D-60): saves one radio log entry with ONE tiny attachment (a 1x1 PNG,
 *      fake) through Entry's Attach button, so the fixture carries a reference and its bytes.
 *   3. Takes a plain backup and an encrypted one (fixed passphrase below - fake data, so it is
 *      fine in the repo), exactly as a scribe would with "Back up mission".
 *   4. Writes expect.json from the plain backup the app actually produced: the counts and one
 *      named sample of each part that a restore must bring back.
 *
 * E-194: each backup also writes its attachments companion zip, kept beside the JSON as
 * backup-attachments.zip and backup-encrypted-attachments.rtenc.zip.
 * Refuses to write anything if the backup carries a geocoding API key.
 * Kills only the server and Chrome it started itself. Exits non-zero on failure.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const version = process.argv[2]
if (!version || !/^[0-9A-Za-z.+-]+$/.test(version)) {
  console.error('Usage: npm run backup-fixture -- <version>   (e.g. 1.0.0-beta.1, the release just cut)')
  process.exit(2)
}

const APP_PORT = 8092
const DEBUG_PORT = 9457
const BASE = `http://localhost:${APP_PORT}`
const PASSPHRASE = 'fixture-passphrase-fake-data'
const OUT = path.join(__dirname, 'backup-fixtures', version)
const sleep = ms => new Promise(r => setTimeout(r, ms))
// Copy then delete, not rename: the temp downloads folder and the repo can be on different
// drives (EXDEV).
const moveFile = (from, to) => { fs.copyFileSync(from, to); fs.unlinkSync(from) }

function findChrome() { // same search as tools/e2e.js
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

async function openChrome(profile, downloads) {
  const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' })
  let target
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250)
    try { target = (await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json()).find(t => t.type === 'page') } catch { }
  }
  if (!target) throw new Error('Chrome did not expose a debugging target')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let nextId = 1
  const pending = new Map()
  // One queued answer per dialog, in the order they open: a string answers a prompt(),
  // anything else accepts a confirm()/alert(). Empty queue: accept.
  const dialogQueue = []
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
    if (m.method === 'Page.javascriptDialogOpening') {
      const next = dialogQueue.shift()
      if (process.env.FIXTURE_DEBUG) console.error('DIALOG', m.params.type, JSON.stringify(m.params.message.slice(0, 60)), '->', JSON.stringify(next))
      const params = typeof next === 'string' ? { accept: true, promptText: next } : { accept: true }
      ws.send(JSON.stringify({ id: nextId++, method: 'Page.handleJavaScriptDialog', params }))
    }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id)
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)
    }
  }
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result.value
  }
  await send('Page.enable'); await send('Runtime.enable')
  // E-207 / D-62: a clean profile is a new install, which opens in Simple view and hides Attach.
  // The fixture needs the full app; the view is per device and never in the backup, so this
  // changes nothing the fixture records.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('rt-view')) {
    localStorage.setItem('rt-view', 'full'); localStorage.setItem('rt-view-source', 'user') } } catch { }` })
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  const close = async () => {
    try { await Promise.race([send('Browser.close'), sleep(3000)]) } catch { }
    try { ws.close() } catch { }
    try { chrome.kill() } catch { }
  }
  return { send, evaluate, close, queue: (...answers) => dialogQueue.push(...answers), resetQueue: () => { dialogQueue.length = 0 } }
}

async function goto(b, route, settleMs = 4000) {
  await b.send('Page.navigate', { url: BASE + route })
  await sleep(settleMs)
}

const clickButton = (b, pattern) => b.evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find(x => ${pattern}.test(x.textContent))
  if (btn) btn.click()
  return !!btn
})()`)

/** Waits for a settled file in `dir` whose name matches `pattern` (and is not still downloading); returns its path. */
async function waitForFile(dir, pattern) {
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const files = fs.readdirSync(dir).filter(f => pattern.test(f) && !f.endsWith('.crdownload'))
    if (files.length === 1) return path.join(dir, files[0])
  }
  throw new Error(`no download matching ${pattern} arrived`)
}

// A real 1x1 PNG. Fake data, like everything in a fixture.
const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/** Waits for exactly one settled .json in `dir` and returns its path. */
async function waitForDownload(dir) {
  for (let i = 0; i < 60; i++) {
    await sleep(250)
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    if (files.length === 1) return path.join(dir, files[0])
  }
  throw new Error('the backup download never arrived')
}

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangertrak-fixture-'))
  const downloads = path.join(tmp, 'downloads')
  fs.mkdirSync(downloads)
  let server, b
  let code = 0
  try {
    if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'rangertrak', 'browser', 'index.html'))) {
      throw new Error('No build found - run `npm run build` first.')
    }
    if (fs.existsSync(OUT)) throw new Error(`${OUT} already exists - a release's fixture is never overwritten.`)

    server = spawn(process.execPath, [path.join(__dirname, 'serve-dist.js')], {
      env: { ...process.env, PORT: String(APP_PORT) }, stdio: 'ignore',
    })
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(BASE + '/')).status === 200) break } catch { }
      await sleep(500)
    }
    b = await openChrome(path.join(tmp, 'profile'), downloads)
    await goto(b, '/')

    // 1. The Grand Canyon demo (the picker's default). Nothing queued: since E-168 (0.99.17) an
    //    empty device loads a demo without a confirm, and an empty queue accepts whatever does open.
    //    2026-10-02, John: the old `queue(true, true)` left two stale answers that shifted every
    //    later dialog, so the 0.99.17 "encrypted" fixture was written in plaintext.
    await goto(b, '/mission')
    if (!await clickButton(b, '/Load sample mission/i')) throw new Error('no "Load sample mission" button')
    await sleep(6000)

    // 2. Name the mission. There is no Save button (E-145, 2026-09-30): the page autosaves about
    //    800 ms after the last change, without reloading.
    await goto(b, '/mission')
    const named = await b.evaluate(`(() => {
      const el = document.querySelector('input[placeholder="e.g. 26-0142"]')
      if (!el) return false
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify('FIXTURE-' + version)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!named) throw new Error('no Mission # field')
    await sleep(2500) // past the autosave delay

    // 2b. One entry with one attachment, through the real Attach button (E-194). The file's bytes are
    //     hashed and stored when the entry is saved; give that a moment.
    const pngPath = path.join(tmp, 'fixture-clue.png')
    fs.writeFileSync(pngPath, FIXTURE_PNG)
    await goto(b, '/')
    const typed = await b.evaluate(`(() => {
      const input = document.getElementById('enter__Callsign-input')
      if (!input) return false
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'FIXTURE-ATT')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!typed) throw new Error('no callsign field on Entry')
    await sleep(600)
    await b.send('DOM.enable')
    const doc = await b.send('DOM.getDocument', { depth: -1 })
    const picker = await b.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-testid="entry-attach-file"]' })
    if (!picker.nodeId) throw new Error('no Attach file input on Entry')
    await b.send('DOM.setFileInputFiles', { files: [pngPath], nodeId: picker.nodeId })
    await sleep(1200)
    if (!await clickButton(b, '/Add to radio log/i')) throw new Error('no "Add to radio log" button')
    await sleep(3000)

    fs.mkdirSync(OUT, { recursive: true })

    // 3a. Plain backup: confirm, then a blank passphrase.
    await goto(b, '/mission')
    b.resetQueue()
    b.queue(true, '')
    if (!await clickButton(b, '/Back up mission/i')) throw new Error('no "Back up mission" button')
    const plainPath = await waitForDownload(downloads)
    const plain = JSON.parse(fs.readFileSync(plainPath, 'utf8'))
    moveFile(plainPath, path.join(OUT, 'backup.json'))
    moveFile(await waitForFile(downloads, /-attachments\.zip$/), path.join(OUT, 'backup-attachments.zip'))

    // 3b. Encrypted backup: confirm, passphrase, passphrase again.
    b.resetQueue()
    b.queue(true, PASSPHRASE, PASSPHRASE)
    if (!await clickButton(b, '/Back up mission/i')) throw new Error('no "Back up mission" button')
    const encPath = await waitForDownload(downloads)
    // Never write a fake "encrypted" fixture: a plaintext one restores without its passphrase prompt
    // and throws every later check's dialog answers out of step.
    if (!JSON.parse(fs.readFileSync(encPath, 'utf8')).ciphertext) throw new Error('the "encrypted" backup came out unencrypted - dialog answers out of step?')
    moveFile(encPath, path.join(OUT, 'backup-encrypted.json'))
    moveFile(await waitForFile(downloads, /-attachments\.rtenc\.zip$/), path.join(OUT, 'backup-encrypted-attachments.rtenc.zip'))

    // 4. What a restore must bring back, read from what the app actually wrote.
    if (plain.settings?.googleGeocodingApiKey) throw new Error('the backup carries a geocoding API key - refusing to write a public fixture')
    if (plain.settings?.mission !== 'FIXTURE-' + version) throw new Error(`mission name did not save (got "${plain.settings?.mission}")`)
    const attached = plain.radioLog.logEntries.find(e => e.attachments?.length)?.attachments?.[0]
    if (!attached) throw new Error('the backup carries no attachment reference - did the Attach step run?')
    const expect = {
      version,
      madeAt: plain.exportedAt,
      appVersion: plain.appVersion,
      passphrase: PASSPHRASE,
      mission: plain.settings.mission,
      rangers: plain.rangers.length,
      sampleRangerCallsign: plain.rangers[0]?.callsign,
      radioLogEntries: plain.radioLog.logEntries.length,
      sampleEntry: { callsign: plain.radioLog.logEntries[0]?.callsign, status: plain.radioLog.logEntries[0]?.status },
      locations: (plain.locations ?? []).length,
      sampleLocationName: plain.locations?.[0]?.name,
      // E-194: the reference the JSON carries, and the fingerprint the companion zip must bring back.
      attachments: 1,
      attachmentSha256: attached.sha256,
      attachmentName: attached.name,
    }
    if (!expect.rangers || !expect.radioLogEntries || !expect.locations) {
      throw new Error(`the demo did not load fully: ${JSON.stringify(expect)}`)
    }
    fs.writeFileSync(path.join(OUT, 'expect.json'), JSON.stringify(expect, null, 2) + '\n')
    console.log(`Wrote ${OUT}:\n${JSON.stringify(expect, null, 2)}`)
  } catch (e) {
    console.error(`FAILED: ${e.message}`)
    if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true })
    code = 1
  } finally {
    if (b) await b.close()
    if (server) try { server.kill() } catch { }
    await sleep(1000)
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { }
  }
  process.exit(code)
})()
