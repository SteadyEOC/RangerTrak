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

// ---- E-306 rung 2: pure helpers the viewer page also carries inline ----
// BEGIN stations-lib (E-306 rung 2). The same text sits in src/command-post-view/index.html: the page cannot require
// this file, so viewer-lib.test.js fails when the two copies differ. Edit both together.
// findPossibleDuplicates is the plain-JS port of src/app/domain/possible-duplicates.ts; its test cases are copied
// from possible-duplicates.spec.ts into viewer-lib.test.js so the two cannot drift unnoticed.
var DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
function dupLetter(r) {
  var m = /^([A-Z])\d/.exec(String(r && r.msgNo || ''));
  return m ? m[1] : '';
}
function dupNorm(s) { return String(s || '').trim().toLowerCase(); }
function dupSharesCall(a, b) {
  var ca = dupNorm(a.callsign);
  if (ca && ca === dupNorm(b.callsign)) { return true; }
  var ta = dupNorm(a.tacticalCall);
  return !!ta && ta === dupNorm(b.tacticalCall);
}
// Every possible-duplicate pair: different station letters (from the message number), the same call sign or
// tactical call, within windowMs. Each pair once, earlier first. Marks only; nothing is merged or hidden.
function findPossibleDuplicates(reports, windowMs) {
  var limit = windowMs == null ? DUPLICATE_WINDOW_MS : windowMs;
  var stamped = [];
  (reports || []).forEach(function (r) {
    var t = new Date(r && r.date).getTime();
    if (dupLetter(r) && isFinite(t)) { stamped.push({ r: r, t: t }); }
  });
  stamped.sort(function (x, y) { return x.t - y.t; });
  var out = [];
  for (var i = 0; i < stamped.length; i++) {
    for (var j = i + 1; j < stamped.length; j++) {
      if (stamped[j].t - stamped[i].t > limit) { break; }
      var a = stamped[i].r, b = stamped[j].r;
      if (dupLetter(a) === dupLetter(b)) { continue; }
      if (dupSharesCall(a, b)) { out.push({ a: a, b: b }); }
    }
  }
  return out;
}
// For each report in a pair: what to say about the other one(s). Map: report -> [{ msgNo, date }].
function duplicateNotes(pairs) {
  var out = new Map();
  function add(from, other) {
    var list = out.get(from) || [];
    list.push({ msgNo: other.msgNo, date: other.date });
    out.set(from, list);
  }
  pairs.forEach(function (p) { add(p.a, p.b); add(p.b, p.a); });
  return out;
}
// "5 min ago", "2 h 5 min ago", "just now"; '' when there is no time.
function agoText(ms, nowMs) {
  if (!ms) { return ''; }
  var mins = Math.max(0, Math.floor((nowMs - ms) / 60000));
  if (mins < 1) { return 'just now'; }
  if (mins < 120) { return mins + ' min ago'; }
  return Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min ago';
}
// One line per station: "Station B, scribe Pat, last update 2 min ago". `stations` is the server's list.
function stationLines(stations, nowMs) {
  return (stations || []).map(function (s) {
    var seen = Date.parse(s.seenAt) || 0;
    return 'Station ' + (s.station || '(no letter)')
      + (s.scribe ? ', scribe ' + s.scribe : '')
      + (seen ? ', last update ' + agoText(seen, nowMs) : ', no update yet');
  });
}
function stationMissionLabel(s) {
  var name = String(s && s.event || '').trim(), id = String(s && s.mission || '').trim();
  return name && id ? name + ' (' + id + ')' : name || id;
}
// Warnings for stations whose mission differs from the first (primary) station's.
function stationMissionWarnings(stations) {
  var list = stations || [];
  if (list.length < 2) { return []; }
  var first = stationMissionLabel(list[0]).toLowerCase();
  var out = [];
  list.slice(1).forEach(function (s) {
    var label = stationMissionLabel(s);
    if (label.toLowerCase() !== first) {
      out.push('Station ' + (s.station || '(no letter)') + ' is publishing a different mission: ' + (label || '(unnamed mission)') + '.');
    }
  });
  return out;
}
// END stations-lib

module.exports = { findPossibleDuplicates, duplicateNotes, stationLines, stationMissionWarnings, agoText, createViewerLib, resolveLibs, parseRange, NAMES, PREFIX };
