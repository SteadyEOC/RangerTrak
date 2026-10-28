/**
 * The one list of Help destinations, shared by the /help page's tabs and the Help drawer's
 * navigation row, so the two can never name or order them differently (John 2026-10-27:
 * the drawer's links used to sit in a footer under the screen's own text, and "Your data"
 * was repeated as a drawer tab on every screen).
 *
 * `key` is the `/help?tab=` name; the order is the /help page's tab order.
 */
export const HELP_SECTIONS = [
  { key: 'start', label: 'Start here' },
  { key: 'faq', label: 'FAQ' },
  // John 2026-10-28: After mission ahead of Your data.
  { key: 'after', label: 'After mission' },
  { key: 'data', label: 'Your data' },
  // John 2026-10-28: moved from second to near the end.
  { key: 'about', label: 'About' },
  // John 2026-10-27: was "Feedback"; it is also how to reach the maintainer privately.
  { key: 'feedback', label: 'Contact us' },
] as const

export type HelpSectionKey = typeof HELP_SECTIONS[number]['key']

/** The Tour Guide, a separate static page (tools/tour) the service worker serves offline. */
export const TOUR_URL = '/tour/'
