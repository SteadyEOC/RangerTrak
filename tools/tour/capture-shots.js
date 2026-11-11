#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * 2026-11-11, E-244: small pictures of the controls the Tour Guide's steps name, for tools/tour/img/.
 * build-from-doc.py puts each one beside its step (it reads img/shots.json).
 *
 *   node tools/serve-dist.js                      (serves dist on :8080; an old build gives old pictures)
 *   node tools/tour/capture-shots.js [--base=http://localhost:8080] [--only=T1.6,T2.4] [--probe="js"]
 *   py -3.14 -I tools/tour/build-from-doc.py tools/tour/tour-source.xml
 *
 * Headless Chrome in a throwaway profile (tools/temp-run.js), driven over CDP like tools/print-map-sheet.js.
 * Phase "clean" shots are taken first, before the Grand Canyon demo is loaded; "demo" shots after it;
 * "field" shots on a second brand-new profile at phone size (field mode is offered only on a new phone).
 * Each shot is a crop of one element (or a rectangle the shot computes) at 2x, as PNG, then WebP when
 * ImageMagick (magick) is on the PATH. A shot whose element is not found is reported and skipped.
 * --probe evaluates a JS expression in the demo-loaded app and prints the result (for finding selectors).
 */
const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { makeTempRun } = require('../temp-run')

const args = process.argv.slice(2)
const opt = (name, dflt) => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : dflt }
const BASE = opt('base', 'http://localhost:8080')
const ONLY = opt('only', '') ? opt('only', '').split(',').map(s => s.trim()) : null
const PROBE = opt('probe', '')
const OUT = path.join(__dirname, 'img')
const SCALE = 2
const sleep = ms => new Promise(r => setTimeout(r, ms))

// Finders run in the page. `by(sel, re)` = the first sel element whose text matches re.
const HELPERS = `
  window.__by = (sel, re) => [...document.querySelectorAll(sel)].find(e => re.test(e.textContent) && e.getClientRects().length)
  window.__click = (sel, re) => { const e = window.__by(sel, re); if (e) e.click(); return !!e }
`

// Each shot: id (step), file (no extension), phase, route, setup (JS, optional), find (JS expression for an
// Element or {x,y,width,height} in viewport px), pad (px, default 8), alt, mobile (phone viewport), after (cleanup JS).
const card = title => `[...document.querySelectorAll('mat-card')].find(c => c.querySelector('mat-card-title')?.textContent.trim() === ${JSON.stringify(title)})`
const union = (a, b) => `(() => { const a = ${a}?.getBoundingClientRect(), b = ${b}?.getBoundingClientRect(); if (!a || !b) return null;
  const x = Math.min(a.left, b.left), y = Math.min(a.top, b.top);
  return { x, y, width: Math.max(a.right, b.right) - x, height: Math.max(a.bottom, b.bottom) - y } })()`
