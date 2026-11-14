import { boardCause } from './board-causes'

/**
 * E-216 slice 2: "Test connection". Pure: given what the device could find out, name the most likely cause.
 * The fetches themselves are in `shared/services/command-post-publish.service.ts`. The sentences come from the
 * shared list (`board-causes.json`), so the app, the server and the viewer say the same thing.
 *
 * A browser cannot see WHY a request failed, so the fast/slow split below is a guess; the cause sentences say
 * "most likely" and name the next suspect rather than state a cause as fact.
 */

/** The browser's local network permission for this site: the Chrome prompt for public sites reaching private addresses. */
export type LocalNetworkPermission = 'granted' | 'denied' | 'prompt' | 'unknown'

/** What asking the Board `GET /api/hello` came to. */
export type HelloResult =
  | { kind: 'ok', name: string }
  | { kind: 'not-board' }
  | { kind: 'failed', elapsedMs: number }
  | { kind: 'timeout' }

export type BoardDiagnosis = {
  ok: boolean
  /** The id in board-causes.json; absent when connected. */
  cause?: string
  /** One sentence for the scribe. */
  message: string
  /** The technical line for whoever is helping (shown under "Details"). */
  detail: string
  /** The Board's name, when it answered. */
  name?: string
}

/** A failure faster than this is most likely a certificate not yet accepted (or nothing running); slower, a network problem. */
export const QUICK_FAIL_MS = 3000

/**
 * `host` is the host the scribe typed (`rangertrak-board.local`, `10.0.0.156`, `10.0.0.156:8080`), when known.
 * E-289: the success sentence names that, not the Board's .local name, which the scribe may not have used; and a
 * failure at a .local name says the name itself may be the problem (it failed between a wired and a Wi-Fi computer
 * on the same home router), since a name that is not found fails as fast as an unaccepted certificate.
 */
export function diagnoseBoard(f: { online: boolean, localNetwork: LocalNetworkPermission, hello: HelloResult, host?: string }): BoardDiagnosis {
  const fail = (cause: string, values: Record<string, string> = {}): BoardDiagnosis => ({ ok: false, cause, ...boardCause(cause, values) })
  if (!f.online) return fail('no-network')
  if (f.localNetwork === 'denied') return fail('blocked-by-browser')
  const localName = !!f.host && /\.local(:\d+)?$/i.test(f.host)
  switch (f.hello.kind) {
    case 'ok':
      return {
        ok: true,
        message: `Connected to the Board at ${f.host || f.hello.name || 'that address'}.`,
        detail: `The Board answered and identified itself as a RangerTrak Board${f.hello.name ? ` (${f.hello.name})` : ''}.`,
        name: f.hello.name,
      }
    case 'not-board':
      return fail('not-a-board')
    case 'failed':
    case 'timeout':
      if (localName) return fail('local-name-failed', { host: f.host! })
      return fail(f.hello.kind === 'failed' && f.hello.elapsedMs < QUICK_FAIL_MS ? 'certificate-not-accepted' : 'different-network')
  }
}
