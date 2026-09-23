// Minimal static file server for previewing the production build locally, with SPA
// fallback (serves index.html for any path that isn't a real file) so direct navigation
// or a page refresh on a client-side route (/mapLeaflet, /map, /reports, /rangers, /settings,
// /log) doesn't 404 - Angular's router only ever runs client-side, so the server has to
// hand back index.html for it to take over. Also supports HTTP Range requests, needed
// for the PMTiles map (the pmtiles library fetches the basemap via byte ranges).
//
// Plain Node http, no dependency - http-server (used before) has no real SPA-fallback
// option, just a reverse-proxy flag that isn't the same thing.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'dist', 'rangertrak', 'browser');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const MIME = {
  // .mjs matters as much as .js here: maplibre-gl v6's worker is a module worker, and
  // browsers refuse to instantiate one unless it is served with a JavaScript MIME type -
  // falling through to application/octet-stream silently kills the map. Any production
  // host serving this build needs the same mapping.
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.pmtiles': 'application/octet-stream', '.txt': 'text/plain'
};

/**
 * Apply src/_headers to every response.
 *
 * Added 2026-09-22. Before this, `_headers` was a Cloudflare-only mechanism that this
 * server ignored entirely - which src/_headers' own comment called out as the reason the
 * Content-Security-Policy was "genuinely untested until it reaches the live edge," and why
 * it had to stay Report-Only. That gap is what made enforcing it a blind decision.
 *
 * Now `npm run server` (and therefore the e2e suite that runs against it) serves the same
 * headers Cloudflare will, so an enforcing CSP that breaks a real feature fails locally
 * instead of in production.
 *
 * Deliberately simple: only the catch-all `/*` block is read, which is the only one this
 * file has. Per-path blocks would need real Cloudflare `_headers` matching semantics, and
 * inventing a half-version of those would be worse than not having them.
 */
function loadHeaders() {
  const file = path.join(__dirname, '..', 'src', '_headers');
  if (!fs.existsSync(file)) return {};
  const out = {};
  let inCatchAll = false;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.includes(':') || line.startsWith('/')) { inCatchAll = line === '/*'; continue; }
    if (!inCatchAll) continue;
    const i = line.indexOf(':');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const EXTRA_HEADERS = loadHeaders();
if (Object.keys(EXTRA_HEADERS).length) {
  console.log(`Applying ${Object.keys(EXTRA_HEADERS).length} headers from src/_headers`);
}

function send(res, filePath, stats, range) {
  const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';

  if (range) {
    const size = stats.size;
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      ...EXTRA_HEADERS,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...EXTRA_HEADERS,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Only fall back for real client-side routes. Falling back for *everything* meant a
      // missing asset was answered with index.html and a 200, so a script or worker that
      // failed to ship looked like a file that loaded and then misbehaved - which is
      // exactly how the missing maplibre-gl-worker.mjs hid for so long. Anything with a
      // file extension is an asset: if it isn't there, say so.
      if (path.extname(urlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not found: ${urlPath}`);
        console.warn(`404 ${urlPath}`);
        return;
      }
      filePath = path.join(ROOT, 'index.html'); // SPA fallback
    }

    fs.stat(filePath, (err2, stats2) => {
      if (err2) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      send(res, filePath, stats2, req.headers.range);
    });
  });
});

server.listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
