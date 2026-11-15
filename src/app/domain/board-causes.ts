import causes from './board-causes.json'

/**
 * E-216 slice 2: the one list of "why can't I reach RangerView" causes. The same JSON is read by the mini web server
 * server (`tools/board/causes.js`), and its two viewer sentences are copied into `src/command-post-view/index.html`
 * (plain static JS, cannot import), where `tools/board/causes.test.js` fails if they drift.
 *
 * `message` is the plain sentence. `{name}` placeholders are filled from `values`; `[[ ... ]]` marks a clause that
 * is dropped when any placeholder inside it has no value. `detail` is the technical line for whoever is helping.
 * `anchor` is the heading slug on the Guide page ("Can't reach RangerView?", slice 3).
 */
export type BoardCauseEntry = {
  id: string
  seenFrom: string[]
  message: string
  detail: string
  anchor: string
}

export type BoardCauseValues = Record<string, string | number | undefined>

export type BoardCause = { message: string, detail: string, anchor: string }

const ALL = causes as BoardCauseEntry[]

/** Fills `{placeholders}`; an `[[optional clause]]` is dropped when a placeholder inside has no value. Same rule as tools/board/causes.js. */
export function fillCause(template: string, values: BoardCauseValues = {}): string {
  const has = (k: string) => values[k] !== undefined && values[k] !== ''
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (_m, k: string) => has(k) ? String(values[k]) : '')
  return sub(template.replace(/\[\[(.*?)\]\]/g, (_m, inner: string) =>
    [...inner.matchAll(/\{(\w+)\}/g)].every(m => has(m[1])) ? inner : ''))
}

export function boardCauseIds(): string[] {
  return ALL.map(c => c.id)
}

/** The cause with this id, its placeholders filled. Throws on an id that is not in the list (a typo is a bug). */
export function boardCause(id: string, values: BoardCauseValues = {}): BoardCause {
  const c = ALL.find(x => x.id === id)
  if (!c) throw new Error(`Unknown RangerView cause "${id}"`)
  return { message: fillCause(c.message, values), detail: fillCause(c.detail, values), anchor: c.anchor }
}
