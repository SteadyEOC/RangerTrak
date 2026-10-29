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

// Search: every step, question, heading and paragraph of the tour, found in the page itself, so it
// works offline like the rest. A hit opens its view at that spot. Without this script the box stays hidden.
const search = document.querySelector('.search')
const q = document.getElementById('tour-q')
const panel = document.getElementById('tour-hits')
const where = (view) => {
  const key = viewKey(view)
  if (key.startsWith('m')) {
    const a = document.querySelector(`.side a[data-m="${key.slice(1)}"]`)
    return `${a.querySelector('.mnum').textContent} · ${a.querySelector('.t').lastChild.textContent}`
  }
  return { start: 'Start', finish: 'Telling us' }[key] || key
}
const plain = (el) => el.textContent.replace(/\s*#\s*$/, '').replace(/\s+/g, ' ').trim()
const index = []
for (const view of views) {
  if (view.id === 'sheet') continue // the Checklist repeats every step
  const first = view.querySelector('h1, h2')
  let anchor = first?.id || view.id || viewKey(view)
  let heading = first ? plain(first) : where(view)
  for (const el of view.querySelectorAll('h1, h2, h3, p, ul.checks > li, li:not(ul.checks li)')) {
    if (el.closest('ul.checks > li') && el.matches('p')) continue // the step itself is indexed
    const text = plain(el)
    if (!text) continue
    if (el.matches('h1, h2, h3') && el.id) { anchor = el.id; heading = text }
    const own = el.id && el.matches('ul.checks > li')
    index.push({ el, text, low: text.toLowerCase(), where: el === first ? '' : where(view),
      heading: own ? el.id : el.matches('h1, h2, h3') ? text : heading, anchor: own ? el.id : anchor,
      score: own ? 1 : el.matches('h1, h2, h3') ? 2 : 0 })
  }
}

function find (query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  // A typed ID (T3.4) comes first, even when it shares a line with others (<span id="T3.4"> in T3.1's step)
  const id = query.trim().toUpperCase()
  const byId = /^[TQ]\d+\.\d+$/.test(id) && document.getElementById(id)?.closest('ul.checks > li')
  return index
    .map((h, i) => byId && h.el === byId ? { h: { ...h, heading: id, anchor: id }, i, s: 10 } : { h, i, s: h.score })
    .filter((x) => x.s === 10 || words.every((w) => x.h.low.includes(w)))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 30).map((x) => x.h)
}

function snippet (text, words) {
  const low = text.toLowerCase()
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((n) => n >= 0), text.length)
  const from = Math.max(0, at - 50)
  const part = (from ? '…' : '') + text.slice(from, from + 160) + (from + 160 < text.length ? '…' : '')
  const out = document.createElement('span')
  out.className = 's'
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  part.split(re).forEach((bit, i) => {
    if (!bit) return
    if (i % 2) { const m = document.createElement('mark'); m.textContent = bit; out.append(m) } else out.append(bit)
  })
  return out
}

let shown = []
function showHits () {
  const query = q.value.trim()
  panel.replaceChildren()
  if (query.length < 2) { panel.hidden = true; return }
  shown = find(query)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const count = document.createElement('p')
  count.className = 'count'
  count.setAttribute('aria-live', 'polite')
  count.textContent = shown.length
    ? `${shown.length}${shown.length === 30 ? '+' : ''} found`
    : 'Nothing in the Tour matches that. Try fewer or different words.'
  panel.append(count)
  shown.forEach((h, i) => {
    const a = document.createElement('a')
    a.href = '#' + h.anchor
    a.dataset.i = i
    const head = document.createElement('span')
    head.className = 'h'
    head.textContent = h.heading
    const w = document.createElement('span')
    w.className = 'w'
    w.textContent = h.where
    a.append(head, w, snippet(h.text.replace(/^[TQ]\d+\.\d+\S*\s+/, ''), words))
    panel.append(a)
  })
  panel.hidden = false
}

function go (h) {
  panel.hidden = true
  history.pushState(null, '', '#' + h.anchor)
  route()
  if (h.el.id !== h.anchor) h.el.scrollIntoView({ block: 'center' })
  h.el.classList.remove('found')
  void h.el.offsetWidth // restart the flash when the same spot is found twice
  h.el.classList.add('found')
}

if (search && q && panel) {
  search.hidden = false
  q.addEventListener('input', showHits)
  q.addEventListener('focus', () => { if (q.value.trim().length >= 2) showHits() })
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && shown.length && !panel.hidden) { e.preventDefault(); go(shown[0]) }
    if (e.key === 'ArrowDown' && !panel.hidden) { e.preventDefault(); panel.querySelector('a')?.focus() }
    if (e.key === 'Escape') { q.value ? (q.value = '') : q.blur(); panel.hidden = true }
  })
  panel.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-i]')
    if (!a) return
    e.preventDefault()
    go(shown[a.dataset.i])
  })
  panel.addEventListener('keydown', (e) => {
    const links = [...panel.querySelectorAll('a')]
    const i = links.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); links[Math.min(i + 1, links.length - 1)]?.focus() }
    if (e.key === 'ArrowUp') { e.preventDefault(); i > 0 ? links[i - 1].focus() : q.focus() }
    if (e.key === 'Escape') { panel.hidden = true; q.focus() }
  })
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !e.target.closest('.search, .hits')) panel.hidden = true
  })
}

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
