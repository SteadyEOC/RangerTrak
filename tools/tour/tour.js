// SPDX-License-Identifier: AGPL-3.0-or-later
// The Tour page's one script. A file of its own, not an inline onclick: the site's
// Content-Security-Policy (script-src 'self') blocks inline handlers (John 2026-10-27).
//
// E-244: shows one view at a time (Start, a module, Telling us, the Checklist), picked by the
// URL's #anchor so the frozen IDs (#m3, #T3.4, #sheet) still land; and keeps the tester's ticks.
// Ticks live in this browser's localStorage only. Without this script the page is one long read.

const TICKS = 'rt-tour-ticks'
const VIEW = 'rt-tour-view'
const get = (k) => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private window: ticks last the visit */ } }

let ticks
try { ticks = new Set(JSON.parse(get(TICKS) || '[]')) } catch { ticks = new Set() }

const views = [...document.querySelectorAll('.view')]
const viewKey = (v) => v.dataset.view || v.id
const boxes = [...document.querySelectorAll('input.tick')]
const ids = (box) => box.dataset.ids.split(' ')

function syncTicks () {
  for (const b of boxes) b.checked = ids(b).every((x) => ticks.has(x))
  const all = new Set(boxes.flatMap(ids))
  document.getElementById('done-count').textContent = [...all].filter((x) => ticks.has(x)).length
  for (let m = 1; m <= 9; m++) {
    const mine = [...all].filter((x) => x.slice(1).split('.')[0] === String(m))
    const done = mine.filter((x) => ticks.has(x)).length
    const whole = done === mine.length && done > 0
    const a = document.querySelector(`.side a[data-m="${m}"]`)
    a.classList.toggle('done', whole)
    a.querySelector('.count').textContent = whole ? '✓' : `${done}/${mine.length}`
    const p = document.querySelector(`.mprog[data-m="${m}"]`)
    p.textContent = whole
      ? `All ${mine.length} done. Nice work.`
      : `${done} of ${mine.length} ticked. Tick each step as you go; your ticks stay in this browser.`
    p.classList.toggle('done', whole)
  }
}

document.addEventListener('change', (e) => {
  const b = e.target
  if (!b.matches?.('input.tick')) return
  for (const x of ids(b)) b.checked ? ticks.add(x) : ticks.delete(x)
  set(TICKS, JSON.stringify([...ticks]))
  syncTicks()
})

function route () {
  const hash = decodeURIComponent(location.hash.slice(1))
  let target = hash ? document.getElementById(hash) : null
  let view = target?.closest('.view')
  if (!view) {
    view = views.find((v) => viewKey(v) === get(VIEW)) || views[0]
    target = null
  }
  const key = viewKey(view)
  for (const v of views) v.hidden = v !== view
  set(VIEW, key)
  if (key.startsWith('m')) document.getElementById('tab-modules').href = '#' + key
  for (const a of document.querySelectorAll('.tabs a')) {
    const on = a.id === 'tab-modules' ? key.startsWith('m') : a.getAttribute('href') === '#' + key ||
      (key === 'finish' && a.getAttribute('href') === '#last-stop')
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')
  }
  for (const a of document.querySelectorAll('.side a')) {
    a.getAttribute('href') === '#' + key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')
  }
  document.body.classList.toggle('in-module', key.startsWith('m'))
  // A view's own heading (or the view itself) opens at the top; a step or section scrolls to it.
  const first = view.querySelector('h1, h2')
  if (target && target !== view && target !== first) target.scrollIntoView()
  else scrollTo(0, 0)
}

addEventListener('hashchange', route)
syncTicks()
route()
// Again once loaded: Chrome's own scroll to the #anchor comes after this script and undoes ours.
addEventListener('load', () => setTimeout(route), { once: true })

document.getElementById('print-sheet')?.addEventListener('click', () => print())
document.getElementById('clear-ticks')?.addEventListener('click', () => {
  if (!confirm('Clear every tick on this device?')) return
  ticks.clear()
  set(TICKS, '[]')
  syncTicks()
})
document.getElementById('print-all')?.addEventListener('click', () => {
  document.body.classList.add('print-all')
  addEventListener('afterprint', () => document.body.classList.remove('print-all'), { once: true })
  setTimeout(print, 50)
})
