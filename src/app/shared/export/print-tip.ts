/**
 * 2026-09-30, John: printing opened the browser dialog on "Save as PDF" (browsers remember the
 * last destination, and a web page cannot choose the printer or skip the dialog). So the first
 * time anything is printed on a device, say so once, before the dialog opens: pick the printer
 * there, the browser remembers it, and from then on it is just Print + Enter.
 *
 * A per-device "seen it" flag, the same kind as the welcome panel's dismiss flag - not mission
 * data, not backed up.
 */
const PRINT_TIP_KEY = 'printTipShown'

export function showFirstPrintTip(): void {
  try {
    if (localStorage.getItem(PRINT_TIP_KEY) === 'true') return
  } catch {
    return // storage blocked (private mode etc.): skip the tip rather than nag every time
  }
  alert(`Your browser's print dialog opens next.\n\n`
    + `Choose your printer there (not "Save as PDF"). Your browser remembers it, so next `
    + `time you just press Print.`)
  try {
    localStorage.setItem(PRINT_TIP_KEY, 'true')
  } catch { /* shown once this session at least */ }
}
