// E-293 phase A: the files the viewer's Map tab loads, served by RangerView itself so the map works with
// no Internet. Nothing here is state (D-61 item 8): it reads fixed files that ship in the RangerView folder.
//
//   /view-lib/maplibre-gl.mjs, maplibre-gl-worker.mjs, maplibre-gl-shared.mjs, maplibre-gl.css, pmtiles.js
//   /view-lib/world.pmtiles   the world base map (about 15 MB), read in byte ranges
//
// In a RangerView folder they sit in viewer-lib/ (tools/board-kit/build.js copies them there). Run from the repo
// they come from node_modules and src/assets/maps, so the dev path works with no build step.
const fs = require('fs');
const path = require('path');

const MIME = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
};

// The only names served. Anything else under /view-lib/ is a 404, so no path can leave these files.
const NAMES = ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css', 'pmtiles.js', 'world.pmtiles'];
const PREFIX = '/view-lib/';

/** Where each served name lives on disk, or null when it is missing. `kitDir` is the RangerView folder, if any. */
function resolveLibs({ kitDir = '', repoDir = path.join(__dirname, '..', '..') } = {}) {
  const found = new Map();
  if (kitDir) {
    for (const n of NAMES) found.set(n, path.join(kitDir, 'viewer-lib', n));
  } else {
    const ml = path.join(repoDir, 'node_modules', 'maplibre-gl', 'dist');
    for (const n of NAMES.filter((x) => x.startsWith('maplibre-gl'))) found.set(n, path.join(ml, n));
    found.set('pmtiles.js', path.join(repoDir, 'node_modules', 'pmtiles', 'dist', 'pmtiles.js'));
    const maps = path.join(repoDir, 'src', 'assets', 'maps');
    let world = '';
    try { world = fs.readdirSync(maps).filter((f) => /^world-z5-.*\.pmtiles$/.test(f)).sort().pop() || ''; } catch { /* no maps folder */ }
    found.set('world.pmtiles', world ? path.join(maps, world) : path.join(maps, 'world.pmtiles'));
  }
  return found;
}

/**
 * Reads a Range header against a file of `size` bytes.
 * Returns null (no usable Range: send the whole file), {start, end}, or 'bad' (answer 416).
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return String(header).trim().startsWith('bytes=') && /,/.test(header) ? null : 'bad';
  let start;
  let end;
  if (m[1] === '' && m[2] === '') return 'bad';
  if (m[1] === '') { // the last N bytes
    const n = parseInt(m[2], 10);
    if (!n) return 'bad';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (!(size > 0) || start >= size || start > end) return 'bad';
  return { start, end };
}

/** Sends one file with HTTP Range support. 200 whole, 206 partial, 416 for a range outside the file. */
function sendFile(req, res, file, stats) {
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  const range = parseRange(req.headers.range, stats.size);
  if (range === 'bad') {
    res.writeHead(416, { ...base, 'Content-Range': `bytes */${stats.size}`, 'Content-Length': 0 });
    res.end();
    return;
  }
  const part = range || { start: 0, end: stats.size - 1 };
  const length = stats.size === 0 ? 0 : part.end - part.start + 1;
  res.writeHead(range ? 206 : 200, {
    ...base,
    'Content-Length': length,
    ...(range ? { 'Content-Range': `bytes ${part.start}-${part.end}/${stats.size}` } : {}),
  });
  if (req.method === 'HEAD' || length === 0) { res.end(); return; }
  const stream = fs.createReadStream(file, { start: part.start, end: part.end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** The /view-lib/ route. Returns true when it handled the request. */
function createViewerLib(options) {
  const libs = resolveLibs(options);
  return function handle(req, res) {
    const urlPath = req.url.split('?')[0];
    if (!urlPath.startsWith(PREFIX)) return false;
    const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    let name = '';
    try { name = decodeURIComponent(urlPath.slice(PREFIX.length)); } catch { /* bad escape: not found */ }
    const file = libs.get(name);
    if (!file) { notFound(); return true; }
    fs.stat(file, (err, stats) => {
      if (err || !stats.isFile()) { notFound(); return; }
      sendFile(req, res, file, stats);
    });
    return true;
  };
}

module.exports = { createViewerLib, resolveLibs, parseRange, NAMES, PREFIX };
