import type { GuideEntry } from './guide-content'
import type { HelpIndexEntry } from './help-index.generated'
import { HELP_SECTIONS } from './help-sections'

/**
 * E-264 (tester, 2026-10-28): search the documentation, with no connection. Pure functions over
 * two sources: the /help tabs (HELP_INDEX, generated from their templates by
 * tools/help-index/build.js) and every screen's Guide text (GUIDE_CONTENT). E-256's 404 page
 * reuses it to suggest where a reader meant to go.
 *
 * Every word typed must appear (as the start of a word) in a section's heading or text; a hit
 * in the heading counts for more. No fuzzy matching: a wrong result is worse than none.
 */

export interface HelpHit {
  heading: string
  /** Where it lives, for the reader: "Help › FAQ" or "Map screen". */
  where: string
  /** A plain-text excerpt around the first match, split so the matched words can be marked. */
  snippet: { text: string, match: boolean }[]
  /** Help tab sections: a link to `/help?tab=…#anchor`. */
  helpTab?: string
  anchor?: string
  /** Guide sections: the screen to go to, and the drawer tab to open there. */
  route?: string
  guideTab?: string
  score: number
}

/** Must match slug() in tools/help-index/build.js: anchors for headings without an id. */
export function slugForHelp(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '')
}

/** Lower-case words of two letters or more, accents folded, so "Cafe" finds "Café". */
export function searchWords(query: string): string[] {
  return [...new Set(fold(query).split(/[^a-z0-9]+/).filter(w => w.length >= 2))]
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function countStarts(haystack: string, word: string): number {
  let n = 0
  const re = new RegExp(`(?:^|[^a-z0-9])${word}`, 'g')
  while (re.exec(haystack)) n++
  return n
}

const SNIPPET_BEFORE = 60
const SNIPPET_LENGTH = 200

/** Cuts an excerpt around the first matching word and splits out every match inside it. */
export function snippetFor(text: string, words: readonly string[]): HelpHit['snippet'] {
  const folded = fold(text)
  // fold() keeps one character per character for the Latin text Help is written in, so
  // positions in `folded` are positions in `text`. Guard anyway: fall back to no marks.
  const sameLength = folded.length === text.length
  let first = -1
  for (const w of words) {
    const m = new RegExp(`(?:^|[^a-z0-9])(${w})`).exec(folded)
    if (m) {
      const at = m.index + m[0].length - w.length
      if (first < 0 || at < first) first = at
    }
  }
  let start = Math.max(0, first - SNIPPET_BEFORE)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < first) start = space + 1
  }
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  const piece = text.slice(start, end)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  if (!sameLength || !words.length) return [{ text: prefix + piece + suffix, match: false }]

  const foldedPiece = folded.slice(start, end)
  const re = new RegExp(`(?<![a-z0-9])(${words.join('|')})[a-z0-9]*`, 'g')
  const parts: HelpHit['snippet'] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(foldedPiece))) {
    if (m.index > last) parts.push({ text: piece.slice(last, m.index), match: false })
    parts.push({ text: piece.slice(m.index, m.index + m[0].length), match: true })
    last = m.index + m[0].length
  }
  if (last < piece.length) parts.push({ text: piece.slice(last), match: false })
  if (prefix) parts.unshift({ text: prefix, match: false })
  if (suffix) parts.push({ text: suffix, match: false })
  return parts
}

function score(heading: string, text: string, words: readonly string[]): number {
  const h = fold(heading)
  const t = fold(text)
  let total = 0
  for (const w of words) {
    const inHeading = countStarts(h, w)
    const inText = countStarts(t, w)
    if (!inHeading && !inText) return 0
    total += inHeading * 5 + Math.min(inText, 5)
  }
  return total
}

const TAB_LABEL: Record<string, string> = Object.fromEntries(HELP_SECTIONS.map(s => [s.key, s.label]))

/** Searches both sources; best first, at most `limit`. An empty or one-letter query finds nothing. */
export function searchHelp(
  query: string,
  helpIndex: readonly HelpIndexEntry[],
  guide: Record<string, GuideEntry>,
  limit = 20,
): HelpHit[] {
  const words = searchWords(query)
  if (!words.length) return []
  const hits: HelpHit[] = []

  for (const e of helpIndex) {
    const s = score(e.heading, e.text, words)
    if (s) {
      hits.push({
        heading: e.heading, where: `Help › ${TAB_LABEL[e.tab] ?? e.tab}`,
        snippet: snippetFor(e.text || e.heading, words), helpTab: e.tab, anchor: e.anchor, score: s,
      })
    }
  }

  // The same Keyboard tab appears on more than one screen; list it once, on the first.
  const seen = new Set<string>()
  for (const [route, entry] of Object.entries(guide)) {
    for (const tab of entry.tabs) {
      for (const b of tab.blocks) {
        const text = [b.text ?? '', ...(b.bullets ?? [])].join(' ')
        const key = b.heading + '\u0000' + text
        if (seen.has(key)) continue
        seen.add(key)
        const s = score(b.heading, text, words)
        if (s) {
          hits.push({
            heading: b.heading, where: `${entry.screen} screen`,
            snippet: snippetFor(text || b.heading, words), route, guideTab: tab.label, score: s,
          })
        }
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
