// Post-deploy gate: fail loudly if the build we just shipped is not what the public
// hostname actually serves.
//
// This exists because of a real outage (PRIVATE-Roadmap.md section 19g). A Cloudflare
// Redirect Rule on the .org zone was scoped too broadly and matched the apex as well as
// www, so https://rangertrak.org/ answered every request with a 301 to itself. CI was
// green and wrangler was deploying successfully the whole time - the deploy and the
// hostname are two different facts, and nothing checked the second one.
//
// It went unnoticed because the installed PWA kept serving a cached build to the only
// person likely to look, while every new visitor got ERR_TOO_MANY_REDIRECTS. That is the
// R7 staleness risk: offline-first is exactly what hides a dead origin.
//
// So this checks the thing that was actually broken, not a proxy for it:
//   1. the apex answers 200 and not a redirect,
//   2. the enforcing security headers (E-44) match exactly - the one thing this repo has
//      no OTHER way to verify, since the local dev server never reads src/_headers,
//   3. /ngsw.json - what the service worker polls to discover new versions - is 200 and
//      parses as JSON, since that is the file whose failure made the app go quiet,
//   4. the index.html being served references the SAME main-*.js hash we just built,
//      which is the only assertion that proves this deploy reached users rather than
//      merely succeeding.
//
// Check 4 is what makes this more than an uptime ping: a stale-but-healthy origin passes
// 1-3 happily.
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist', 'rangertrak', 'browser');
const ORIGIN = process.env.DEPLOY_CHECK_ORIGIN || 'https://rangertrak.org';

// Cloudflare needs a moment to serve new assets, and index.html is revalidated rather
// than immutable. Observed propagation in practice: ~140s. Poll rather than sleep once,
// so a fast deploy passes fast and a slow one still passes.
const ATTEMPTS = 18;
const INTERVAL_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The main bundle hash of the build sitting in dist/ right now. */
function expectedBundle() {
  if (!fs.existsSync(DIST)) {
    console.error(`FAIL: no build at ${DIST} - run "npm run build" first.`);
    process.exit(1);
  }
  const bundle = fs.readdirSync(DIST).find((f) => /^main-[A-Za-z0-9]+\.js$/.test(f));
  if (!bundle) {
    console.error(`FAIL: no main-*.js in ${DIST}. Did the build actually produce output?`);
    process.exit(1);
  }
  return bundle;
}

// E-44 (2026-08-20): the enforcing security headers from src/_headers, checked against the
// LIVE response rather than trusted from the file - the file is Cloudflare-only syntax with
// no local enforcement to verify it against (see its own comment), so a typo or a scoping
// mistake would otherwise ship silently and stay unnoticed indefinitely, same shape of blind
// spot as the 19g redirect outage this whole file exists to catch. Exact values are checked,
// not just presence, since "the header exists but says the wrong thing" is a real and easy
// way for a future edit to this file to look fine while doing nothing - the class of bug
// this project has hit more than once (see ADR D-39's "looks configured, does nothing"
// catalogue). The Content-Security-Policy is deliberately NOT checked here: it's Report-Only
// by design (src/_headers explains why), so its presence isn't a pass/fail-worthy fact the
// way an enforcing header's is.
//
// strict-transport-security IS checked now (2026-09-22), but not as a fixed string - see
// checkHsts() below. The zone-level value is Cloudflare's, not this repo's, which is why
// this was skipped originally: asserting an origin declaration the edge never reads would
// have been a self-inflicted version of the very bug class this file exists to prevent.
//
// What changed: PageSpeed (2026-09-22) flagged the live max-age as too low, and it is -
// the zone serves `max-age=15552000` (180 days) WITH `preload`, but the preload list
// requires at least 31536000 (1 year). So the domain advertises a commitment it cannot
// actually be accepted for. That is worth catching automatically rather than rediscovering
// from a Lighthouse run, so the check below asserts the relationship rather than a value.
const EXPECTED_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  // geolocation=(self) since 2026-08-31 - `()` disabled it for this origin too and
  // silently broke field-mode GPS auto-fill. This assertion is exact on purpose: it is
  // what would have caught that change going the wrong way. See src/_headers.
  'permissions-policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
};

/**
 * HSTS is Cloudflare zone-level config, so this asserts the INVARIANT rather than an exact
 * value: if the header claims `preload`, max-age must be at least a year, or the domain can
 * never actually be accepted onto the preload list. Fix in the dashboard
 * (SSL/TLS -> Edge Certificates -> HTTP Strict Transport Security), not in src/_headers -
 * an origin declaration there is not read.
 */
const HSTS_PRELOAD_MIN_AGE = 31536000 // one year, the preload list's own floor

function checkHsts(headers) {
  const value = headers.get('strict-transport-security')
  if (!value) return `${ORIGIN}/ serves no strict-transport-security header`

  const maxAge = Number((value.match(/max-age=(\d+)/) || [])[1])
  if (!Number.isFinite(maxAge)) return `${ORIGIN}/ HSTS has no readable max-age: "${value}"`

  if (/;\s*preload/.test(value) && maxAge < HSTS_PRELOAD_MIN_AGE) {
    return `${ORIGIN}/ HSTS claims "preload" but max-age is ${maxAge}s `
      + `(${Math.round(maxAge / 86400)} days); the preload list requires at least `
      + `${HSTS_PRELOAD_MIN_AGE}s (365 days). Raise it in the Cloudflare dashboard.`
  }
  return null
}

