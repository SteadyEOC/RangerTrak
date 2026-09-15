/**
 * Range-request shim for the PMTiles basemap.
 *
 * Cloudflare Workers static assets do not honour HTTP Range: a request for a byte
 * slice comes back 200 with the whole file and no Accept-Ranges. The pmtiles
 * library reads its header and directory by byte range, so on the live site the
 * offline map failed with "Server returned no content-length header or
 * content-length exceeding request. Check that your storage backend supports HTTP
 * Byte Serving." and rendered blank. DEVELOPING.md has always listed range support
 * as a hosting requirement; this is what satisfies it here.
 *
 * Only /assets/maps/*.pmtiles is routed through this Worker (`run_worker_first` in
 * wrangler.jsonc). Every other request is served straight from the asset store, so
 * the fast path is untouched.
 *
 * The file is a few MB, so buffering it to slice is well within a Worker's memory. If
 * the basemap ever grows past a few tens of MB, move it to R2, which does byte serving
 * natively, rather than raising the buffer.
 *
 * A replaced map file needs a NEW filename, not new bytes at the old one - see
 * DEPLOYING.md, "A replaced map file needs a new filename". The `immutable` directive
 * below means every browser and edge cache that already has the old filename will
 * believe it for up to a year.
 */

const PMTILES_HEADERS = {
  'Content-Type': 'application/octet-stream',
  'Accept-Ranges': 'bytes',
  // Content-addressed by build: the filename changes when the map data changes.
  // Combined with `cache.enabled` in wrangler.jsonc, this is also what lets a repeat
  // request for the same file be served by Cloudflare's edge cache WITHOUT
  // re-invoking this Worker at all - see "Abuse and cost hardening" below.
  'Cache-Control': 'public, max-age=31536000, immutable'
}

// ---------------------------------------------------------------------------------------
// Abuse and cost hardening (2026-09-14), ahead of a public blog series that will send
// unfamiliar traffic to this Worker for the first time. Four things changed:
//
// 1. Per-IP rate limiting on /api/feedback (below), via the Workers Rate Limiting
//    binding. A missing binding (older wrangler locally, `wrangler dev` without it
//    configured) degrades to "no limit" rather than failing the request - abuse
//    protection should never be the reason a real submitter's feedback is lost.
// 2. Hotlink protection on map files (Origin/Referer allowlist) - weak by design (a
//    non-browser client can omit both headers and sail through) but it stops the easy
//    case: another site embedding our basemap or a regional download directly.
// 3. `cache.enabled` in wrangler.jsonc (Workers Caching, RFC 9111 semantics): once a map
//    response is cached at a Cloudflare edge location, a repeat request for that exact
//    URL is served without running this Worker at all - no CPU billed, and once R2 is in
//    the picture, no R2 read either.
//
//    KNOWN LIMITATION, accepted deliberately: mitigation 3 is unconditional on
//    mitigation 2. The Referer/Origin check in isAllowedMapReferrer() only runs when
//    this Worker is invoked, which on a cache HIT it is not - Cloudflare answers from
//    the edge before any of this file's code runs. So the check only ever gates the
//    request that *populates* the cache at a given edge location; after that, anyone
//    hitting the warm entry - including a hotlinker - gets served for free. That's
//    intentional: a cache hit costs ~nothing, so letting anyone ride a warm cache IS
//    mitigation 3 working, not a hole in mitigation 2. Full writeup in DEPLOYING.md,
//    "Abuse and cost hardening" item 4.
//
//    Range requests interact with this in a way that is easy to get backwards - see the
//    comment above the Range-handling code near the bottom of this file for what
//    Cloudflare's docs actually say and why this Worker's hand-rolled 206 branch is safe
//    either way.
//
// 4. A prepared-but-inert whole-file download path for pre-cut regional maps from an
//    R2 bucket, active only once `env.MAPS` is bound (it is not, yet - see
//    DEPLOYING.md for the one-time setup).
//
// Responses that must never be cached (errors, anything depending on Origin/Referer, the
// feedback endpoint, this file's own 206 responses) say so explicitly with
// `Cache-Control: no-store` rather than relying on Cloudflare's default non-GET/error
// heuristics.
// ---------------------------------------------------------------------------------------

/** A request's caller, for rate-limiting purposes. Always set by Cloudflare's edge. */
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown'
}

/**
 * Runs a Workers Rate Limiting binding, if one is configured. Returns true when the
 * caller should be refused. A missing/misconfigured binding, or the rate-limiting
 * service itself erroring, both resolve to "not limited" - see the note above.
 */
async function isRateLimited(limiter, key) {
  if (!limiter || typeof limiter.limit !== 'function') {
    return false
  }
  try {
    const { success } = await limiter.limit({ key })
    return !success
  } catch (err) {
    console.error(`Rate limiter check failed, allowing the request through: ${err}`)
    return false
  }
}

