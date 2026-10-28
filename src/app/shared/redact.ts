/**
 * E-258 (2026-10-28): strips what must not reach a PUBLIC GitHub issue from text that is about
 * to be included in a diagnostic report or a "Report it" draft: email addresses, phone-number-like
 * digit runs and latitude/longitude pairs. Best effort - it is a net under the real rule (log
 * messages of ordinary entries are left out of the report altogether), not a replacement for it.
 */
export function redact(text: string): string {
  return text
    // Coordinates first, so their digits are not later mistaken for a phone number.
    .replace(/-?\d{1,3}\.\d{3,}\s*[,;/\s]\s*-?\d{1,3}\.\d{3,}/g, '[coords]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    // 7+ digits, allowing the usual separators between them.
    .replace(/\+?\d[\d\s().-]{5,}\d/g, run => (run.replace(/\D/g, '').length >= 7 ? '[number]' : run))
}
