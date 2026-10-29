/**
 * E-256 (John 10-28): the 404 page guesses where the reader meant to go. Pure, so the spec can
 * run every case without a browser. Each destination lists its own words: the route name, the
 * nav label, and old names (`reports`, `settings` and `entry` are redirects in app.routes.ts).
 */

export interface RouteGuess {
  route: string
  label: string
}

// Words as one string each: tools/icon-font/scan.js reads every quoted lower-case word as a
// possible icon name, and the word home is one the font subset leaves out.
const DESTINATIONS: readonly (RouteGuess & { words: string })[] = [
  { route: '/', label: 'Entry', words: 'entry home index report new add start' },
  { route: '/radio-log', label: 'Radio Log', words: 'radio log radiolog reports 309 ics309' },
  { route: '/map', label: 'Map', words: 'map maps leaflet maplibre places locations' },
  { route: '/rangers', label: 'Rangers', words: 'rangers ranger roster people team teams members' },
  { route: '/mission', label: 'Mission', words: 'mission settings setup prep config board backup' },
  { route: '/after-action', label: 'AAR notes', words: 'after action aar notes 214 ics214' },
  { route: '/summary', label: 'Mission summary', words: 'summary' },
  { route: '/messages', label: 'Messages', words: 'messages message msg' },
  { route: '/help', label: 'Help', words: 'help about faq docs documentation guide manual' },
]

/** The words of a path, for matching and for the 404 page's search box. */
export function pathWords(path: string): string[] {
  let p = path.split('?')[0].split('#')[0]
  try { p = decodeURIComponent(p) } catch { /* keep it as typed */ }
  return p.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2)
}

/** Levenshtein distance, stopping early once it is past `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

function wordScore(typed: string, known: string): number {
  if (typed === known) return 3
  if (typed.length >= 3 && known.length >= 3 && (known.startsWith(typed) || typed.startsWith(known))) return 2
  if (typed.length >= 4 && distance(typed, known, 2) <= (typed.length >= 7 ? 2 : 1)) return 1
  return 0
}

/** Up to `limit` destinations that look like what the path meant, best first. */
export function guessRoutes(path: string, limit = 3): RouteGuess[] {
  const typed = pathWords(path)
  return DESTINATIONS
    .map(d => ({ d, score: typed.reduce((sum, t) => sum + Math.max(0, ...d.words.split(' ').map(k => wordScore(t, k))), 0) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ d }) => ({ route: d.route, label: d.label }))
}
