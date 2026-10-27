// SPDX-License-Identifier: AGPL-3.0-or-later
// The Tour page's one script. A file of its own, not an inline onclick: the site's
// Content-Security-Policy (script-src 'self') blocks inline handlers (John 2026-10-27).
document.getElementById('print-sheet')?.addEventListener('click', () => {
  document.body.classList.add('sheet-only')
  addEventListener('afterprint', () => document.body.classList.remove('sheet-only'), { once: true })
  setTimeout(print, 50)
})