const SHOTS = [
  { id: 'T1.2', file: 'demo-offer', phase: 'clean', route: '/', pad: 3,
    vw: 700,
    find: `(() => { const s = document.querySelector('.entry-welcome__demo-line strong'), t = document.querySelector('[data-testid="welcome-tour-link"]'); if (!s || !t) return null
      const a = s.getBoundingClientRect(), b = t.getBoundingClientRect(); return { x: a.left, y: a.top, width: 330, height: b.bottom - a.top } })()`,
    alt: 'The Demo line on Entry’s welcome panel, with the Load a demo button' },
  { id: 'T1.6', file: 'view-switch', phase: 'demo', route: '/',
    find: `document.querySelector('rangertrak-view-switch')`, alt: 'The Full view / Simple view switch at the top of Entry' },
  { id: 'T1.7', file: 'aar-button', phase: 'demo', route: '/',
    find: `document.querySelector('[data-testid="aar-note"]')`, alt: 'The AAR/214 button in the page header' },
  { id: 'T2.1', file: 'ranger-id', phase: 'demo', route: '/',
    setup: `(async () => { const i = [...document.querySelectorAll('input')].find(e => /Ranger ID/.test(e.closest('mat-form-field')?.textContent || '') && e.getClientRects().length);
      i.scrollIntoView({ block: 'center' }); i.focus(); document.execCommand('insertText', false, 'wren'); await new Promise(r => setTimeout(r, 900)) })()`,
    find: `(() => { const f = [...document.querySelectorAll('mat-form-field')].find(e => /Ranger ID/.test(e.textContent) && e.getClientRects().length)
      const i = f.getBoundingClientRect(), p = document.querySelector('.mat-mdc-autocomplete-panel')?.getBoundingClientRect(); if (!p) return null
      const x = Math.min(i.left, p.left), y = i.top; return { x, y, width: Math.max(i.right, p.right) - x, height: p.bottom - y } })()`,
    alt: 'Ranger ID on Entry with matching rangers listed under it' },
  { id: 'T2.4', file: 'disposition-box', phase: 'demo', route: '/radio-log',
    find: `(() => { const h = document.querySelector('.ag-header-cell[col-id="handledMark"]')?.getBoundingClientRect(); const c = document.querySelector('.ag-row[row-index="3"] .ag-cell[col-id="callsign"]')?.getBoundingClientRect(); if (!h || !c) return null
      return { x: h.left, y: h.top, width: c.right - h.left, height: c.bottom - h.top } })()`,
    alt: 'The disposition box at the left of each Radio Log row, first column' },
  { id: 'T3.7', file: 'location-formats', phase: 'demo', route: '/',
    setup: `(async () => { const segs = (k) => [...document.querySelectorAll('.rt-coord-seg--' + k)].filter(e => e.getClientRects().length)
      const vals = [[segs('deg')[0], '36'], [segs('frac')[0], '0601'], [segs('deg')[1], '-112'], [segs('frac')[1], '2105']]
      for (const [i, v] of vals) { i.scrollIntoView({ block: 'center' }); i.focus(); i.select(); document.execCommand('insertText', false, v); i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); await new Promise(r => setTimeout(r, 300)) }
      await new Promise(r => setTimeout(r, 900)) })()`,
    find: union(`document.querySelector('.enter__Where-switcher')`, `document.querySelector('.enter__Where-derived')`),
    alt: 'Entry’s location format switcher with the derived formats below it' },
  { id: 'T4.3', file: 'danger-zone', phase: 'demo', route: '/mission', vw: 760,
    setup: `(async () => { window.__click('.mat-expansion-panel-header', /Danger zone/); await new Promise(r => setTimeout(r, 900)) })()`,
    find: `[...document.querySelectorAll('mat-expansion-panel')].find(p => /Danger zone/.test(p.querySelector('.mat-expansion-panel-header')?.textContent))`,
    alt: 'Mission’s Danger zone panel, opened' },
  { id: 'T4.4', file: 'status-pill', phase: 'demo', route: '/mission', hover: `document.querySelector('.status-cluster')`,
    find: union(`document.querySelector('.status-cluster')`, `document.querySelector('.rt-mission-info-panel__mode')`),
    alt: 'The status pill in the header, with its mode icon, and the panel that opens under it with the mode buttons' },
  { id: 'T4.9', file: 'tactical-calls', phase: 'demo', route: '/mission', find: card('Tactical call signs'),
    alt: 'Mission’s Tactical call signs card' },
  { id: 'T4.10', file: 'import-export-print', phase: 'demo', route: '/rangers', vw: 760,
    setup: `(async () => { document.querySelector('.rt-io-trigger .mat-expansion-panel-header').click(); await new Promise(r => setTimeout(r, 900)) })()`,
    focus: `document.querySelector('.rt-io-trigger')`,
    find: union(`document.querySelector('.rt-io-trigger .mat-expansion-panel-header')`, `[...document.querySelectorAll('.rt-io-trigger mat-card')].find(c => /Export roster/.test(c.textContent))`),
    alt: 'Rangers’ Import, export & print panel, opened' },
  { id: 'T5.3', file: 'attachment-chip', phase: 'demo', route: '/radio-log',
    find: `[...document.querySelectorAll('.ag-cell')].find(c => /\u{1F4CE}/u.test(c.textContent))`,
    alt: 'A Radio Log entry’s paperclip attachment chip' },
  { id: 'T6.1', file: 'offline-save', phase: 'demo', route: '/map', vw: 760,
    find: `document.querySelector('#readiness-offline-tiles')?.closest('mat-card')`,
    alt: 'The Map’s Offline maps card, with Save this area for offline use' },
  { id: 'T6.2', file: 'map-engine-switch', phase: 'demo', route: '/map', vw: 760,
    find: `document.querySelector('.map-engine-switch mat-checkbox')`, alt: 'The switch to the Alternative map (MapLibre + PMTiles) on the Map page' },
  { id: 'T6.6', file: 'data-safety', phase: 'demo', route: '/mission', focus: card('Data safety'),
    find: `(() => { const c = ${card('Data safety')}.getBoundingClientRect(); return { x: c.left, y: c.top, width: c.width, height: 300 } })()`,
    alt: 'Mission’s Data safety card showing the storage status' },
  { id: 'T7.1', file: 'print-ics309', phase: 'demo', route: '/radio-log', find: card('Print ICS-309 log'),
    alt: 'Radio Log’s Print ICS-309 log card' },
  { id: 'T8.2', file: 'board-card', phase: 'demo', route: '/mission', find: card('RangerTrak Board'),
    alt: 'Mission’s RangerTrak Board card' },
  { id: 'T9.2', file: 'send-my-reports', phase: 'field', pad: 14, route: '/', mobile: true,
    setupReloads: true,
    setup: `(async () => { window.__click('.entry-welcome button', /my field phone/i); await new Promise(r => setTimeout(r, 2500)) })()`,
    find: `[...document.querySelectorAll('button')].find(b => /Send \d+ new reports?|Nothing new to send/i.test(b.textContent) && b.getClientRects().length)`,
    alt: 'Field mode’s Send new reports button on a phone' },
]

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const c = [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  const hit = c.find(p => p && fs.existsSync(p))
  if (!hit) throw new Error('Chrome not found. Set CHROME_BIN.')
  return hit
}

