#!/usr/bin/env node
/**
 * E-126: makes the fixture backups that prove "a backup made in an earlier release still
 * restores in this one" - the 1.0.0-rc.1 gate is that a backup made in the alpha restores in
 * the rc. Run it ON THE DAY A RELEASE IS TAGGED, against that release's build:
 *
 *   npm run build && npm run backup-fixture -- 0.99.0-alpha
 *
 * then commit the new tools/backup-fixtures/<version>/ folder. tools/e2e.js
 * (checkBackupFixturesRestore, in --full) restores every folder there into the current build.
 *
 * WHAT IT DOES, through the real UI of a served build (its own server on :8092 and its own
 * throwaway Chrome profile - never yours):
 *   1. Loads the Grand Canyon demo (Mission > Danger zone > Load sample mission). FAKE DATA
 *      ONLY: the roster holds PII in real use, and these files are committed to a public repo.
 *   2. Names the mission FIXTURE-<version> and saves.
 *   3. Takes a plain backup and an encrypted one (fixed passphrase below - fake data, so it is
 *      fine in the repo), exactly as a scribe would with "Back up mission".
 *   4. Writes expect.json from the plain backup the app actually produced: the counts and one
 *      named sample of each part that a restore must bring back.
 *
 * Refuses to write anything if the backup carries a geocoding API key.
 * Kills only the server and Chrome it started itself. Exits non-zero on failure.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const version = process.argv[2]
if (!version || !/^[0-9A-Za-z.+-]+$/.test(version)) {
  console.error('Usage: npm run backup-fixture -- <version>   (e.g. 0.99.0-alpha)')
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
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
  const close = async () => {
    try { await Promise.race([send('Browser.close'), sleep(3000)]) } catch { }
    try { ws.close() } catch { }
    try { chrome.kill() } catch { }
  }
  return { send, evaluate, close, queue: (...answers) => dialogQueue.push(...answers) }
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

    // 1. The Grand Canyon demo (the picker's default). Confirm, then the "loaded" alert.
    await goto(b, '/mission')
    b.queue(true, true)
    if (!await clickButton(b, '/Load sample mission/i')) throw new Error('no "Load sample mission" button')
    await sleep(6000)

    // 2. Name the mission and save (Save reloads the page).
    await goto(b, '/mission')
    const named = await b.evaluate(`(() => {
      const el = document.querySelector('input[placeholder="Mission #"]')
      if (!el) return false
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify('FIXTURE-' + version)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      document.querySelector('[data-testid="mission-save"]').click()
      return true
    })()`)
    if (!named) throw new Error('no Mission # field')
    await sleep(4000)

    fs.mkdirSync(OUT, { recursive: true })

    // 3a. Plain backup: confirm, then a blank passphrase.
    await goto(b, '/mission')
    b.queue(true, '')
    if (!await clickButton(b, '/Back up mission/i')) throw new Error('no "Back up mission" button')
    const plainPath = await waitForDownload(downloads)
    const plain = JSON.parse(fs.readFileSync(plainPath, 'utf8'))
    moveFile(plainPath, path.join(OUT, 'backup.json'))

    // 3b. Encrypted backup: confirm, passphrase, passphrase again.
    b.queue(true, PASSPHRASE, PASSPHRASE)
    if (!await clickButton(b, '/Back up mission/i')) throw new Error('no "Back up mission" button')
    const encPath = await waitForDownload(downloads)
    moveFile(encPath, path.join(OUT, 'backup-encrypted.json'))

    // 4. What a restore must bring back, read from what the app actually wrote.
    if (plain.settings?.googleGeocodingApiKey) throw new Error('the backup carries a geocoding API key - refusing to write a public fixture')
    if (plain.settings?.mission !== 'FIXTURE-' + version) throw new Error(`mission name did not save (got "${plain.settings?.mission}")`)
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
