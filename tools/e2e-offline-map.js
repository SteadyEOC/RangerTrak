#!/usr/bin/env node
/**
 * Does the Alternative (MapLibre) map actually work OFFLINE? A real test, not an emulated one.
 *
 * WHY THIS IS SEPARATE FROM tools/e2e.js
 * --------------------------------------
 * "Offline" has to mean the server is really gone. Chrome's offline emulation applies to the
 * page, but requests the service worker passes through to the network may not be covered, so
 * an emulated test can pass for the wrong reason. This script therefore starts its OWN copy
 * of tools/serve-dist.js (on its own port, so it never collides with `npm run server`), warms
 * the device the way the Field Guide says, stops that server, restarts Chrome on the same
 * profile and opens the map again - what a scribe does in the field.
 *
 * Found the bug it guards against on 2026-09-25: the map was blank offline while the
 * readiness row said it was warmed (see src/app/shared/mapping/cache-first-source.ts).
 *
 * THE MEASUREMENT
 * ---------------
 * Pixels, not network requests: once the fix works there are NO map-file requests offline at
 * all, so "no failed requests" would pass for a map that never tried to draw. Instead the map
 * area is screenshotted and the share of pixels that are NOT the style's grey background
 * (#e0e0e0) is counted. Online is checked first with the same measure, so a broken
 * measurement (a map that never draws even online) fails loudly rather than passing.
 * Red against 0.96.0 (offline share ~0), green with CacheFirstSource.
 *
 * USAGE
 *   npm run build && npm run e2e:offline
 *   --keep-artifacts   keep the two screenshots (printed paths) instead of deleting them
 *
 * Kills only the server and Chrome it started itself. Exits non-zero on failure.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const APP_PORT = 8091
const DEBUG_PORT = 9456
const BASE = `http://localhost:${APP_PORT}`
const PMTILES_URL = '/assets/maps/world-vashon.pmtiles' // src/app/shared/mapping/pmtiles-config.ts
const MIN_DRAWN_SHARE = 0.5
const KEEP = process.argv.includes('--keep-artifacts')
const sleep = ms => new Promise(r => setTimeout(r, ms))

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

let server
function startServer() {
  server = spawn(process.execPath, [path.join(__dirname, 'serve-dist.js')], {
    env: { ...process.env, PORT: String(APP_PORT) }, stdio: 'ignore',
  })
}
async function serverStatus() {
  try { return (await fetch(BASE + '/')).status } catch { return 'down' }
}

async function openChrome(profile) {
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
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data)
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
  const close = () => { try { ws.close() } catch { } try { chrome.kill() } catch { } }
  return { send, evaluate, close }
}

async function openAlternativeMap(b) {
  await b.send('Page.navigate', { url: BASE + '/map' })
  await sleep(4000)
  await b.evaluate(`document.querySelector('[data-testid="mapEngineSwitch"] button')?.click()`)
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (await b.evaluate(`!!document.querySelector('.map-container canvas')`)) break
  }
  await sleep(6000) // let tiles load and paint
}

/** Share of the map area's pixels that are not the style's grey background. */
async function drawnShare(b, shotPath) {
  const rect = await b.evaluate(`(() => {
    // The canvas only: .map-container also holds the coordinate readout and page background
    // below the map, which scored an all-grey map as 23% drawn.
    const r = document.querySelector('.map-container .maplibregl-canvas').getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })()`)
  const { data } = await b.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } })
  fs.writeFileSync(shotPath, Buffer.from(data, 'base64'))
  // Decode in the page - Chrome already has a PNG decoder, this script has no dependencies.
  return b.evaluate(`(async () => {
    const img = new Image()
    img.src = 'data:image/png;base64,${data}'
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, c.width, c.height).data
    let drawn = 0
    for (let i = 0; i < px.length; i += 4) {
      const grey = Math.abs(px[i] - 0xe0) < 8 && Math.abs(px[i + 1] - 0xe0) < 8 && Math.abs(px[i + 2] - 0xe0) < 8
      if (!grey) drawn++
    }
    return drawn / (px.length / 4)
  })()`)
}

;(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rangertrak-offline-'))
  const profile = path.join(tmp, 'profile')
  const shots = { online: path.join(tmp, 'online.png'), offline: path.join(tmp, 'offline.png') }
  let b
  let failed = false
  const check = (label, ok, detail) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
    if (!ok) failed = true
  }

  console.log('RangerTrak offline map check')
  try {
    if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'rangertrak', 'browser', 'index.html'))) {
      throw new Error('No build found - run `npm run build` first.')
    }

    // ── Online: prepare the device ──
    startServer()
    for (let i = 0; i < 30 && (await serverStatus()) !== 200; i++) await sleep(500)
    b = await openChrome(profile)
    await b.send('Page.navigate', { url: BASE + '/' })
    let swActive = false // ngsw registers when stable, or after 30 s
    for (let i = 0; i < 25 && !swActive; i++) {
      await sleep(2000)
      swActive = await b.evaluate(`navigator.serviceWorker.getRegistration().then(r => !!(r && r.active))`)
    }
    check('service worker installed', swActive)

    await openAlternativeMap(b)
    let warmed = false
    for (let i = 0; i < 30 && !warmed; i++) {
      warmed = await b.evaluate(`caches.match('${PMTILES_URL}').then(r => !!r)`)
      if (!warmed) await sleep(2000)
    }
    check('map file warmed into Cache Storage', warmed)
    const online = await drawnShare(b, shots.online)
    check('Alternative map draws ONLINE (proves the measurement)', online >= MIN_DRAWN_SHARE, `${(online * 100).toFixed(0)}% drawn`)

    // ── Offline: server gone, browser restarted on the same profile ──
    b.close(); b = undefined
    await sleep(1500)
    server.kill(); server = undefined
    await sleep(1000)
    check('server is really down', (await serverStatus()) === 'down')

    b = await openChrome(profile)
    await openAlternativeMap(b)
    const offline = await drawnShare(b, shots.offline)
    check('Alternative map draws OFFLINE', offline >= MIN_DRAWN_SHARE, `${(offline * 100).toFixed(0)}% drawn`)
  } catch (e) {
    check(`completed without throwing (${e.message})`, false)
  } finally {
    if (b) b.close()
    if (server) try { server.kill() } catch { }
    await sleep(1000)
    if (KEEP) {
      console.log(`  screenshots kept: ${shots.online} , ${shots.offline}`)
      try { fs.rmSync(profile, { recursive: true, force: true }) } catch { }
    } else {
      try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { }
    }
  }
  console.log(failed ? '\nOFFLINE MAP CHECK FAILED' : '\nOffline map check passed')
  process.exit(failed ? 1 : 0)
})()
