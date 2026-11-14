import { boardCause, boardCauseIds } from './board-causes'
import type { HelloResult, LocalNetworkPermission } from './board-diagnosis'
import { QUICK_FAIL_MS, diagnoseBoard } from './board-diagnosis'

const base = { online: true, localNetwork: 'unknown' as LocalNetworkPermission }
const ok: HelloResult = { kind: 'ok', name: 'rangertrak-board.local' }

describe('diagnoseBoard (E-216)', () => {
  it('offline is no-network, before anything else', () => {
    const d = diagnoseBoard({ online: false, localNetwork: 'denied', hello: ok })
    expect(d.ok).toBe(false)
    expect(d.cause).toBe('no-network')
    expect(d.message).toBe(boardCause('no-network').message)
  })

  it('a denied local network permission is blocked-by-browser, even when a reply was somehow seen', () => {
    expect(diagnoseBoard({ ...base, localNetwork: 'denied', hello: ok }).cause).toBe(
      'blocked-by-browser'
    )
    expect(
      diagnoseBoard({ ...base, localNetwork: 'denied', hello: { kind: 'timeout' } }).cause
    ).toBe('blocked-by-browser')
  })

  it('granted, prompt and unknown permission do not stand in the way', () => {
    for (const localNetwork of [
      'granted',
      'prompt',
      'unknown',
    ] as LocalNetworkPermission[]) {
      expect(diagnoseBoard({ online: true, localNetwork, hello: ok }).ok).toBe(true)
    }
  })

  it('the right signature is connected, and names the address the scribe typed (E-289)', () => {
    const d = diagnoseBoard({ ...base, hello: ok, host: '10.0.0.156' })
    expect(d.ok).toBe(true)
    expect(d.cause).toBeUndefined()
    expect(d.name).toBe('rangertrak-board.local')
    expect(d.message).toBe('Connected to the Board at 10.0.0.156.')
    expect(d.detail).toContain('rangertrak-board.local')
    expect(diagnoseBoard({ ...base, hello: ok }).message).toBe('Connected to the Board at rangertrak-board.local.')
  })

  it('a failure at a .local name says the name may be the problem and points to the numbered address (E-289)', () => {
    for (const hello of [{ kind: 'failed', elapsedMs: 40 }, { kind: 'timeout' }] as HelloResult[]) {
      const d = diagnoseBoard({ ...base, hello, host: 'rangertrak-board.local' })
      expect(d.cause).toBe('local-name-failed')
      expect(d.message).toContain("couldn't reach rangertrak-board.local")
      expect(d.message).toContain('address made of numbers')
    }
    expect(diagnoseBoard({ ...base, hello: { kind: 'timeout' }, host: 'rangertrak-board-2.local:8080' }).cause).toBe('local-name-failed')
    expect(diagnoseBoard({ ...base, hello: { kind: 'failed', elapsedMs: 40 }, host: '10.0.0.156' }).cause).toBe('certificate-not-accepted')
  })

  it('an answer without the signature is not-a-board', () => {
    const d = diagnoseBoard({ ...base, hello: { kind: 'not-board' } })
    expect(d.cause).toBe('not-a-board')
    expect(d.ok).toBe(false)
  })

  it('a fast failure is most likely the certificate; a slow failure or a timeout is most likely the network', () => {
    expect(
      diagnoseBoard({ ...base, hello: { kind: 'failed', elapsedMs: 40 } }).cause
    ).toBe('certificate-not-accepted')
    expect(
      diagnoseBoard({ ...base, hello: { kind: 'failed', elapsedMs: QUICK_FAIL_MS - 1 } })
        .cause
    ).toBe('certificate-not-accepted')
    expect(
      diagnoseBoard({ ...base, hello: { kind: 'failed', elapsedMs: QUICK_FAIL_MS } })
        .cause
    ).toBe('different-network')
    expect(diagnoseBoard({ ...base, hello: { kind: 'timeout' } }).cause).toBe(
      'different-network'
    )
  })

  it('the failure sentences say "most likely", and the network one names VPN and firewall as next suspects in its details', () => {
    const quick = diagnoseBoard({ ...base, hello: { kind: 'failed', elapsedMs: 10 } })
    const slow = diagnoseBoard({ ...base, hello: { kind: 'timeout' } })
    expect(quick.message).toMatch(/^Most likely/)
    expect(slow.message).toMatch(/Most likely/)
    expect(slow.detail).toMatch(/VPN/)
    expect(slow.detail).toMatch(/firewall/i)
  })

  it('every message is plain words: no TLS, CORS, mDNS, port or HTTP', () => {
    for (const hello of [
      { kind: 'not-board' },
      { kind: 'timeout' },
      { kind: 'failed', elapsedMs: 1 },
    ] as HelloResult[]) {
      expect(diagnoseBoard({ ...base, hello }).message).not.toMatch(
        /\b(TLS|CORS|mDNS|port|HTTPS?)\b/i
      )
    }
    expect(
      diagnoseBoard({ online: false, localNetwork: 'unknown', hello: ok }).message
    ).not.toMatch(/\b(TLS|CORS|mDNS|port|HTTPS?)\b/i)
  })
})

describe('board causes list (E-216)', () => {
  it('has every cause the scoping names, each with an anchor', () => {
    const ids = boardCauseIds()
    for (const id of [
      'no-network',
      'different-network',
      'firewall-public',
      'port-taken',
      'node-too-old',
      'not-built',
      'certificate-not-accepted',
      'blocked-by-browser',
      'vpn-or-shield',
      'wrong-address',
      'not-a-board',
      'board-lost',
      'scribe-quiet',
      'phone-left-wifi',
      'laptop-asleep',
    ]) {
      expect(ids).toContain(id)
      expect(boardCause(id, { time: '12:04', minutes: 6 }).anchor).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('fills placeholders and drops an optional clause with no value', () => {
    expect(boardCause('board-lost', { time: '12:04', ssid: 'CERT-Net' }).message).toBe(
      'Lost the Board at 12:04. Still on CERT-Net? Is the Board laptop awake?'
    )
    expect(boardCause('board-lost', { time: '12:04' }).message).toBe(
      'Lost the Board at 12:04. Is the Board laptop awake?'
    )
    expect(boardCause('scribe-quiet', { minutes: 6 }).message).toBe(
      "The Board is fine. The scribe's device last checked in 6 min ago."
    )
    expect(() => boardCause('nope')).toThrowError(/Unknown Board cause/)
  })
})