const MAP_ALLOWED_HOSTS = new Set([
  'rangertrak.org',
  'rangertrak.com',
  'localhost',
  '127.0.0.1'
])

/**
 * Hotlink protection for map files served through Worker code (mitigation 2). No
 * Origin and no Referer is explicitly ALLOWED, not treated as suspicious: that shape
 * covers the installed PWA's own same-origin fetches (browsers often omit Referer for
 * same-origin requests depending on Referrer-Policy), a service worker replaying a
 * fetch, and direct downloads/CLI tools - all legitimate. Blocking on absence would
 * break offline use for real users, which is worse than the abuse this slows down.
 */
function isAllowedMapReferrer(request) {
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  if (!origin && !referer) {
    return true
  }
  const hostAllowed = (value) => {
    if (!value) {
      return false
    }
    try {
      return MAP_ALLOWED_HOSTS.has(new URL(value).hostname)
    } catch {
      return false
    }
  }
  return hostAllowed(origin) || hostAllowed(referer)
}

function forbidden() {
  return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } })
}

/**
 * ADR D-15: in-app feedback, primary path. Creates a labeled GitHub issue on the public
 * repo from a POSTed { message, contact? } body - decided 2026-08-20 (maintainer: "public
 * issues, as-is... standard for an open-source project"), so this deliberately does NOT
 * try to keep submissions private. The in-app form is responsible for telling the user
 * that up front, before they submit; this endpoint just does what it's told.
 *
 * Requires a `GITHUB_FEEDBACK_TOKEN` Worker secret - a GitHub PAT (fine-grained, scoped to
 * this repo only, Issues: Read and write) - set via
 * `wrangler secret put GITHUB_FEEDBACK_TOKEN`, never committed. Missing/invalid token
 * fails closed (503), which the frontend treats the same as "unreachable" and falls back
 * to a direct GitHub issue link - see feedback.component.ts.
 */
const GITHUB_REPO = 'EOCOnline/rangertrak'
const FEEDBACK_MESSAGE_MAX = 4000
const FEEDBACK_CONTACT_MAX = 200
// Comfortably above the max valid payload (message + contact, worst-case 4-byte UTF-8
// chars, plus JSON overhead and the honeypot field) so real submissions are never
// affected, but far below anything worth spending CPU/memory parsing as JSON.
const FEEDBACK_MAX_BODY_BYTES = 32 * 1024

async function handleFeedback(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  // Cheap reject before touching the body: a real client always sends Content-Length.
  const declaredLength = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declaredLength) && declaredLength > FEEDBACK_MAX_BODY_BYTES) {
    return jsonResponse({ error: 'request body too large' }, 413)
  }

  if (await isRateLimited(env.FEEDBACK_LIMITER, clientIp(request))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429)
  }

  let raw
  try {
    raw = await request.text()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  // Backstop for chunked bodies with no Content-Length header, so a malformed or
  // malicious huge payload never reaches JSON.parse.
  if (raw.length > FEEDBACK_MAX_BODY_BYTES) {
    return jsonResponse({ error: 'request body too large' }, 413)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }
  const body = parsed && typeof parsed === 'object' ? parsed : {}

  // Honeypot: a field real users never see or fill in (feedback.component.html renders
  // it visually hidden). Any non-empty value means a bot filled in every field it found.
  // Answer with an ordinary-looking success and file nothing, so scripted submitters get
  // no signal they were caught and the issue tracker never sees the spam.
  const honeypot = typeof body.website === 'string' ? body.website.trim() : ''
  if (honeypot) {
    return jsonResponse({ url: `https://github.com/${GITHUB_REPO}/issues` }, 201)
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const contact = typeof body.contact === 'string' ? body.contact.trim() : ''

  if (!message) {
    return jsonResponse({ error: 'message is required' }, 400)
  }
  if (message.length > FEEDBACK_MESSAGE_MAX) {
    return jsonResponse({ error: `message exceeds ${FEEDBACK_MESSAGE_MAX} characters` }, 400)
  }
  if (contact.length > FEEDBACK_CONTACT_MAX) {
    return jsonResponse({ error: `contact exceeds ${FEEDBACK_CONTACT_MAX} characters` }, 400)
  }

  if (!env.GITHUB_FEEDBACK_TOKEN) {
    return jsonResponse({ error: 'feedback endpoint not configured' }, 503)
  }

  // Title is the message's first line, truncated - GitHub issue titles are meant to be
  // short; the full message is always in the body regardless of how it truncates here.
  const firstLine = message.split('\n')[0].trim()
  const title = `Feedback: ${firstLine.length > 70 ? firstLine.slice(0, 67) + '...' : firstLine}`

  const issueBody = [
    message,
    '',
    '---',
    `Submitted via in-app feedback.`,
    `Contact: ${contact || '(not provided)'}`,
  ].join('\n')

  const ghResponse = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GITHUB_FEEDBACK_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      // GitHub's API rejects requests with no User-Agent.
      'User-Agent': 'rangertrak-feedback-worker',
    },
    body: JSON.stringify({ title, body: issueBody, labels: ['feedback'] }),
  })

  if (!ghResponse.ok) {
    // Never forward GitHub's own response body to the client - it can include detail
    // about the token/permissions. Logged (Observability is enabled) for the maintainer,
    // not shown to the submitter.
    console.error(`GitHub issue creation failed: ${ghResponse.status} ${await ghResponse.text()}`)
    return jsonResponse({ error: 'could not submit feedback' }, 502)
  }

  const issue = await ghResponse.json()
  return jsonResponse({ url: issue.html_url }, 201)
}

