# Deploying RangerTrak

RangerTrak is hosted as a **Cloudflare Worker serving static assets** — not a Cloudflare
Pages project. Almost everything is served straight from the `assets` block in
[wrangler.jsonc](wrangler.jsonc), untouched by any server code — but there IS a small
amount of server code now, at [worker/index.js](worker/index.js): a Range-request shim for
the offline PMTiles basemap, and the `POST /api/feedback` endpoint (ADR D-15) that files
in-app feedback as a GitHub issue. Both are routed there explicitly via `run_worker_first`
in `wrangler.jsonc`; every other path bypasses the Worker code entirely and goes straight
to the asset store. A What3Words proxy is a plausible future addition to the same file.

- For the developer workflow, see [DEVELOPING.md](DEVELOPING.md).
- For how the app is put together, see [ARCHITECTURE.md](ARCHITECTURE.md).

> **Two unrelated things are called "worker."** This document means the **Cloudflare
> Worker** — our server at the edge. The **service worker** is the browser-side script
> from [ngsw-config.json](ngsw-config.json) that caches the app for offline use. They
> interact in exactly one place: the `_headers` rules below.

## One-time setup

### 1. Cloudflare API token

Create a token at **My Profile → API Tokens → Create Token**, using the
**Edit Cloudflare Workers** template. It needs:

| Scope   | Permission                | Needed for                   |
| ------- | ------------------------- | ---------------------------- |
| Account | Workers Scripts — Edit    | every deploy                 |
| Zone    | Workers Routes — Edit     | attaching the custom domain  |
| Account | Workers KV Storage — Edit | only once KV is used         |

### 2. GitHub repository secrets

In `github.com/EOCOnline/rangertrak` → **Settings → Secrets and variables → Actions**:

| Secret                  | Value                                               |
| ----------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | The token from step 1                               |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

### 3. Local wrangler login (only for manual deploys)

```bash
npx wrangler login
npx wrangler whoami     # confirm the right account
```

### 4. Worker secret for the feedback endpoint (ADR D-15)

`POST /api/feedback` (`worker/index.js`) needs a GitHub Personal Access Token to file
issues on its own, separate from the `CLOUDFLARE_API_TOKEN` above (that one authenticates
*deploying* the Worker; this one authenticates the *deployed* Worker calling GitHub's API
at request time). Create a fine-grained PAT scoped to **only** `EOCOnline/rangertrak`,
with **Issues: Read and write** and nothing else, then set it as a **Worker secret** (not
a GitHub repo secret — it never touches GitHub Actions):

```bash
npx wrangler secret put GITHUB_FEEDBACK_TOKEN
```

Without this secret the endpoint fails closed (503) rather than erroring loudly — the
in-app feedback form treats that the same as "unreachable" and falls back to a direct
GitHub issue link, so a missing secret degrades gracefully instead of breaking the page.

**This endpoint has one cross-origin caller.** The front-door site at `rangertrak.com`
(separate private repo, separate Worker) posts its feedback page here rather than carrying
a second copy of the issue-filing code and a second PAT. `FEEDBACK_ALLOWED_ORIGINS` in
`worker/index.js` is that allowlist — apex only, since `www.rangertrak.com` is redirect-only
and a browser's `Origin` is therefore only ever the apex. It is an allowlist and not `*`
deliberately: a wildcard would let any site on the Internet file issues under this PAT, and
would be invisible from the browser. `worker/index.test.mjs` pins the behaviour in both
directions, including that a same-origin in-app POST gets no CORS headers at all. Note that
CORS constrains browsers, not clients — the real limits here are the length caps, the
per-IP rate limit, the honeypot and the fail-closed token check, not the origin. See
"Abuse and cost hardening" below.

## Abuse and cost hardening (2026-09-14)

Added ahead of a public blog series that will send unfamiliar traffic to `rangertrak.org`
for the first time. Full findings and mitigations are written up in the
(private, not-in-repo) "Offline Map Coverage Beyond Vashon" scoping doc, §7 "Q5 risk
notes" and its dated addendum; this section is the durable, in-repo record of what
actually shipped.