/** Returns a failure message, or null if every expected header matches exactly. */
function checkSecurityHeaders(headers) {
  const hsts = checkHsts(headers)
  if (hsts) return hsts
  for (const [name, expected] of Object.entries(EXPECTED_HEADERS)) {
    const actual = headers.get(name);
    if (actual !== expected) {
      return `${ORIGIN}/ header "${name}" is ${actual ? `"${actual}"` : 'missing'}, expected "${expected}"`;
    }
  }
  return null;
}

// redirect: 'manual' on purpose. Following redirects is what made this class of failure
// invisible - a self-redirect looks like "slow" to a client that follows, and like a
// clear defect to one that does not.
async function fetchNoFollow(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
    return { status: res.status, location: res.headers.get('location'), body: res };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function main() {
  const bundle = expectedBundle();
  console.log(`Verifying ${ORIGIN} serves the build we just made (${bundle})`);

  let last = '';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const root = await fetchNoFollow(`${ORIGIN}/`);

    if (root.status >= 300 && root.status < 400) {
      // The exact shape of the 19g outage. Name it, because "301" alone sent a previous
      // investigation down a two-hour path.
      const target = root.location || '(no Location header)';
      const selfLoop = target === `${ORIGIN}/` || target === ORIGIN;
      last = `${ORIGIN}/ returned ${root.status} -> ${target}`;
      if (selfLoop) {
        console.error(`\nFAIL: ${last}`);
        console.error(`
The origin is redirecting to itself, so the Worker never runs and no visitor can
load the app. This is a Cloudflare rule, not a code or deploy problem - the deploy
above almost certainly succeeded.

Look at: Dashboard -> rangertrak.org -> Rules -> Redirect Rules (and Page Rules).
A rule whose match is scoped to the zone rather than to the www hostname will do
exactly this. The correct rule is specified in DEPLOYING.md; it must match
hostname EQUALS www.rangertrak.org, never the apex.
`);
        process.exit(1);
      }
    } else if (root.status === 200) {
      const html = await root.body.text();
      const ngsw = await fetchNoFollow(`${ORIGIN}/ngsw.json`);
      const headerFailure = checkSecurityHeaders(root.body.headers);

      if (headerFailure) {
        console.error(`\nFAIL: ${headerFailure}`);
        console.error(`
The deploy and the hostname both look fine - this is specifically about the
_headers file (src/_headers) not reaching the edge as written. Since the local
static server used for development never reads _headers at all (that's a
Cloudflare-only mechanism, see E-44 in _headers' own comment), this check is the
only place these headers are ever actually verified. Check:
  1. src/_headers is still listed in angular.json's "assets" array.
  2. The built dist/rangertrak/browser/_headers contains the expected lines
     (npm run build, then inspect it directly).
  3. Whether a Cloudflare Transform Rule or another _headers-like mechanism is
     overriding these at the edge.
`);
        process.exit(1);
      } else if (ngsw.status !== 200) {
        last = `/ngsw.json returned ${ngsw.status}`;
      } else if (html.includes(bundle)) {
        // Confirm ngsw.json is really JSON - a SPA fallback would hand back index.html
        // with a 200 and the service worker would never notice a new version.
        try {
          JSON.parse(await ngsw.body.text());
        } catch {
          console.error(`\nFAIL: ${ORIGIN}/ngsw.json is 200 but not JSON.`);
          console.error('Likely the SPA fallback answering for a missing file, which would');
          console.error('silently disable update detection for every installed client.');
          process.exit(1);
        }
        console.log(`OK: ${ORIGIN} serves ${bundle}, /ngsw.json is valid JSON, and the security headers match.`);
        return;
      } else {
        const live = html.match(/main-[A-Za-z0-9]+\.js/)?.[0] ?? '(none found)';
        last = `serving ${live}, waiting for ${bundle}`;
      }
    } else {
      last = `${ORIGIN}/ returned ${root.status}${root.error ? ` (${root.error})` : ''}`;
    }

    if (attempt < ATTEMPTS) {
      console.log(`  attempt ${attempt}/${ATTEMPTS}: ${last} - retrying in ${INTERVAL_MS / 1000}s`);
      await sleep(INTERVAL_MS);
    }
  }

  console.error(`\nFAIL: after ${(ATTEMPTS * INTERVAL_MS) / 1000}s, ${last}`);
  console.error(`
The deploy step reported success, so this is about what the hostname serves rather
than whether the upload worked. Check, in order:
  1. Rules -> Redirect Rules / Page Rules on the .org zone (see 19g).
  2. Workers -> rangertrak -> Settings -> Domains & Routes: both custom domains
     from wrangler.jsonc should be listed and active.
  3. Whether an older deploy is pinned or a rollback is in effect.
`);
  process.exit(1);
}

main();