/**
 * CORS for the public marketing site (E-101 / ADR D-41).
 *
 * rangertrak.com serves the static front-door site from its own Worker, but its feedback
 * page posts to THIS endpoint - the same one the in-app form uses, so there is one code
 * path filing issues, not two. A browser will not make that cross-origin POST without a
 * preflight and a matching Access-Control-Allow-Origin, so without this the .com page
 * silently falls through to its GitHub-link fallback forever.
 *
 * Apex only, deliberately. www.rangertrak.com is redirect-only (DEPLOYING.md), so a page
 * is only ever served from the apex and the browser's Origin is only ever the apex.
 *
 * This does not widen the abuse surface: CORS restrains browsers, not clients. Any
 * non-browser caller could already POST here from anywhere, which is why the real limits
 * on this endpoint are the length caps, the honeypot, the per-IP rate limit and the
 * fail-closed token check above, not origin.
 */
const FEEDBACK_ALLOWED_ORIGINS = new Set([
  'https://rangertrak.com'
])

function feedbackCorsOrigin(request) {
  const origin = request.headers.get('Origin')
  return origin && FEEDBACK_ALLOWED_ORIGINS.has(origin) ? origin : null
}

/** Preflight. Content-Type: application/json is not CORS-safelisted, so this always fires. */
function handleFeedbackPreflight(request) {
  const origin = feedbackCorsOrigin(request)
  if (!origin) {
    return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      // Same URL answers differently per Origin; without this a cache could serve one
      // origin's headers to another.
      'Vary': 'Origin',
      'Cache-Control': 'no-store'
    }
  })
}

