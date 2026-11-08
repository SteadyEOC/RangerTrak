#!/usr/bin/env node
/**
 * 2026-09-30, John (via the blog session): makes a copy of the printed map sheet - a PDF and a
 * ~200 dpi PNG of page 1 - from a demo mission, in headless Chrome (no visible window, no print
 * dialog). The blog uses it as a hero image; it is also a quick way to eyeball the sheet.
 *
 *   node tools/serve-dist.js                      (in another terminal; serves dist on :8080)
 *   node tools/print-map-sheet.js [outDir] [--base=http://localhost:8080] [--name=...] [--demo=grand-canyon|vashon|state-fair] [--orientation=landscape|portrait] [--print-scale=56]
 *
 * Loads a sample mission (Grand Canyon unless --demo says otherwise), opens the Leaflet map, switches on the
 * USNG / MGRS grid, sets the readout to DDM (so the edge ticks print in degrees and decimal
 * minutes), fills "Prepared by" with a fictional name, then lays the page out as Print map
 * does (the rt-print-map body class and a landscape Letter @page, see map-print-sheet.ts).
 *
 * The viewport is set to the Letter page's printable width (279.4 mm less 2 x 10 mm margins =
 * 980 CSS px) before print media is switched on, so the screen layout and the PDF agree and
 * the map is measured once, at its printed size, when the print media change fires.
 */