### What was exposed before this

- **`/api/feedback` had no rate limit.** Length caps (4000/200 chars) and the fail-closed
  token check were the only guards. GitHub's own API rate limits a PAT globally, but
  nothing stopped one caller from burning that shared budget, or from filing many small
  issues quickly.
- **Every request under `/assets/maps/*` and `/api/*` is a billed Worker invocation**,
  confirmed against Cloudflare's own docs (`run_worker_first` unconditionally runs the
  Worker for a matching path, regardless of what the code then does — even a non-`.pmtiles`
  file under `/assets/maps/*` still invokes the Worker before falling through to
  `env.ASSETS.fetch()`). Everything else — the SPA shell, hashed JS/CSS bundles — is true
  static-asset serving and is free and unbilled, confirmed against
  <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>
  ("Requests to static assets are free and unlimited").
- **The `.pmtiles` Range shim set a long `Cache-Control` header, but that alone did
  nothing.** Cloudflare's edge only caches responses in front of a Worker (skipping the
  Worker entirely on a hit) when [Workers Caching](https://developers.cloudflare.com/workers/cache/)
  is explicitly turned on (`cache.enabled` in `wrangler.jsonc`) — that was never set, so
  in production **every single basemap byte-range request re-ran the Worker**, re-fetched
  the whole 1.7 MB file from the asset store, and re-sliced it, every time. This is
  distinct from the *static-asset* store's own automatic edge caching, and distinct from
  the programmatic Cache API (`caches.default`), which still requires the Worker to run to
  consult it.
- **No hotlink protection.** Any site, or any script, could point at
  `rangertrak.org/assets/maps/world-vashon.pmtiles` directly.
- Nothing was implemented for a hosted regional-map path (it didn't exist), so there was
  no R2 exposure to audit yet.

### What shipped (`worker/index.js`, `worker/index.test.mjs`, `wrangler.jsonc`)

1. **Per-IP rate limit on `/api/feedback`** — the Workers Rate Limiting binding
   (`FEEDBACK_LIMITER` in `wrangler.jsonc`, GA since 2025-09-19), 5 requests per 60
   seconds, keyed on `CF-Connecting-IP`. This binding needs **no dashboard step** —
   `namespace_id` is just a developer-chosen number, created implicitly on deploy (unlike
   R2, below). If the binding is ever missing (an older wrangler, `wrangler dev` without it
   configured), `worker/index.js` degrades to "no limit" rather than failing the request —
   confirmed by `npx wrangler deploy --dry-run`, which lists `env.FEEDBACK_LIMITER (5
   requests/60s)` as a live binding today.
2. **Feedback abuse checks:** a body-size cap (32 KB, checked against `Content-Length`
   before the body is even read, with a backstop check on the actual bytes read for
   chunked requests with no `Content-Length`), and a dormant honeypot field (`website`).
   **The honeypot is not wired into either shipped form.** Both the in-app form
   (`feedback.component.ts`) and the rangertrak.com form POST exactly `{ message, contact
   }`; `feedback.component.spec.ts` has an explicit privacy-invariant test locking that to
   exactly those two keys ("only these two hand-typed fields are ever sent"). Adding a
   third field to either form would fight that test and its intent, so the worker-side
   support exists for a future form to opt into (any non-empty `website` value in the POST
   body gets a normal-looking success with no GitHub issue filed) but today it's inert —
   the real defenses on this endpoint are the rate limit, the size cap and the length
   caps.
3. **Hotlink protection** (`isAllowedMapReferrer`) on both the existing `.pmtiles` Range
   shim and the new regional-download path: allows `rangertrak.org`, `rangertrak.com`,
   `localhost`/`127.0.0.1`, and — deliberately — requests with **no** `Origin` and **no**
   `Referer` at all. That last case is not a loophole so much as the acknowledged limit of
   this mitigation: a non-browser client can omit both headers and pass through, same as
   the scoping doc's own "weak, stops casual hotlinking" framing. It's allowed rather than
   blocked because that shape also covers same-origin PWA fetches and installed/offline
   use, and breaking those would cost more than the abuse this stops.
4. **`cache.enabled: true`** (Workers Caching) in `wrangler.jsonc`. Once a map response is
   cached at a Cloudflare edge location, a repeat request for that exact URL is served
   **without running the Worker at all** — no CPU billed, and once R2 is in the picture
   (below), no R2 read either.

   **Known limitation, accepted deliberately:** this is unconditional on the Referer
   check. The check only runs when the Worker is invoked, which on a cache **hit** it is
   not — Cloudflare answers straight from the edge, before any of this Worker's code
   runs. So the Referer/Origin allowlist only ever gates the request that *populates* the
   cache at a given edge location; after that, anyone hitting the warm entry — including a
   hotlinker — gets served for free. That is intentional, not a gap to close: a cache hit
   costs no Worker CPU and (once R2 is live) no R2 read, so letting anyone ride a warm
   cache is exactly what "repeats hit Cloudflare's cache" (mitigation 3) means. The
   Referer check's real job is bounding the cost of *cache misses*, not policing every
   viewer of an already-cheap cache hit. See the matching code comment above
   `isAllowedMapReferrer` in `worker/index.js`.

   Every response that must never be cached (rate-limit 429s, the 403 hotlink block, every
   `/api/feedback` response, the 416 unsatisfiable-range case, and this Worker's own 206
   partial responses — see the next point) sets `Cache-Control: no-store` explicitly,
   rather than relying on Cloudflare's default non-GET/error heuristics — a cached 403 or
   429 served to the next, legitimate caller would be a self-inflicted outage.
5. **Range requests and `cache.enabled` — confirmed against Cloudflare's docs, not
   guessed.** Workers Caching does its own Range handling and it does **not** trust a
   Worker-generated `206`: "Cloudflare strips the `Range` header before invoking your
   Worker and asks your Worker for the full body... [and] stores that full response, and
   then slices out the requested byte range" itself. "If your Worker returns a `206`
   response of its own... Cloudflare treats it as an uncacheable response and it is not
   stored." (<https://developers.cloudflare.com/workers/cache/configuration/>, "Range
   requests"). Two consequences for the PMTiles shim in `worker/index.js`:
   - In production, with caching enabled, this Worker will typically never even *see* a
     `Range` header for `/assets/maps/*.pmtiles` — Cloudflare strips it, the Worker always
     returns the full file as a plain `200`, and Cloudflare's edge does the slicing (and,
     on a hit, skips the Worker entirely, satisfying mitigation 3 for the very requests
     pmtiles-js makes most - byte-range reads of the header, directory and tiles).
   - The Worker's own hand-rolled 206-slicing branch is **not deleted** — it stays as a
     correctness fallback for anywhere that behaves differently (`wrangler dev`, a future
     change to `cache.enabled`, or `run_worker_first` routing that bypasses caching). It is
     safe by Cloudflare's own design even if it does run: a Worker-returned `206` is never
     stored, so there is no scenario where a cached response for one byte range gets
     served back for a different one. Belt-and-braces on top of that platform guarantee,
     `worker/index.test.mjs` asserts this Worker's own 206 responses also carry an explicit
     `Cache-Control: no-store` - so the safety doesn't depend solely on trusting
     Cloudflare's behavior to stay as documented.
6. **A prepared-but-inert R2 path**, `GET /regions/<file>.pmtiles`, for whole-file
   downloads of pre-cut regional maps (mitigation 1: one download is one read, not dozens
   of Range reads). It 404s cleanly today with "regional map downloads are not available
   yet" because `env.MAPS` is not bound — see "R2 bucket for regional maps" below for how
   to turn it on. Once live, it applies the same hotlink check and `cache.enabled`
   behaviour as the basemap shim, plus its own rate-limit binding (`MAPS_LIMITER`, also
   prepared but commented out — see `wrangler.jsonc`), and sends an `X-Attribution` header
   ("Map data © OpenStreetMap contributors, ODbL. Basemap by Protomaps.") on every
   download, matching the scoping doc's ODbL requirement. Region keys are restricted to a
   plain-filename pattern (`^[A-Za-z0-9][A-Za-z0-9_-]*\.pmtiles$`) so a path-traversal-shaped
   request 404s before ever calling `env.MAPS.get()`.

### R2 bucket for regional maps (not yet enabled — needs John, one-time)

This environment has no Cloudflare credentials, so none of this could be done from here.
`worker/index.js` already has the full handler (`handleRegionDownload`); `wrangler.jsonc`
has the exact block to uncomment, commented out on purpose so this deploy cannot fail by
naming a bucket that doesn't exist yet. To turn it on:

1. **Create the bucket.** Dashboard: **R2 object storage → Create bucket**, name it
   `rangertrak-maps` (or update the name consistently below and in `wrangler.jsonc`). Or,
   with `wrangler` logged in: `npx wrangler r2 bucket create rangertrak-maps`.
2. **Uncomment the `r2_buckets` block** at the bottom of `wrangler.jsonc` (binding
   `MAPS`, matching the bucket name from step 1), add the trailing comma the comment
   there calls out, and deploy.
3. **(Recommended) uncomment/add the `MAPS_LIMITER` rate-limit entry** in the same file —
   no dashboard step needed for that one, same as `FEEDBACK_LIMITER`.
4. **Upload a region file:**

   ```bash
   npx wrangler r2 object put rangertrak-maps/king-county.pmtiles --file ./king-county.pmtiles
   ```

   The uploaded key becomes the download URL: `https://rangertrak.org/regions/king-county.pmtiles`.
   Named testers first (unlisted links only) — there is deliberately no in-app UI or public
   listing yet; that's Phase 2 in the scoping doc.
5. **Billing/usage alert** (dashboard-only — cannot be scripted or committed): Cloudflare
   dashboard → **Notifications → Add** → a Billing or R2-usage alert with a low threshold
   (a few dollars). R2 storage and egress are cheap and not the actual risk (egress is
   free); the alert exists as a tripwire for the read-request-volume scenario the scoping
   doc's Q5 describes, in case the hotlink check and rate limit are ever bypassed at scale.

### Deliberately not done

- **No content-based spam filtering** (keyword/URL-count heuristics on the feedback
  message). RangerTrak's own "capability, not policy" stance argues against guessing at
  what a legitimate emergency-response bug report looks like; a false positive silently
  eating real feedback is worse than the spam it would prevent. The rate limit and size
  cap are structural, not content-based, on purpose.
- **No Vary-based cache fragmentation by Origin/Referer.** It would defeat the purpose of
  `cache.enabled` (mitigation 3) for a marginal gain over the plain Referer check, since a
  determined non-browser hotlinker omits both headers anyway.
- **No public listing or in-app UI for regional downloads.** Named testers via unlisted
  links only, per the scoping doc's Q5 answer, until public hosting's ODbL/attribution
  question gets the "one read by John" it calls for.
- **Plan availability for the Rate Limiting binding** (Free vs. Paid Workers plan) is not
  documented on Cloudflare's own binding page as of this writing; `npx wrangler deploy
  --dry-run` accepted the config without error against this account's existing Worker, but
  that dry run does not call the Cloudflare API, so it cannot confirm the account's plan
  actually supports it. If the real deploy ever rejects the `ratelimits` block, that is
  the first thing to check.

## How a deploy happens

Pushing to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml):
`npm ci` → `npm run build` → **secret gate** → `wrangler deploy`. It can also be
triggered manually from the Actions tab (`workflow_dispatch`).

To deploy by hand:

```bash
npm run deploy       # build + secret gate + wrangler deploy
npm run deploy:dry   # validate config and asset directory, upload nothing
```

Never run `npx wrangler deploy` directly — it skips the secret gate.

## The secret gate

[tools/check-no-secrets.js](tools/check-no-secrets.js) scans the built bundle for API
keys and **fails the build if it finds any**, so a deploy cannot republish them. It
checks both key shapes (Google `AIza…`, Mapbox `pk./sk.`, AWS) and the literal values
currently in your local `src/assets/data/secrets.json`. It never prints a key value.

This exists because `settings.service.ts` does
`import * as secrets from '.../secrets.json'`, which inlines every value into
`main-XXXX.js` no matter what the `angular.json` assets config ignores. Clearing that
requires either blanking the local `secrets.json` values or removing the import
alongside the Google Maps removal.

If the gate fires, **fix the exposure — do not bypass the gate.**

## Caching and the service worker

[src/\_headers](src/_headers) is copied to the output root by an `assets` entry in
[angular.json](angular.json) and sets `Cache-Control: no-cache` on `index.html`,
`ngsw.json`, `ngsw-worker.js`, `safety-worker.js`, and `manifest.webmanifest`.

These are the service worker's control plane. If any is served stale, browsers keep
running the previous release indefinitely — which is exactly what happened in August
2026, when installed PWAs kept serving a cached 2022 build while the origin was dead
and every new visitor got a 525 error. Everything else keeps Cloudflare's default ETag
revalidation, which is already correct because the bundles have hashed filenames.

### `html_handling: "none"` — required, and not cosmetic

[wrangler.jsonc](wrangler.jsonc) sets `assets.html_handling` to `"none"`. Do not remove
it. The default (`auto-trailing-slash`) answers a request for `/index.html` with a **307
to `/`**. The Angular service worker prefetches `/index.html`, follows that redirect, and
then calls `cache.put()` — which the Cache API **refuses** for a redirected response,
throwing a `TypeError`. The install aborts, `ngsw` caches nothing at all, and the app
silently has no offline capability and never notices a new version.

Confirmed 2026-08-14 by hashing every URL in `ngsw.json`'s prefetch group against what
the site actually served: `/index.html` was the single mismatch, returning 0 bytes (the
307's empty body) where a SHA-1 was expected. Every other file matched.

To check it is still right: `curl -sI https://<host>/index.html` must return **200**, not
307.

### PMTiles needs byte serving, and the asset store does not do it

Workers' static-asset store ignores `Range` and returns the whole file with a 200.
`pmtiles` reads its header and directory by byte range, so the offline map rendered blank
with *"Check that your storage backend supports HTTP Byte Serving"*.

[worker/index.js](worker/index.js) is a Range shim for `/assets/maps/*.pmtiles` **only** —
`run_worker_first` in [wrangler.jsonc](wrangler.jsonc) routes just those paths through the
Worker, so every other request is still served straight from the asset store with no
Worker invocation. The file is ~1.7 MB, small enough to buffer and slice. **If the basemap
ever grows past a few tens of MB, move it to R2** (which does byte serving natively)
rather than raising the buffer.

## DNS

Both zones are registered at and served by Cloudflare. Nothing has ever been
successfully hosted on either one — the 2022-era site was a Firebase deploy on an
account that is now dead.

### Stale IONOS records — removed 2026-08-14

Both zones pointed at retired IONOS origins, which is why `rangertrak.org` returned
**525** (Cloudflare could not complete a TLS handshake with an origin that was gone).
Ten dead records were deleted — apex and `www` A/AAAA on each zone, plus the
`_domainconnect` CNAME to `_domainconnect.1and1.com` on each:

| Zone             | Dead origin was                               |
| ---------------- | --------------------------------------------- |
| `rangertrak.org` | `74.208.236.140` / `2607:f1c0:100f:f000::249` |
| `rangertrak.com` | `74.208.236.164` / `2607:f1c0:100f:f000::273` |

The `_dmarc` TXT on each zone was deliberately kept — a `p=none` DMARC policy on a
domain that sends no mail is correct and worth having.

Inspect either zone at any time with the domain tooling:

```bash
python cf.py dns rangertrak.org      # in D:\Projects\domainManagement\Claude
```

### rangertrak.org → the Worker

**Done, and declared in [wrangler.jsonc](wrangler.jsonc)** rather than clicked into the
dashboard, so the hostname mapping is reviewable and reproducible:

```jsonc
"routes": [
  { "pattern": "rangertrak.org", "custom_domain": true },
  { "pattern": "www.rangertrak.org", "custom_domain": true }
]
```

`wrangler deploy` creates the custom domains, the proxied DNS records and the
certificate. **Do not hand-create A/AAAA records for these names**, and do not add the
same custom domains through the dashboard — the config already owns them.

⚠️ **Both hostnames serve the app, and that is a data-loss hazard — fix it.** `www`
does not redirect to the apex, so `https://rangertrak.org` and `https://www.rangertrak.org`
are **different origins**, with **separate localStorage**. A scribe who opens one today and
the other tomorrow finds a different mission, a different roster and different field
reports, with nothing to indicate data is missing. Observed live 2026-08-14: the two
hostnames held settings a year apart.

**DECIDED 2026-08-14: `https://rangertrak.org` (no `www`) is the canonical URL.**

✅ **Working as of 2026-08-15.** `www.rangertrak.org` is a **redirect-only hostname** — it
is deliberately *not* bound to the Worker. Three parts, and all three are required:

1. **`www` is NOT in `wrangler.jsonc` `routes`.** A Worker Custom Domain binds a hostname
   to the Worker *ahead of Page Rules*, so while `www` was listed there a perfectly correct
   Page Rule silently never fired and `www` served the app directly. **Re-adding it would
   break the redirect again on the next deploy, with no error and nothing failing** — which
   is why the config carries a comment saying so.
2. **A proxied placeholder A record** for `www.rangertrak.org` → `192.0.2.1`, the same
   pattern as the `.com` parking below. Cloudflare's edge needs traffic to act on.
3. **A Page Rule** on the `.org` zone:
   - **URL (trigger)** — `www.rangertrak.org/*`
   - **Setting** — Forwarding URL, **301** Permanent Redirect
   - **Destination** — `https://rangertrak.org/$1`

**How the diagnosis went, since the symptom is confusing:** a correct Page Rule that simply
never fires looks identical to no rule at all. What distinguished it was that the *same*
pattern worked on `rangertrak.com` and `www.rangertrak.com` — neither bound to a Worker —
while the rule that caused the 2026-08-14 outage *was* able to hijack the apex, also a
custom domain, because that one was a **Redirect Rule**, which runs earlier than Workers in
Cloudflare's order of operations. Page Rules do not; custom domains win.

Verify with:

```bash
for p in / /about "/reports?x=1"; do
  curl -sI "https://www.rangertrak.org$p" | grep -i "^HTTP\|^location"
done
# expect 301 each, with location carrying the path AND query through:
#   https://rangertrak.org/ , /about , /reports?x=1
```

**The `*` and the `$1` are two halves of one mechanism and are not interchangeable.** The
`*` in the trigger *captures*; `$1` in the destination *replays* what the first `*` matched.
Putting `$1` in the trigger makes it a literal match for a path of `$1`, which no request
ever has, so the rule silently never fires and traffic falls through to the app — looking
exactly like no rule at all. Both mistakes were made here on the way to getting this right.

**Path is preserved for `www` → apex, and deliberately not for `.com` → `.org` (below).**
That asymmetry is intentional: `www.rangertrak.org` is an alias for *this* app with *these*
routes, so `www…/reports` must land on `/reports`; `rangertrak.com` is parked and will
become a different product with routes of its own, so mapping its paths onto `.org` would
be wrong the moment it has any.

⚠️ **Whatever rule you write, scope it to the `www` hostname explicitly.** A rule matching
the zone rather than the hostname also matches the apex, which then redirects to itself
forever. That is not hypothetical — it took the site down for every new visitor while CI
stayed green and the cached PWA hid it from everyone already installed. `check-deployed.js`
now catches it (see "Post-deploy verification"), but the rule is where it starts.

Until the redirect is live, tell users to always use the same URL. There is no way for the
app to merge the two stores after the fact.

### rangertrak.com → redirect to .org

> **SUPERSEDED 2026-08-31, but still live in production.** `.com` has been decided (E-101 /
> ADR D-41) to host the static front-door site, which lives in its own private repo,
> `EOCOnline/RangerTrak.com`, and deploys to its own `rangertrak-site` Worker. Everything
> described below is still exactly what is serving today and is documented here so the
> cutover is reversible — but **the apex Page Rule must be deleted, not left in place**, when
> that site goes live. A Worker Custom Domain binds ahead of Page Rules, so a forgotten rule
> would sit dormant and silently restore this redirect the moment the custom domain is
> detached. That is the `www.rangertrak.org` failure again, in a new hostname. The cutover
> runbook is that repo's README; step 6 of it is deleting this section.

`.com` was parked, redirecting to `.org` until it became a site of its own. It is a
**Redirect Rule**, not a Worker, so it costs nothing at runtime and is deleted in one
click.

Four proxied placeholder records were added 2026-08-14 so the hostname resolves to
Cloudflare's edge and the rule has traffic to act on:

| Type | Name                 | Content     | Proxied |
| ---- | -------------------- | ----------- | ------- |
| A    | `rangertrak.com`     | `192.0.2.1` | yes     |
| AAAA | `rangertrak.com`     | `100::`     | yes     |
| A    | `www.rangertrak.com` | `192.0.2.1` | yes     |
| AAAA | `www.rangertrak.com` | `100::`     | yes     |

Those addresses are the RFC 5737 documentation range and the RFC 6666 discard prefix —
deliberately unroutable. Because the records are proxied, the redirect fires at the
edge and nothing ever connects to them.

**Live 2026-08-15**, as two Page Rules on the `rangertrak.com` zone — Page Rules match one
hostname each, so the apex and `www` need one apiece:

| # | URL (trigger)          | Setting                                         |
| - | ---------------------- | ----------------------------------------------- |
| 1 | `rangertrak.com/*`     | Forwarding URL, 301 → `https://rangertrak.org/` |
| 2 | `www.rangertrak.com/*` | Forwarding URL, 301 → `https://rangertrak.org/` |

**No `$1`, deliberately — every `.com` URL lands on the `.org` root.** `.com` is parked and
becomes a different product later, so carrying its paths across would be wrong now and
actively broken once `.com` has routes of its own. This is the opposite of the `www` → apex
rule above, and the difference is the point.

Verify with:

```bash
curl -sI https://rangertrak.com/reports | grep -i "^HTTP\|^location"
# expect: HTTP/2 301  +  location: https://rangertrak.org/   (root, not /reports)

curl -sL -o /dev/null -w "%{http_code} after %{num_redirects} hop(s) -> %{url_effective}\n" \
  https://rangertrak.com/
# expect: 200 after 1 hop(s) -> https://rangertrak.org/
```

Both verified passing on 2026-08-15, and re-verified still live 2026-08-31 — the apex,
`www`, and every path all 301 to the `.org` root. Once the front-door site is cut over, the
first of those two curl checks becomes the *failure* signal rather than the success one; see
`tools/check-site.js` in the site repo, which asserts the apex answers 200 and not a 3xx.

## Smoke test after a deploy

Run in a **real browser**, not headless — see the service worker note below.

> The `workers.dev` URL returns 404 now that the custom domains are attached; test
> against `https://rangertrak.org` directly.

### Routing and assets

- [ ] `/` loads and the app boots with no console errors.
- [ ] A deep link typed directly — `/entry`, `/rangers`, `/reports` — loads instead of
      404ing. This is `not_found_handling: "single-page-application"` working.
- [ ] `/favicon.ico` returns 200.
- [ ] Both map engines render (Leaflet and MapLibre). MapLibre's worker is an `.mjs`
      module worker and browsers refuse to start one unless it is served with a
      JavaScript MIME type — if the MapLibre map is blank, check the `Content-Type` on
      `/assets/maplibre/maplibre-gl-worker.mjs` first.
- [ ] The offline map page renders. The PMTiles basemap is fetched by **HTTP range
      request**; confirm a `.pmtiles` request returns **206 Partial Content**, not 200.
      MIME type and range support are the two ways the previous host broke this page.
- [ ] DevTools → Network, go offline, reload: the app still loads.

### Cache headers

- [ ] `curl -sI https://<host>/ngsw.json | grep -i cache-control` shows `no-cache`.
- [ ] Same for `/ngsw-worker.js` and `/index.html`.
- [ ] `curl -sI https://<host>/index.html` returns **200, not 307** — see
      `html_handling` above. A 307 here means no offline support and no update
      detection, silently.
- [ ] `curl -sI -H 'Range: bytes=0-99' https://<host>/assets/maps/world-vashon.pmtiles`
      returns **206** with a `Content-Range` header.

If any of these is missing, [src/\_headers](src/_headers) is not being honored — stop and
fix that before trusting the update flow, because its failure is silent.

**A replaced map file needs a new filename, not just new bytes.** `PMTILES_HEADERS` in
`worker/index.js` sends `Cache-Control: public, max-age=31536000, immutable` — a signal to
every intermediate cache (browsers, Cloudflare's edge once `cache.enabled` is warm) that
the bytes at this exact URL will never change for a year, so don't even bother
revalidating. That is only true because the filename is content-addressed by convention
(`vashon.pmtiles` → `world-vashon.pmtiles` when the maps agent swapped in the merged
world+Vashon extract, 2026-09-14). Overwriting `world-vashon.pmtiles` in place with
different bytes on a future deploy would leave every browser and edge cache that already
fetched it serving stale map data for up to a year, with no error and nothing failing —
the same silent-staleness shape as the `www`/`index.html` traps elsewhere in this
document. Ship a new basemap under a new filename (and update the reference in
`pmtiles-config.ts`) rather than replacing one in place.

### The update path — the item that affects every existing user

This is the one thing that cannot be checked from a single deploy, and it is the reason
installed PWAs kept serving a 2022 build while the origin was dead. **Deploy twice with
different versions**, then against an install made from the *first* deploy:

- [ ] The Log page reports **"Update checks armed"** — silence used to read as success.
- [ ] The app surfaces **"new version ready — reload"** rather than quietly staying stale.
- [ ] Reloading actually lands on the new version.

> **VERIFIED 2026-08-14, end to end.** An install made from the 0.13.0 deploy detected
> 0.14.0 and offered it on both surfaces: the standing footer button ("New version ready
> - reload") and the snackbar ("A new version of RangerTrak is available - Reload now").
> The footer's "(checked ...)" stamp was current.
>
> This also settles whether `ngsw` populates its caches: `VERSION_READY` is only emitted
> after the service worker has downloaded and cached the *entire* new version, so caching
> works. Headless Chrome reporting an empty `caches.keys()` was an artifact of that
> environment, not a fault in the deployment - which is exactly why this checklist says to
> run in a real browser.

One diagnostic gotcha specific to this hosting: with
`not_found_handling: "single-page-application"`, a request for a file that does not
exist returns **`index.html` with a 200**, not a 404. So a missing or misnamed asset
reaches the service worker as valid-looking HTML and fails a hash check instead of
returning an honest 404. If `ngsw` misbehaves here, check that every file listed in
`ngsw.json` actually exists in the deployment before suspecting the service worker.

That hypothesis proved correct on the first real deploy, though by a different route: it
was not a *missing* file but `/index.html` itself, redirected. The diagnostic is the same
one, and it is worth running first — fetch every URL in `ngsw.json`, SHA-1 each body, and
compare against the manifest's `hashTable`. The mismatch names the culprit immediately.

## Rollback

```bash
npx wrangler deployments list
npx wrangler rollback [<version-id>]
```

Rollback reverts the Worker and its assets together. Clients already holding the old
service worker are unaffected; clients on the bad version recover on next load because
`ngsw.json` is not cached.