/** Copies an allowed Origin's CORS headers onto an already-built response. */
function withFeedbackCors(response, request) {
  const origin = feedbackCorsOrigin(request)
  if (!origin) {
    return response
  }
  const withCors = new Response(response.body, response)
  withCors.headers.set('Access-Control-Allow-Origin', origin)
  withCors.headers.set('Vary', 'Origin')
  return withCors
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    // Never cached: every one of these is either per-submitter, per-IP or time-sensitive
    // (rate limit, validation, fail-closed token check). See the hardening note up top.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

// ---------------------------------------------------------------------------------------
// Prepared-but-inert R2 path for pre-cut regional map files (mitigation 1: whole-file
// downloads, not Range serving, so one download is one read). Named testers first via
// unlisted /regions/<file>.pmtiles links (Q5 in the scoping doc), not a public listing.
//
// Inert until `env.MAPS` is bound - see DEPLOYING.md for the one-time R2 bucket setup and
// how to upload a region. Do NOT add an `r2_buckets` binding to wrangler.jsonc casually:
// the exact block to uncomment, with the bucket name John needs to create first, is
// documented there and at the bottom of this file's wrangler.jsonc.
// ---------------------------------------------------------------------------------------

const REGIONS_PREFIX = '/regions/'
// Plain filenames only - no path traversal, no nested keys.
const REGION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.pmtiles$/
const MAP_ATTRIBUTION = 'Map data © OpenStreetMap contributors, ODbL. Basemap by Protomaps.'

async function handleRegionDownload(request, pathname, env) {
  if (!env.MAPS) {
    // Prepared, not shipped: no bucket bound yet. A clear 404 rather than a crash.
    return jsonResponse({ error: 'regional map downloads are not available yet' }, 404)
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }
  if (!isAllowedMapReferrer(request)) {
    return forbidden()
  }

  const key = pathname.slice(REGIONS_PREFIX.length)
  if (!REGION_KEY_PATTERN.test(key)) {
    return jsonResponse({ error: 'not found' }, 404)
  }

  if (await isRateLimited(env.MAPS_LIMITER, clientIp(request))) {
    return jsonResponse({ error: 'too many requests, try again later' }, 429)
  }

  const object = await env.MAPS.get(key)
  if (!object) {
    return jsonResponse({ error: 'not found' }, 404)
  }

  const headers = new Headers()
  if (typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers)
  }
  headers.set('Content-Type', 'application/octet-stream')
  headers.set('Content-Length', String(object.size))
  headers.set('Content-Disposition', `attachment; filename="${key}"`)
  // A tester saves this once and loads it as a custom file - no need to byte-serve it,
  // and whole-file is what makes "one download = one R2 read" true (mitigation 1). R2
  // supports Range natively if that ever changes, unlike the hand-rolled shim above.
  headers.set('Cache-Control', 'public, max-age=604800')
  headers.set('X-Attribution', MAP_ATTRIBUTION)

  return new Response(object.body, { status: 200, headers })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/feedback') {
      if (request.method === 'OPTIONS') {
        return handleFeedbackPreflight(request)
      }
      return withFeedbackCors(await handleFeedback(request, env), request)
    }

    if (url.pathname.startsWith(REGIONS_PREFIX)) {
      return handleRegionDownload(request, url.pathname, env)
    }

    if (!url.pathname.endsWith('.pmtiles')) {
      return env.ASSETS.fetch(request)
    }

    if (!isAllowedMapReferrer(request)) {
      return forbidden()
    }

    // Ask the asset store for the whole object; it ignores Range anyway.
    const asset = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }))
    if (!asset.ok) {
      return asset
    }

    // --- Range requests vs. `cache.enabled` (wrangler.jsonc) -----------------------------
    // Confirmed against Cloudflare's own docs, not guessed: when Workers Caching is on,
    // Cloudflare strips the client's Range header before invoking a Worker, always asks
    // for the full body, caches that full 200 response, and does its OWN byte-range
    // slicing at the edge - a follow-up Range request for a different slice of the same
    // URL is served from that one cached full response, not from a previously cached
    // slice. ("Workers Caching serves Range requests from a cached full response... your
    // Worker returns a normal 200... Cloudflare stores that full response, and then
    // slices out the requested byte range." - developers.cloudflare.com/workers/cache/
    // configuration/, "Range requests")
    //
    // Concretely: in production, with caching enabled, `range` below will usually be null
    // even for a pmtiles-js byte-range read, because Cloudflare already stripped it before
    // this code ran - the branch below that builds a 206 by hand is then simply not
    // reached for the common case, and Cloudflare's own slicing (plus, on a hit, no
    // Worker invocation at all) handles it instead.
    //
    // The hand-rolled 206 branch stays as a fallback for anywhere that doesn't strip
    // Range (`wrangler dev`, a future change to `cache.enabled`, direct testing). It is
    // safe even then: Cloudflare's docs are explicit that "if your Worker returns a 206
    // response of its own... Cloudflare treats it as an uncacheable response and it is
    // not stored" - so there is no path by which a cached 206 for one byte range gets
    // served back for a different range. `Cache-Control: no-store` is set on it below
    // anyway, as an explicit belt-and-braces guard that doesn't depend on trusting that
    // platform behaviour to stay as documented. See DEPLOYING.md, "Abuse and cost
    // hardening" item 5, for the full writeup.
    const body = await asset.arrayBuffer()
    const total = body.byteLength
    const range = request.headers.get('Range')

    if (!range) {
      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: { ...PMTILES_HEADERS, 'Content-Length': String(total) }
      })
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!match || (match[1] === '' && match[2] === '')) {
      // Unsatisfiable or malformed: answer with the whole file rather than failing.
      return new Response(body, {
        status: 200,
        headers: { ...PMTILES_HEADERS, 'Content-Length': String(total) }
      })
    }

    let start
    let end
    if (match[1] === '') {
      // Suffix form: "bytes=-500" means the final 500 bytes.
      const suffix = parseInt(match[2], 10)
      start = Math.max(0, total - suffix)
      end = total - 1
    } else {
      start = parseInt(match[1], 10)
      end = match[2] === '' ? total - 1 : Math.min(parseInt(match[2], 10), total - 1)
    }

    if (!Number.isFinite(start) || start >= total || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...PMTILES_HEADERS, 'Content-Range': `bytes */${total}`, 'Cache-Control': 'no-store' }
      })
    }

    const slice = body.slice(start, end + 1)
    return new Response(request.method === 'HEAD' ? null : slice, {
      status: 206,
      headers: {
        ...PMTILES_HEADERS,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(slice.byteLength),
        // Belt-and-braces (see the comment above) - Cloudflare's own Workers Caching
        // already refuses to store a 206 a Worker returns, but this doesn't rely on that.
        'Cache-Control': 'no-store'
      }
    })
  }
}