const fs = require('fs')
const { makeTempRun } = require('./temp-run')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const args = process.argv.slice(2)
const opt = (name, dflt) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || dflt
const outDir = path.resolve(args.find(a => !a.startsWith('--')) || '.')
const BASE = opt('base', 'http://localhost:8080')
const NAME = opt('name', 'Morgan Ridgeway')
// 2026-10-01, John: E-152b - which demo mission to print: grand-canyon (default), vashon or
// state-fair (the crowded "city" test for the floating panels). Picked the way the Mission
// page's own Demo scenario picker does, by its visible label.
const DEMO = opt('demo', 'grand-canyon')
const DEMO_LABEL = { 'grand-canyon': 'Grand Canyon', 'vashon': 'Vashon Island', 'state-fair': 'State fair' }[DEMO]
if (!DEMO_LABEL) throw new Error(`--demo must be grand-canyon, vashon or state-fair (got ${DEMO})`)
// 2026-10-15, E-190: --filter=1 sets Show to Needs attention before printing, to eyeball the "Filtered:" line.
const FILTERED = opt('filter', '') === '1'
const PORT = 9445
// 2026-10-05, John: E-172 - --orientation=portrait prints the same sheet on a portrait Letter page.
const PORTRAIT = opt('orientation', 'landscape') === 'portrait'
const PAGE_W = PORTRAIT ? 741 : 980   // CSS px: printable width of Letter at 96 px/in (216 or 279.4 mm less 2 x 10 mm)
const PAGE_H = PORTRAIT ? 965 : 725   // CSS px: printable height (279.4 or 215.9 mm less 10 mm top and 14 mm bottom)
const ORIENT = PORTRAIT ? 'portrait' : 'landscape'
const SUFFIX = PORTRAIT ? '-portrait' : ''
// Device pixels per CSS px. 2 = 192 dpi: at 300/96 (300 dpi) headless Chrome's screenshot hung
// every time (2026-09-30), at any viewport height; 2 is the largest tried that works.
const SCALE = Number(opt('scale', 2))
// 2026-10-05, John: the print dialog's own Scale (Chrome's "More settings > Scale", e.g. 56) for the
// PDF. Below 100 the page lays out wider and taller than the sheet the tiles were loaded for.
const PRINT_SCALE = Number(opt('print-scale', 100)) / 100
// 2026-10-16, John's blank second sheet: a real print dialog lays the sheet out several times,
// starting wider than the paper and settling (print check: frame 1281, 1150, 1025, 963 px).
// --start-width=1281 --start-height=970 lays the print sheet out at that size first, then at the
// paper's, and lists what the first pass left reaching past the paper's edges.
const START_W = Number(opt('start-width', 0))
const START_H = Number(opt('start-height', 0))

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
  const run = makeTempRun('rangertrak-print-')
  const profile = run.dir
  const chrome = spawn(findChrome(), ['--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore', env: run.env })
  run.track(chrome)
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
    // E-207 / D-62: a clean profile is a new install, which opens in Simple view and hides Print map.
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!localStorage.getItem('rt-view')) {
      localStorage.setItem('rt-view', 'full'); localStorage.setItem('rt-view-source', 'user') } } catch { }` })

    // Fresh profile, then load the default sample mission from Mission > Danger zone.
    await send('Page.navigate', { url: `${BASE}/mission` }); await sleep(3500)
    await evaluate(`[...document.querySelectorAll('.mat-expansion-panel-header')].find(h => h.textContent.includes('Danger zone'))?.click()`)
    await sleep(400)
    if (DEMO !== 'grand-canyon') {
      await evaluate(`document.querySelector('.mission__sample-scenario mat-select')?.click()`)
      await sleep(600)
      await evaluate(`[...document.querySelectorAll('mat-option')].find(o => o.textContent.includes(${JSON.stringify(DEMO_LABEL)}))?.click()`)
      await sleep(600)
    }
    await evaluate(`[...document.querySelectorAll('button')].find(b => /Load sample mission/i.test(b.textContent))?.click()`)
    await sleep(5000)

    await send('Emulation.setDeviceMetricsOverride', { width: START_W || PAGE_W, height: START_H || PAGE_H, deviceScaleFactor: SCALE, mobile: false })
    await evaluate(`[...document.querySelectorAll('.main-nav ul a')].find(a => a.textContent.trim().toLowerCase() === 'map')?.click()`)
    await sleep(4000)
    await evaluate(`(() => {
      [...document.querySelectorAll('#mapLeaflet-main .leaflet-control-layers-overlays label')]
        .find(l => /USNG/.test(l.textContent))?.querySelector('input')?.click();
      [...document.querySelectorAll('[data-testid="map-coord-format"] button')].find(b => b.textContent.trim() === 'DDM')?.click();
      if (${FILTERED}) document.querySelector('[data-testid="map-show-attention"]')?.click();
      const input = document.querySelector('.map-prepared-by input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(NAME)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const style = document.createElement('style');
      style.textContent = '@page { size: letter ${ORIENT}; margin: 10mm 10mm 14mm 10mm; '
        + '@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; } }';
      document.head.appendChild(style);
      // Only the scrollbar is hidden here: the PNG is a screen capture. The page background is
      // NOT forced white, so the app's own print CSS (styles.scss, E-172) is what shows.
      const paper = document.createElement('style');
      paper.textContent = '@media print { html, body, body * { scrollbar-width: none !important; } }';
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
      style.textContent = '@page { size: letter ${ORIENT}; margin: 10mm 10mm 14mm 10mm; '
        + '@bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9pt sans-serif; color: #000; } }';
      document.head.appendChild(style);
      document.body.classList.add('rt-print-map');
    })()`) // printMapSheet() took its own copies off again when window.print() returned
    if (PRINT_SCALE !== 1) {
      // The dialog's Scale lays the page out 1/scale wider and taller; the screenshot shows it at that size.
      await send('Emulation.setDeviceMetricsOverride', { width: Math.round(PAGE_W / PRINT_SCALE),
        height: Math.round(PAGE_H / PRINT_SCALE), deviceScaleFactor: SCALE * PRINT_SCALE, mobile: false })
    }
    // 2026-10-05, John: the base map must reach every edge of the frame - tiles are loaded before the
    // print dialog opens, so any part of the printed frame they miss prints blank. Sampled on a grid, at
    // once (what the print dialog captures) and after the 6 s a headless capture allows.
    const coverage = () => evaluate(`(() => {
      const map = document.querySelector('#mapLeaflet-main').getBoundingClientRect();
      const pane = document.querySelector('#mapLeaflet-main .leaflet-tile-pane .leaflet-layer');
      const tiles = [...(pane?.querySelectorAll('img.leaflet-tile-loaded') || [])].map(t => t.getBoundingClientRect());
      let hit = 0, n = 0;
      for (let i = 0.5; i < 40; i++) for (let j = 0.5; j < 40; j++) {
        const x = map.left + map.width * i / 40, y = map.top + map.height * j / 40; n++;
        if (tiles.some(r => x >= r.left && x < r.right && y >= r.top && y < r.bottom)) hit++;
      }
      return 'base map covers ' + Math.round(100 * hit / n) + '% of the map frame (' + tiles.length + ' tiles)'
    })()`)
    await send('Emulation.setEmulatedMedia', { media: 'print' })
    await sleep(100)
    if (START_W) {
      await sleep(3000)
      await send('Emulation.setDeviceMetricsOverride', { width: PAGE_W, height: PAGE_H, deviceScaleFactor: SCALE, mobile: false })
      await sleep(500)
      console.log(await evaluate(`(() => {
        const W = ${PAGE_W}, H = ${PAGE_H}
        const out = r => r.width && r.height && (r.right > W + 0.5 || r.bottom + scrollY > H + 0.5)
        const hits = [...document.querySelectorAll('body *')]
          .filter(el => !el.closest('.leaflet-pane'))
          .filter(el => out(el.getBoundingClientRect()) && !(el.parentElement && out(el.parentElement.getBoundingClientRect())))
          .slice(0, 12)
          .map(el => { const r = el.getBoundingClientRect(); return el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')
            + ' [' + Math.round(r.left) + ',' + Math.round(r.top + scrollY) + ' → ' + Math.round(r.right) + ',' + Math.round(r.bottom + scrollY) + '] ' + (el.style.cssText || '').slice(0, 60) })
        return 'after the wide pass, at ' + W + 'x' + H + ': scrollWidth ' + document.documentElement.scrollWidth + '; past the paper: ' + (hits.join(' | ') || 'nothing')
      })()`))
    }
    console.log(`at once: ${await coverage()}`)
    await sleep(6000)
    console.log(`after 6 s: ${await coverage()}`) // tiles for the re-measured map
    const ticks = await evaluate(`document.querySelectorAll('.map-edge-ticks__label').length`)
    console.log(`edge tick labels on the sheet: ${ticks}`)
    // 2026-10-05, John: E-172 - does page 1 end where it should? The map frame's height and where
    // the sign-off line ends, against the page's printable height (innerHeight in print media).
    // overflow > 0 would be a second sheet.
    console.log(await evaluate(`(() => {
      const f = document.querySelector('.mapLeaflet-frame')?.getBoundingClientRect();
      const foot = document.querySelector('.map-print-footer')?.getBoundingClientRect();
      const page2 = document.querySelector('.map-print-panel--page2');
      const end = foot ? Math.round(foot.bottom + scrollY) : 0;
      return 'page ' + innerWidth + 'x' + innerHeight + ' px; map frame ' + Math.round(f?.width) + 'x' + Math.round(f?.height)
        + ' px (' + Math.round(100 * f?.height / innerHeight) + '% of page height); sign-off line ends at ' + end
        + ' px (overflow ' + (end - innerHeight) + ' px)' + (page2 ? '; legend on page 2' : '')
    })()`))
    // 2026-10-16, John's PDFs: a blank second sheet. Anything that reaches past page 1's printable
    // height, outermost first (nothing inside the map, which clips its own tiles).
    console.log(await evaluate(`(() => {
      const past = [...document.querySelectorAll('body *')]
        .filter(el => !el.closest('.leaflet-pane, .leaflet-control-container'))
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height && r.bottom + scrollY > innerHeight + 0.5)
        .filter(({ el }) => { const p = el.parentElement?.getBoundingClientRect(); return !p || p.bottom + scrollY <= innerHeight + 0.5 || el.parentElement === document.body })
        .map(({ el, r }) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '')
          + ' top ' + Math.round(r.top + scrollY) + ' bottom ' + Math.round(r.bottom + scrollY) + ' ' + getComputedStyle(el).position)
      const h = el => Math.round(el.getBoundingClientRect().height * 10) / 10
      return 'past page 1 (' + innerHeight + ' px; html ' + h(document.documentElement) + ', body ' + h(document.body) + ' px): ' + (past.join('; ') || 'nothing')
    })()`))
    // 2026-10-16: the same with the panels at their CSS positions only, as the print layout stands
    // before the app's print handler places them (each dialog pass starts there: the handler runs
    // after Chrome has laid the page out, and the reset between passes clears their positions).
    console.log(await evaluate(`(() => {
      const panels = [...document.querySelectorAll('.map-print-panel')]
      const saved = panels.map(p => p.style.cssText)
      panels.forEach(p => ['left', 'top', 'right', 'bottom'].forEach(s => p.style.removeProperty(s)))
      const h = Math.round(document.documentElement.getBoundingClientRect().height * 10) / 10
      const rows = panels.map(p => { const r = p.getBoundingClientRect(); return p.className.split(' ').pop() + ' ' + Math.round(r.top + scrollY) + '-' + Math.round(r.bottom + scrollY) })
      panels.forEach((p, i) => { p.style.cssText = saved[i] })
      return 'before the print handler (panels unplaced): html ' + h + ' px of ' + innerHeight + '; ' + rows.join('; ')
    })()`))
    // 2026-10-01, John: E-152b - how far the fanned-out icons sit from their true points (the
    // length of the longest leader line, in CSS px).
    const longest = await evaluate(`Math.round(Math.max(0, ...[...document.querySelectorAll('path.rt-fan-leader')].map(p => {
      const n = (p.getAttribute('d') || '').match(/-?[0-9.]+/g)?.map(Number) || []
      return n.length >= 4 ? Math.hypot(n[2] - n[0], n[3] - n[1]) : 0
    })))`)
    console.log(`longest fan leader: ${longest} px`)

    // A plain viewport screenshot (a clipped beyond-viewport capture hung under emulated print
    // media), cropped to page 1 below. Timed out rather than left to hang.
    const png = await Promise.race([
      send('Page.captureScreenshot', { format: 'png' }),
      sleep(90000).then(() => { throw new Error('screenshot timed out') }),
    ])
    const pngPath = path.join(outDir, `printed-map-sheet-${DEMO}${SUFFIX}.png`)
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

    // 2026-10-01, John: E-152b - when the legend did not fit on the map it prints at the top of
    // page 2. The screen layout is continuous, so a taller viewport shows it just below page 1;
    // save that strip as a second PNG so it can be looked at too.
    if (await evaluate(`!!document.querySelector('.map-print-panel--page2')`)) {
      try {
        await send('Emulation.setDeviceMetricsOverride', { width: PAGE_W, height: PAGE_H * 2, deviceScaleFactor: SCALE, mobile: false })
        await sleep(2000)
        const png2 = await Promise.race([
          send('Page.captureScreenshot', { format: 'png' }),
          sleep(60000).then(() => { throw new Error('page 2 screenshot timed out') }),
        ])
        const p2 = path.join(outDir, `printed-map-sheet-${DEMO}${SUFFIX}-page2.png`)
        fs.writeFileSync(p2, Buffer.from(png2.data, 'base64'))
        execFileSync('magick', [p2, '-crop', `${Math.round(PAGE_W * SCALE)}x${Math.round(PAGE_H * SCALE)}+0+${Math.round(PAGE_H * SCALE * 0.95)}`, '+repage', p2])
        console.log(`wrote ${p2} (legend strip below page 1)`)
        await send('Emulation.setDeviceMetricsOverride', { width: PAGE_W, height: PAGE_H, deviceScaleFactor: SCALE, mobile: false })
        await sleep(1500)
      } catch (e) { console.log(`page 2 picture skipped: ${e.message}`) }
    }

    // The PDF last: a screenshot taken after printToPDF hung in headless Chrome.
    const pdf = await Promise.race([
      send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, scale: PRINT_SCALE }),
      sleep(60000).then(() => { throw new Error('printToPDF timed out') }),
    ])
    const pdfPath = path.join(outDir, `printed-map-sheet-${DEMO}${SUFFIX}.pdf`)
    fs.writeFileSync(pdfPath, Buffer.from(pdf.data, 'base64'))
    console.log(`wrote ${pdfPath}\nwrote ${pngPath}`)
    try {
      const { PDFDocument } = require('pdf-lib')
      console.log(`PDF pages: ${(await PDFDocument.load(pdf.data, { ignoreEncryption: true })).getPageCount()}`)
    } catch (e) { console.log(`PDF page count unavailable: ${e.message}`) }
  } finally {
    try { ws?.close() } catch { }
    run.cleanup()
    await sleep(500)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