/** One headless Chrome in its own throwaway profile, with a CDP page. */
async function openBrowser(port, { touch = false } = {}) {
  const run = makeTempRun('rangertrak-shots-')
  const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${run.dir}`,
    '--no-first-run', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore', env: run.env })
  run.track(chrome)
  let ws, id = 1
  const pending = new Map()
  const b = { run, closed: false }
  b.send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = id++; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params }))
  })
  b.evaluate = async expression => {
    const r = await b.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result.value
  }
  b.close = async () => {
    if (b.closed) return
    b.closed = true
    try { await Promise.race([b.send('Browser.close'), sleep(3000)]) } catch { }   // lets Chrome flush; cleanup() then stops the PID if it is still there
    try { ws.close() } catch { }
    run.cleanup()
    await sleep(300)
  }
  try {
    let target
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250)
      try { target = (await (await fetch(`http://localhost:${port}/json/list`)).json()).find(t => t.type === 'page') } catch { }
    }
    if (!target) throw new Error('Chrome did not expose a debugging target')
    ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
      } else if (m.method === 'Page.javascriptDialogOpening') {
        b.send('Page.handleJavaScriptDialog', { accept: true, promptText: '' }).catch(() => { })
      }
    }
    await b.send('Page.enable'); await b.send('Runtime.enable')
    // A clean profile opens in Simple view and hides controls: pick Full view before the app loads.
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('rt-view')) {
      localStorage.setItem('rt-view', 'full'); localStorage.setItem('rt-view-source', 'user') } } catch { }` })
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: HELPERS })
    if (touch) await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    return b
  } catch (e) { await b.close(); throw e }
}

const viewport = (b, mobile, width = 1280) => b.send('Emulation.setDeviceMetricsOverride',
  mobile ? { width: 390, height: 844, deviceScaleFactor: SCALE, mobile: true } : { width, height: 900, deviceScaleFactor: SCALE, mobile: false })

// localhost: ngsw prefetches ~7 MB before it serves fetches. Wait for the controller, as tools/e2e.js does.
async function settleServiceWorker(b) {
  await b.send('Page.navigate', { url: `${BASE}/` })
  await sleep(2000)
  const r = await b.evaluate(`(async () => {
    const t0 = performance.now(), wait = ms => new Promise(res => setTimeout(res, ms));
    if (!('serviceWorker' in navigator)) return 'no serviceWorker API';
    while (!navigator.serviceWorker.controller && performance.now() - t0 < 45000) await wait(200);
    if (!navigator.serviceWorker.controller) return 'no controlling worker after 45 s';
    const main = document.querySelector('script[src*="main-"]');
    const res = await fetch(main ? main.src : '/index.html');
    return res.ok ? 'ok' : 'status ' + res.status;
  })()`)
  console.log(`service worker: ${r}`)
  await sleep(12000)
}

async function goto(b, route) {
  await b.send('Page.navigate', { url: `${BASE}${route}` })
  await sleep(3500)
}

async function loadDemo(b) {
  await goto(b, '/mission')
  await b.evaluate(`window.__click('.mat-expansion-panel-header', /Danger zone/)`)
  await sleep(500)
  await b.evaluate(`window.__click('button', /Load sample mission/i)`)
  await sleep(5000)
}

const results = []
async function takeShot(b, s) {
  const row = { id: s.id, file: s.file }
  results.push(row)
  try {
    await viewport(b, !!s.mobile, s.vw)
    if (s.route) await goto(b, s.route)
    // The floating back-to-top button would sit over the crop.
    await b.evaluate(`(() => { const st = document.createElement('style'); st.textContent = 'rangertrak-back-to-top { display: none !important }'; document.head.appendChild(st) })()`)
    if (s.setup) {
      try { await b.evaluate(s.setup) } catch (e) { if (!s.setupReloads) throw e; await sleep(5000) }   // e.g. field mode reloads the page
    }
    if (s.focus) {   // a tall element: put its top just under the sticky navbar
      await b.evaluate(`(() => { ${s.focus}.scrollIntoView({ block: 'start' }); scrollBy(0, -130) })()`)
      await sleep(300)
    }
    if (s.hover) {
      const c = await b.evaluate(`(() => { const e = ${s.hover}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
      await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y })
      await sleep(600)
    }
    await sleep(400)
    // Scroll an element to the middle of the window (rectangles are used as they are), then read the rectangle.
    if (!s.focus) await b.evaluate(`(() => { const f = ${s.find}; if (f && f.scrollIntoView) f.scrollIntoView({ block: 'center', inline: 'nearest' }) })()`)
    await sleep(500)
    const r = await b.evaluate(`(() => { const f = ${s.find}; if (!f) return null;
      const x = f.getBoundingClientRect ? f.getBoundingClientRect() : f;
      return { x: x.x ?? x.left, y: x.y ?? x.top, width: x.width, height: x.height, sx: scrollX, sy: scrollY, vw: innerWidth } })()`)
    if (!r || !r.width || !r.height) { row.skipped = 'element not found or has no size'; return }
    const pad = s.pad ?? 8
    const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad)
    const w = Math.min(r.vw - x0, r.x + r.width + pad - x0), h = r.y + r.height + pad - y0
    const shot = await b.send('Page.captureScreenshot', { format: 'png',
      clip: { x: x0 + r.sx, y: y0 + r.sy, width: w, height: h, scale: 1 } })
    const png = path.join(OUT, `${s.file}.png`)
    fs.writeFileSync(png, Buffer.from(shot.data, 'base64'))
    let file = `${s.file}.png`
    try {
      const webp = path.join(OUT, `${s.file}.webp`)
      execFileSync('magick', [png, '-quality', '82', '-define', 'webp:method=6', webp])
      fs.unlinkSync(png); file = `${s.file}.webp`
    } catch { row.note = 'kept PNG (magick not found or failed)' }
    row.file = file
    row.width = Math.round(w); row.height = Math.round(h)   // CSS px = device px / SCALE
    row.alt = s.alt
    row.kb = Math.round(fs.statSync(path.join(OUT, file)).size / 1024)
  } catch (e) { row.skipped = e.message.split('\n')[0] }
  finally { if (s.after) { try { await b.evaluate(s.after) } catch { } } }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const todo = SHOTS.filter(s => !ONLY || ONLY.includes(s.id))
  const phase = p => todo.filter(s => s.phase === p)
  const b = await openBrowser(9447)
  try {
    await viewport(b, false)
    await settleServiceWorker(b)
    for (const s of phase('clean')) await takeShot(b, s)
    if (PROBE || phase('demo').length) await loadDemo(b)
    if (PROBE) {
      await viewport(b, false)
      await goto(b, opt('route', '/'))
      console.log(JSON.stringify(await b.evaluate(PROBE), null, 1))
      return
    }
    for (const s of phase('demo')) await takeShot(b, s)
  } finally { await b.close() }
  const fieldShots = phase('field')
  if (fieldShots.length) {
    // Field mode is offered only on a brand-new phone: a second, fresh profile at phone size.
    const f = await openBrowser(9448, { touch: true })
    try {
      await viewport(f, true)
      await settleServiceWorker(f)
      for (const s of fieldShots) await takeShot(f, s)
    } finally { await f.close() }
  }

  // shots.json: merged with what is there, so --only runs do not drop other steps.
  const jf = path.join(OUT, 'shots.json')
  let map = {}
  try { map = JSON.parse(fs.readFileSync(jf, 'utf8')) } catch { }
  for (const r of results) if (!r.skipped) map[r.id] = { file: r.file, alt: r.alt, width: r.width, height: r.height }
  fs.writeFileSync(jf, JSON.stringify(map, null, 2) + '\n')
  console.log('\nSummary')
  for (const r of results) console.log(r.skipped ? `  SKIPPED ${r.id}: ${r.skipped}` : `  ok      ${r.id}  ${r.file}  ${r.kb} KB  ${r.width}x${r.height}${r.note ? '  ' + r.note : ''}`)
}

main().catch(e => { console.error(e); process.exit(1) })
