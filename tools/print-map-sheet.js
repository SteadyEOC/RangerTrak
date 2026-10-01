#!/usr/bin/env node
/**
 * 2026-09-30, John (via the blog session): makes a copy of the printed map sheet - a PDF and a
 * ~200 dpi PNG of page 1 - from a demo mission, in headless Chrome (no visible window, no print
 * dialog). The blog uses it as a hero image; it is also a quick way to eyeball the sheet.
 *
 *   node tools/serve-dist.js                      (in another terminal; serves dist on :8080)
 *   node tools/print-map-sheet.js [outDir] [--base=http://localhost:8080] [--name=...]
 *
 * Loads the default sample mission (Grand Canyon), opens the Leaflet map, switches on the
 * USNG / MGRS grid, sets the readout to DDM (so the edge ticks print in degrees and decimal
 * minutes), fills "Prepared by" with a fictional name, then lays the page out as Print map
 * does (the rt-print-map body class and a landscape Letter @page, see map-print-sheet.ts).
 *
 * The viewport is set to the Letter page's printable width (279.4 mm less 2 x 10 mm margins =
 * 980 CSS px) before print media is switched on, so the screen layout and the PDF agree and
 * the map is measured once, at its printed size, when the print media change fires.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const args = process.argv.slice(2)
const opt = (name, dflt) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || dflt
const outDir = path.resolve(args.find(a => !a.startsWith('--')) || '.')
const BASE = opt('base', 'http://localhost:8080')
const NAME = opt('name', 'Morgan Ridgeway')
const PORT = 9445
const PAGE_W = 980   // CSS px: printable width of landscape Letter at 96 px/in
const PAGE_H = 725   // CSS px: printable height (215.9 mm less 10 mm top and 14 mm bottom)
// Device pixels per CSS px. 2 = 192 dpi: at 300/96 (300 dpi) headless Chrome's screenshot hung
// every time (2026-09-30), at any viewport height; 2 is the largest tried that works.
const SCALE = Number(opt('scale', 2))

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const c = process.platform === 'win32'
    ? [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  const hit = c.find(p => p && fs.existsSync(p))
  if (!hit) throw new Error('Chrome not found. Set CHROME_BIN.')
  return hit
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rangertrak-print-'))
  const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' })
  let ws
  let id = 1
  const pending = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = id++
    pending.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed')
    return r.result.value
  }
  try {
    let target
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250)
      try { target = (await (await fetch(`http://localhost:${PORT}/json/list`)).json()).find(t => t.type === 'page') } catch { }
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
        send('Page.handleJavaScriptDialog', { accept: true })
      }
    }
    await send('Page.enable'); await send('Runtime.enable')

    // Fresh profile, then load the default sample mission from Mission > Danger zone.
    await send('Page.navigate', { url: `${BASE}/mission` }); await sleep(3500)
    await evaluate(`[...document.querySelectorAll('.mat-expansion-panel-header')].find(h => h.textContent.includes('Danger zone'))?.click()`)
    await sleep(400)
    await evaluate(`[...document.querySelectorAll('button')].find(b => /Load sample mission/i.test(b.textContent))?.click()`)
    await sleep(5000)

    await send('Emulation.setDeviceMetricsOverride', { width: PAGE_W, height: PAGE_H, deviceScaleFactor: SCALE, mobile: false })
    await evaluate(`[...document.querySelectorAll('.main-nav ul a')].find(a => a.textContent.trim().toLowerCase() === 'map')?.click()`)
    await sleep(4000)
    await evaluate(`(() => {
      [...document.querySelectorAll('#mapLeaflet-main .leaflet-control-layers-overlays label')]
        .find(l => /USNG/.test(l.textContent))?.querySelector('input')?.click();
      [...document.querySelectorAll('[data-testid="map-coord-format"] button')].find(b => b.textContent.trim() === 'DDM')?.click();
      const input = document.querySelector('.map-prepared-by input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(NAME)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const style = document.createElement('style');
      style.textContent = '@page { size: letter landscape; margin: 10mm 10mm 14mm 10mm; '
        + '@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; } }';
      document.head.appendChild(style);
      // Paper is white: the PNG is a screen capture, which would otherwise show the app's
      // page background and scrollbar (a real print drops backgrounds by default).
      const paper = document.createElement('style');
      paper.textContent = '@media print { html, body, body * { scrollbar-width: none !important; } '
        + 'html, body, .mat-drawer-container, .mat-drawer-content, .mat-sidenav-content, main { background: #fff !important; } }';
      document.head.appendChild(paper);
      document.body.classList.add('rt-print-map');
    })()`)
    await sleep(1500)
    // Press the real Print map button, so the sheet gets the same sharper (one zoom level
    // deeper) tiles a user's print does. Headless Chrome has no print dialog, so the map stays
    // in its prepared state for the capture below.
    await evaluate(`document.querySelector('[data-testid="printMap"]')?.click()`)
    for (let i = 0; i < 40; i++) {
      await sleep(250)
      if (await evaluate(`!document.querySelector('[data-testid="printMap"]')?.disabled`)) break
    }
    await evaluate(`(() => {
      const style = document.createElement('style');
      style.textContent = '@page { size: letter landscape; margin: 10mm 10mm 14mm 10mm; '
        + '@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; } }';
      document.head.appendChild(style);
      document.body.classList.add('rt-print-map');
    })()`) // printMapSheet() took its own copies off again when window.print() returned
    await send('Emulation.setEmulatedMedia', { media: 'print' })
    await sleep(6000) // tiles for the re-measured map
    const ticks = await evaluate(`document.querySelectorAll('.map-edge-ticks__label').length`)
    console.log(`edge tick labels on the sheet: ${ticks}`)

    // A plain viewport screenshot (a clipped beyond-viewport capture hung under emulated print
    // media), cropped to page 1 below. Timed out rather than left to hang.
    const png = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      sleep(90000).then(() => { throw new Error('screenshot timed out') }),
    ])
    const pngPath = path.join(outDir, 'printed-map-sheet-grand-canyon.png')
    fs.writeFileSync(pngPath, Buffer.from(png.data, 'base64'))
    // Crop to page 1, then add the page margins (10 mm sides/top, 14 mm bottom) and
    // the dpi tag, if ImageMagick is installed; the uncropped capture otherwise.
    const mm = n => Math.round(n / 25.4 * 96 * SCALE)
    try {
      execFileSync('magick', [pngPath, '-crop', `${Math.round(PAGE_W * SCALE)}x${Math.round(PAGE_H * SCALE)}+0+0`, '+repage',
        '-background', 'white', '-gravity', 'north', '-splice', `0x${mm(10)}`,
        '-gravity', 'south', '-splice', `0x${mm(14)}`, '-gravity', 'west', '-splice', `${mm(10)}x0`, '-gravity', 'east',
        '-splice', `${mm(10)}x0`, '-units', 'PixelsPerInch', '-density', String(Math.round(96 * SCALE)), pngPath])
    } catch { console.log('ImageMagick not found: PNG left without page margins') }

    // The PDF last: a screenshot taken after printToPDF hung in headless Chrome.
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true })
    const pdfPath = path.join(outDir, 'printed-map-sheet-grand-canyon.pdf')
    fs.writeFileSync(pdfPath, Buffer.from(pdf.data, 'base64'))
    console.log(`wrote ${pdfPath}\nwrote ${pngPath}`)
  } finally {
    try { ws?.close() } catch { }
    try { chrome.kill() } catch { }
    await sleep(500)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
