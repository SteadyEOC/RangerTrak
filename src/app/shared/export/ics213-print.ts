/**
 * D1 (maintainer decision, 2026-09-22, auto-print-213 scoping): opens the actual print
 * dialog rather than only downloading a file the scribe then has to find and open
 * themselves - a hidden `<iframe>` pointed at the filled PDF, `contentWindow.print()`.
 * Falls back to the existing anchor-download path (same technique messages.component.ts's
 * own manual "Print as ICS-213" already uses) when the print path is unavailable: Chrome
 * opens an embedded blob PDF's own print dialog through a hidden iframe fine; Firefox does
 * not. `iframe.contentWindow` coming back null in some odd embedding context gets the same
 * fallback treatment.
 *
 * DOM allowed, no Angular DI - a caller (entry.component.ts) builds the bytes with
 * `fillIcs213Pdf()` and hands them here; this module never decides where they come from,
 * same "pure-ish, decoupled from Angular" split ics213-pdf.ts itself documents.
 *
 * Deliberately no `window.confirm`, no blocking dialog of its own - a scribe filing report
 * after report mid-mission does not get a modal on every submission. See entry.component.ts's
 * own onFormSubmit() comment for why this is kicked off fire-and-forget, never awaited by the
 * submit path itself.
 */
export type Ics213PrintOutcome = 'printed' | 'downloaded'

export async function printIcs213(pdfBytes: Uint8Array, filename: string): Promise<Ics213PrintOutcome> {
  // Uint8Array's `.buffer` types as ArrayBufferLike (stricter BlobPart wants ArrayBuffer) -
  // same type-only mismatch messages.component.ts's own Blob construction already notes;
  // pdf-lib's save() is always backed by a plain ArrayBuffer at runtime.
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  if (await tryPrintViaIframe(url)) {
    return 'printed'
  }

  // The browser refused the print route (Firefox, most likely) - same anchor-download
  // mechanics messages.component.ts's own manual print button already uses.
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

/**
 * Resolves `false` rather than throwing/rejecting on any failure, INCLUDING one raised
 * from inside `contentWindow.print()` itself - the caller's job at that point is to fall
 * back to a download, not to propagate an error out of what is meant to be a convenience
 * on top of an already-successful report submission.
 */
function tryPrintViaIframe(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    // Off-screen, not display:none - some browsers refuse to run print() from a display:none
    // frame's contentWindow.
    iframe.style.cssText = 'position:fixed; width:0; height:0; border:0; visibility:hidden;'
    iframe.src = url

    iframe.onload = () => {
      try {
        if (!iframe.contentWindow) {
          throw new Error('iframe.contentWindow is null')
        }
        iframe.contentWindow.print()
        // Revoking too early kills the print preview mid-render - messages.component.ts's
        // own revokeObjectURL() runs immediately after a.click(), which is fine for a plain
        // download and wrong here. print() only OPENS the dialog; it does not wait for the
        // scribe to dismiss it, so a generous timeout stands in for "probably done with it"
        // rather than tearing the iframe/URL down synchronously right after the call returns.
        setTimeout(() => {
          iframe.remove()
          URL.revokeObjectURL(url)
        }, 60_000)
        resolve(true)
      } catch {
        iframe.remove()
        resolve(false)
      }
    }
    iframe.onerror = () => {
      iframe.remove()
      resolve(false)
    }
    document.body.appendChild(iframe)
  })
}
