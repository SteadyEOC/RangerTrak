// Plain node:test - no framework, no build step. `npm run test:worker` (node --test
// worker/) runs this directly; nothing here touches Angular's Karma suite. worker/
// carries its own package.json ({"type":"module"}) since the repo root package.json has
// no "type" field (defaults CommonJS) but this file needs `import`/`export default`, the
// same syntax worker/index.js itself uses and Wrangler expects.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import worker from './index.js'

function req(body, { method = 'POST', path = '/api/feedback' } = {}) {
  return new Request(`https://rangertrak.org${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

test('rejects a non-POST method', async () => {
  const res = await worker.fetch(req(undefined, { method: 'GET' }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 405)
})

test('rejects invalid JSON', async () => {
  const badReq = new Request('https://rangertrak.org/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json{{{',
  })
  const res = await worker.fetch(badReq, { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400)
})

test('rejects an empty message', async () => {
  const res = await worker.fetch(req({ message: '   ' }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400)
})

test('rejects a message over the length cap', async () => {
  const res = await worker.fetch(req({ message: 'x'.repeat(4001) }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400)
})

test('fails closed (503) when the GitHub token secret is not configured, never calling GitHub', async (t) => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('should not be called') }
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(req({ message: 'hello' }), {})
  assert.equal(res.status, 503)
  assert.equal(called, false)
})

test('creates a labeled GitHub issue and returns its URL on success', async (t) => {
  const originalFetch = globalThis.fetch
  let capturedInit
  globalThis.fetch = async (url, init) => {
    capturedInit = { url, ...init }
    return new Response(JSON.stringify({ html_url: 'https://github.com/SteadyEOC/RangerTrak/issues/42' }), { status: 201 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(
    req({ message: 'The map is upside down\nMore detail here.', contact: 'scribe@example.com' }),
    { GITHUB_FEEDBACK_TOKEN: 'secret-token' }
  )
  assert.equal(res.status, 201)
  const json = await res.json()
  assert.equal(json.url, 'https://github.com/SteadyEOC/RangerTrak/issues/42')

  assert.equal(capturedInit.url, 'https://api.github.com/repos/SteadyEOC/RangerTrak/issues')
  assert.equal(capturedInit.headers['Authorization'], 'Bearer secret-token')
  const sentBody = JSON.parse(capturedInit.body)
  assert.equal(sentBody.title, 'Feedback: The map is upside down')
  assert.match(sentBody.body, /The map is upside down/)
  assert.match(sentBody.body, /scribe@example\.com/)
  assert.deepEqual(sentBody.labels, ['feedback'])
})

test('never leaks the GitHub API response body to the client on failure', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"message":"Bad credentials"}', { status: 401 })
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(req({ message: 'hello' }), { GITHUB_FEEDBACK_TOKEN: 'bad-token' })
  assert.equal(res.status, 502)
  const json = await res.json()
  assert.doesNotMatch(JSON.stringify(json), /Bad credentials/)
})

test('.pmtiles requests still pass through the existing Range shim, unaffected by /api routing', async () => {
  const assetBody = new Uint8Array([1, 2, 3, 4, 5])
  const env = {
    ASSETS: {
      fetch: async () => new Response(assetBody, { status: 200 }),
    },
  }
  const rangeReq = new Request('https://rangertrak.org/assets/maps/world-vashon.pmtiles', {
    headers: { Range: 'bytes=1-3' },
  })
  const res = await worker.fetch(rangeReq, env)
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('Content-Range'), 'bytes 1-3/5')
})

test('a 206 partial response is never cacheable, even though the full-file 200 is', async () => {
  // Belt-and-braces on top of Cloudflare's own documented behaviour (Workers Caching
  // never stores a Worker-returned 206) - see the comment above the Range-handling code
  // in worker/index.js and "Abuse and cost hardening" item 5 in DEPLOYING.md.
  const env = { ASSETS: { fetch: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }) } }
  const rangeReq = new Request('https://rangertrak.org/assets/maps/world-vashon.pmtiles', {
    headers: { Range: 'bytes=1-3' },
  })
  const res = await worker.fetch(rangeReq, env)
  assert.equal(res.status, 206)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
})

test('the full-file (no Range) response stays long-cacheable, for Cloudflare to slice from', async () => {
  const env = { ASSETS: { fetch: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }) } }
  const res = await worker.fetch(new Request('https://rangertrak.org/assets/maps/world-vashon.pmtiles'), env)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('Cache-Control'), /immutable/)
})

// --- CORS for the rangertrak.com front-door site (E-101 / ADR D-41) -------------------
// The .com site's feedback page posts to this same endpoint cross-origin. These lock in
// that the allowlist is an allowlist: a wildcard here would be invisible in the browser
// but would let any site file issues under the maintainer's token.

const DOT_COM = 'https://rangertrak.com'

function preflight(origin) {
  return new Request('https://rangertrak.org/api/feedback', {
    method: 'OPTIONS',
    headers: origin
      ? { 'Origin': origin, 'Access-Control-Request-Method': 'POST' }
      : { 'Access-Control-Request-Method': 'POST' },
  })
}

test('preflight from rangertrak.com is allowed, and echoes only that origin', async () => {
  const res = await worker.fetch(preflight(DOT_COM), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), DOT_COM)
  assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/)
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/)
  assert.equal(res.headers.get('Vary'), 'Origin')
})

test('preflight from an unlisted origin is refused, with no CORS headers', async () => {
  const res = await worker.fetch(preflight('https://evil.example'), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 403)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
})

test('preflight is never answered with a wildcard', async () => {
  const res = await worker.fetch(preflight(DOT_COM), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.notEqual(res.headers.get('Access-Control-Allow-Origin'), '*')
})

test('a real POST from rangertrak.com carries the CORS header through', async () => {
  // 400 (empty message) is enough: the header must ride on error responses too, or the
  // browser hides the status and the page cannot tell "rejected" from "unreachable".
  const withOrigin = new Request('https://rangertrak.org/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': DOT_COM },
    body: JSON.stringify({ message: '   ' }),
  })
  const res = await worker.fetch(withOrigin, { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), DOT_COM)
})

test('the in-app same-origin POST is unchanged - no Origin, no CORS headers', async () => {
  const res = await worker.fetch(req({ message: '   ' }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null)
})

// --- Abuse and cost hardening, 2026-09-14 (ahead of a public blog series) --------------

// --- /api/feedback: per-IP rate limit (Q5 mitigation 4) --------------------------------

/** A stub Rate Limiting binding, the same shape as env.<BINDING>.limit({key}). */
function stubLimiter(allow) {
  const calls = []
  return {
    calls,
    async limit({ key }) {
      calls.push(key)
      return { success: allow }
    }
  }
}

test('a denied rate-limit check returns 429 and never calls GitHub', async (t) => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('should not be called') }
  t.after(() => { globalThis.fetch = originalFetch })

  const limiter = stubLimiter(false)
  const res = await worker.fetch(
    req({ message: 'hello' }, {}),
    { GITHUB_FEEDBACK_TOKEN: 'x', FEEDBACK_LIMITER: limiter }
  )
  assert.equal(res.status, 429)
  assert.equal(called, false)
  assert.deepEqual(limiter.calls, ['unknown']) // no CF-Connecting-IP in this synthetic Request
})

test('an allowed rate-limit check keys on CF-Connecting-IP and proceeds normally', async () => {
  const limiter = stubLimiter(true)
  const withIp = new Request('https://rangertrak.org/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.5' },
    body: JSON.stringify({ message: '' }),
  })
  const res = await worker.fetch(withIp, { GITHUB_FEEDBACK_TOKEN: 'x', FEEDBACK_LIMITER: limiter })
  assert.equal(res.status, 400) // empty message - proves the request reached normal validation
  assert.deepEqual(limiter.calls, ['203.0.113.5'])
})

test('a missing/misconfigured rate limiter degrades to "no limit", not a broken request', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ html_url: 'https://github.com/SteadyEOC/RangerTrak/issues/1' }), { status: 201 })
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(req({ message: 'hello' }), { GITHUB_FEEDBACK_TOKEN: 'x', FEEDBACK_LIMITER: {} })
  assert.notEqual(res.status, 429)
})

test('a rate limiter that throws degrades to "no limit" rather than 500ing', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ html_url: 'https://github.com/SteadyEOC/RangerTrak/issues/1' }), { status: 201 })
  t.after(() => { globalThis.fetch = originalFetch })

  const throwing = { limit: async () => { throw new Error('rate limiting service unreachable') } }
  const res = await worker.fetch(req({ message: 'hello' }), { GITHUB_FEEDBACK_TOKEN: 'x', FEEDBACK_LIMITER: throwing })
  assert.notEqual(res.status, 429)
  assert.notEqual(res.status, 500)
})

// --- /api/feedback: body size cap -------------------------------------------------------

test('a Content-Length over the cap is rejected before the body is read', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('should not be called') }
  t.after(() => { globalThis.fetch = originalFetch })

  const big = new Request('https://rangertrak.org/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': String(100 * 1024) },
    body: JSON.stringify({ message: 'hi' }),
  })
  const res = await worker.fetch(big, { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 413)
})

test('an oversized body with no Content-Length is still rejected (backstop)', async () => {
  const res = await worker.fetch(req({ message: 'x'.repeat(50000) }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 413)
})

// --- /api/feedback: honeypot ------------------------------------------------------------

test('a filled honeypot field returns a normal-looking success without calling GitHub', async (t) => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('should not be called') }
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(
    req({ message: 'hello', website: 'http://spam.example' }),
    { GITHUB_FEEDBACK_TOKEN: 'x' }
  )
  assert.equal(res.status, 201)
  const json = await res.json()
  assert.match(json.url, /github\.com\/SteadyEOC\/RangerTrak/)
  assert.equal(called, false)
})

test('an empty/absent honeypot field does not change existing behaviour', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ html_url: 'https://github.com/SteadyEOC/RangerTrak/issues/1' }), { status: 201 })
  t.after(() => { globalThis.fetch = originalFetch })

  const res = await worker.fetch(req({ message: 'hello', website: '   ' }), { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 201)
})

test('null JSON body does not crash the honeypot/message extraction', async () => {
  const nullBody = new Request('https://rangertrak.org/api/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
  })
  const res = await worker.fetch(nullBody, { GITHUB_FEEDBACK_TOKEN: 'x' })
  assert.equal(res.status, 400) // "message is required" - not a 500
})

// --- /assets/maps/*.pmtiles: hotlink protection -----------------------------------------

function pmtilesReq(headers = {}) {
  return new Request('https://rangertrak.org/assets/maps/world-vashon.pmtiles', { headers })
}

function assetsEnv() {
  return { ASSETS: { fetch: async () => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }) } }
}

test('a request with no Origin and no Referer is allowed (same-origin PWA/service worker)', async () => {
  const res = await worker.fetch(pmtilesReq(), assetsEnv())
  assert.equal(res.status, 200)
})

test('a Referer on rangertrak.org is allowed', async () => {
  const res = await worker.fetch(pmtilesReq({ Referer: 'https://rangertrak.org/map' }), assetsEnv())
  assert.equal(res.status, 200)
})

test('a Referer on rangertrak.com is allowed (front-door site)', async () => {
  const res = await worker.fetch(pmtilesReq({ Referer: 'https://rangertrak.com/' }), assetsEnv())
  assert.equal(res.status, 200)
})

test('a Referer on localhost is allowed (local dev)', async () => {
  const res = await worker.fetch(pmtilesReq({ Referer: 'http://localhost:4200/map' }), assetsEnv())
  assert.equal(res.status, 200)
})

test('a Referer on an unrelated site is refused with 403, uncached', async () => {
  const res = await worker.fetch(pmtilesReq({ Referer: 'https://someone-elses-map.example/' }), assetsEnv())
  assert.equal(res.status, 403)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
})

test('an Origin on an unrelated site is refused even with no Referer', async () => {
  const res = await worker.fetch(pmtilesReq({ Origin: 'https://someone-elses-map.example' }), assetsEnv())
  assert.equal(res.status, 403)
})

// --- /regions/: prepared-but-inert R2 path ----------------------------------------------

test('regions path 404s cleanly when env.MAPS is not bound (today, in production)', async () => {
  const res = await worker.fetch(
    new Request('https://rangertrak.org/regions/king-county.pmtiles'), {}
  )
  assert.equal(res.status, 404)
})

function stubBucket(objects) {
  return { async get(key) { return objects[key] ?? null } }
}

test('serves a whole-file download when env.MAPS is bound and the referrer is allowed', async () => {
  const bytes = new Uint8Array([9, 8, 7, 6])
  const env = { MAPS: stubBucket({ 'king-county.pmtiles': { body: bytes, size: bytes.byteLength } }) }
  const res = await worker.fetch(
    new Request('https://rangertrak.org/regions/king-county.pmtiles', { headers: { Referer: 'https://rangertrak.org/map' } }),
    env
  )
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Content-Disposition'), 'attachment; filename="king-county.pmtiles"')
  assert.match(res.headers.get('X-Attribution'), /OpenStreetMap/)
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=604800')
  const body = new Uint8Array(await res.arrayBuffer())
  assert.deepEqual([...body], [9, 8, 7, 6])
})

test('regions path still enforces hotlink protection', async () => {
  const env = { MAPS: stubBucket({}) }
  const res = await worker.fetch(
    new Request('https://rangertrak.org/regions/king-county.pmtiles', { headers: { Referer: 'https://someone-elses-map.example/' } }),
    env
  )
  assert.equal(res.status, 403)
})

test('regions path still enforces the per-IP rate limit', async () => {
  const limiter = stubLimiter(false)
  const env = { MAPS: stubBucket({ 'x.pmtiles': { body: new Uint8Array([1]), size: 1 } }), MAPS_LIMITER: limiter }
  const res = await worker.fetch(new Request('https://rangertrak.org/regions/x.pmtiles'), env)
  assert.equal(res.status, 429)
})

test('an unknown region key 404s', async () => {
  const env = { MAPS: stubBucket({}) }
  const res = await worker.fetch(new Request('https://rangertrak.org/regions/nope.pmtiles'), env)
  assert.equal(res.status, 404)
})

test('a path-traversal-shaped region key is refused as not found, never reaching R2', async () => {
  let getCalled = false
  const env = { MAPS: { async get() { getCalled = true; return null } } }
  const res = await worker.fetch(new Request('https://rangertrak.org/regions/..%2Fsecrets.pmtiles'), env)
  assert.equal(res.status, 404)
  assert.equal(getCalled, false)
})

test('a non-GET method on the regions path is rejected', async () => {
  const env = { MAPS: stubBucket({}) }
  const res = await worker.fetch(
    new Request('https://rangertrak.org/regions/x.pmtiles', { method: 'POST' }), env
  )
  assert.equal(res.status, 405)
})
