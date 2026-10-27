/**
 * Escapes text for the places that build markup as a string (AG Grid string cell renderers, the
 * Leaflet popup). A note typed as "temp < 40F" or imported from a file must show as text, not be
 * parsed as tags. Safe in element content and in a double- or single-quoted attribute.
 */
export function escapeHtml(text: unknown): string {
  return String(text ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
}
