/**
 * 2026-09-30, John: E-152 part 1 - what "Print map" does, shared by both map engines.
 *
 * Two jobs on top of the body class the earlier Print map (G) already used to hide the app
 * chrome (styles.scss):
 *
 * 1. A LANDSCAPE page, for this print only. `@page` cannot be conditional on a body class,
 *    and the app has no other `@page` rule (ICS-213 / ICS-309 / After Action print portrait
 *    and must keep doing so), so the rule is added as a <style> element for exactly as long
 *    as this print runs and removed after. A named page (`page: map-sheet`) was the other
 *    option, but it forces a page break between the hidden app chrome and the map, which
 *    risks a blank first page.
 *
 * 2. "Page x of y". Chrome and Edge can draw that in the page margin (CSS @page margin
 *    boxes); Firefox and Safari ignore margin boxes, so there the sheet simply carries no
 *    page numbers rather than a made-up one. The "Prepared by" line is ordinary page
 *    content (map-page.component.html) so it prints everywhere.
 */
const PAGE_CSS = `
  @page {
    size: landscape;
    margin: 10mm 10mm 14mm 10mm;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font: 9pt sans-serif;
      color: #000;
    }
  }
`

export function printMapSheet(): void {
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.appendChild(style)
  document.body.classList.add('rt-print-map')

  const done = () => {
    document.body.classList.remove('rt-print-map')
    style.remove()
  }
  window.addEventListener('afterprint', done, { once: true })
  window.print()
  done()
}
