// D-61 / D-60 - RangerView's HTTP API: who may publish, who may read, and how a full-size
// attachment gets from the scribe's device to a viewer.
//
// ALL state is in this process's memory and nothing here touches the disk (D-61 item 8): the
// claim (publisher, password, key), the latest snapshot, the viewers' pending requests, and the
// requested originals. A restart forgets everything, on purpose; the scribe's device notices
// (every keyed call answers 409 'unclaimed'), claims again and re-sends (D-61 item 6).
//
// E-306 rung 2 (ADR D-72): several stations may publish to one RangerView. Each claim names its
// station (one letter A-Z, or '' for a device with no letter); the server keeps one publisher, key,
// heartbeat and snapshot PER STATION and merges them, read-only, for viewers. The first claim after
// a restart makes its station the PRIMARY, which owns the password, the area map, the Setup file and
// the mission name in the header. Nothing is ever sent back to a station beyond the letters in the claim reply.
//
// A claim body may carry `reclaim: true`. The client sets it only for the AUTOMATIC re-claim after
// a 409 (restart), never for a person's "Take over". A reclaim on an unclaimed RangerView is a normal
// first claim; on a claimed RangerView it never takes over (409 'claimed') - see postClaim().
//
// Two secrets, never printed or logged anywhere in this file:
//   - the viewer PASSWORD (optional; blank = the Wi-Fi is the boundary), sent by viewers in
//     X-Board-Password;
//   - the publish KEY, issued fresh on every claim and takeover, sent by the publisher in
//     X-Board-Key. Only the current key may publish or upload, so a takeover cuts the old device
//     off at once.
const crypto = require('crypto');
const { parseRange } = require('./viewer-lib');
const { checkSetupZip } = require('./setup-zip');

const SHA_RE = /^[0-9a-f]{64}$/;
const STATION_RE = /^[A-Z]?$/;
const MAX_STATIONS = 8;
const SMALL_BODY_LIMIT = 64 * 1024;
const MISSION_BODY_LIMIT = 25 * 1024 * 1024; // as before: generous for JSON, cheap insurance
const MB500 = 500 * 1024 * 1024;
const MB250 = 250 * 1024 * 1024; // E-293 phase B: the area map's own cap, separate from the attachments
const MB20 = 20 * 1024 * 1024; // E-287: the Setup file for phones (settings and places; a few KB in practice)
const RATE_MAX_FAILS = 5;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_BLOCK_MS = 60 * 1000;

// Compared as SHA-256 digests so the two buffers always have the same length, which is what
// timingSafeEqual requires - and so the comparison leaks nothing about the length either.
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Text that ends up on the server's console or on RangerView. Control characters are stripped so
// a hostile client can't write escape sequences or fake log lines into the operator's terminal.
function cleanText(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanBy(by) {
  if (!by || typeof by !== 'object' || Array.isArray(by)) return null;
  return { mission: cleanText(by.mission), opPeriod: cleanText(by.opPeriod, 40), scribe: cleanText(by.scribe), agent: cleanText(by.agent) };
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error('Request body too large'), { status: 413 });
    if (Number(req.headers['content-length']) > maxBytes) { reject(tooLarge()); return; }
    let received = 0;
    let over = false;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) { over = true; chunks.length = 0; return; } // keep draining, store nothing
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => (over ? reject(tooLarge()) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req, maxBytes) {
  const buf = await readBody(req, maxBytes);
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Body is not valid JSON'), { status: 400 });
  }
}

function safeContentType(type) {
  return typeof type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
}

/**
 * @param {object} [o]
 * @param {function} [o.log]            one line at a time, for the operator's console
 * @param {function} [o.now]            clock, for tests
 * @param {number}   [o.originalsCap]   total bytes of originals held (D-60 item 6: 500 MB)
 * @param {number}   [o.uploadCap]      largest single upload (500 MB)
 * @param {string}   [o.name]           the .local name actually taken, shown to viewers
 * @param {function} [o.onClaim]        called after a claim, a takeover or a password change, so the
 *                                      server can show the viewer QR code. Never given anything to log.
 * @param {string}   [o.version]        the RangerTrak version, told to GET /api/hello (E-216)
 * @param {Function} [o.update]         () => { version } of a newer RangerView, once the start-up check finds one (update-check.js)
 * @param {string}   [o.wifi]           the Wi-Fi network's name when the server could read it, told to viewers
 *                                      so "Lost RangerView" can ask "Still on <name>?" (E-216)
 */
function createBoard({ log = () => {}, now = Date.now, originalsCap = MB500, uploadCap = MB500, mapCap = MB250, setupCap = MB20, name = '', onClaim = () => {}, version = '', wifi = '', update = () => null } = {}) {
  // D-72: one publisher and one snapshot per station. Map order is join order (a takeover keeps its place).
  const publishers = new Map(); // station -> { station, key, by, at, seenAt, previous? }
  const snapshots = new Map(); // station -> the last snapshot that station published
  const stationRefs = new Map(); // station -> Map(sha -> { size, type }) from that station's snapshot
  let password = ''; // board-wide; only the primary changes it
  let primary = null; // the station of the first claim after a restart (or the oldest left, once it leaves)
  // A key starts with this process's own tag, so a key from before a restart is told apart from a stranger's.
  const instance = crypto.randomBytes(6).toString('base64url');
  const newKey = () => `${instance}.${crypto.randomBytes(32).toString('base64url')}`;
  let refs = new Map(); // sha -> { size, type }: the UNION of every station's non-removed attachment refs
  const requests = new Set();
  const originals = new Map(); // sha -> Buffer; Map keeps insertion order, so the first key is the oldest
  let originalsBytes = 0;
  // E-293 phase B: the scribe's area map (a .pmtiles file), one at a time, in memory like everything else
  // (D-61 item 8: a restart forgets it and the scribe sends it again). `wantedMap` is what the snapshot's
  // `maps` lists; `heldMap` is the bytes, once uploaded and fingerprint-checked.
  let wantedMap = null; // { sha, bytes, name, bbox }
  let heldMap = null; // { sha, buf }
  // E-287: the Setup file offered to phones (settings, op period, places; never the roster), memory only like the map.
  let wantedSetup = null; // { sha, bytes, name }
  let heldSetup = null; // { sha, buf, filename }
  const retiredKeys = []; // { hash: SHA-256 hex of a key superseded by a takeover, station }, newest last, capped
  const attempts = new Map(); // remote address -> { fails: number[], blockedUntil }
  const board = { name };
  // E-216: when the scribe's device last made a keyed call (the heartbeat), and which viewer addresses have
  // read the mission lately. The addresses are only ever counted: they are never printed, logged or returned.
  const viewers = new Map(); // remote address -> last time it read /api/mission

  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // ---- responses ----
  function send(res, status, body, headers) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, body === undefined ? headers : { 'Content-Type': 'application/json', ...headers });
    res.end(payload);
  }

  // ---- password rate limit: 5 wrong in 60 s blocks that address's password checks for 60 s ----
  function prune(t) {
    for (const [addr, a] of attempts) {
      a.fails = a.fails.filter((f) => t - f < RATE_WINDOW_MS);
      if (a.fails.length === 0 && a.blockedUntil <= t) attempts.delete(addr);
    }
  }
  function blockedFor(addr) {
    const a = attempts.get(addr);
    const t = now();
    return a && a.blockedUntil > t ? Math.ceil((a.blockedUntil - t) / 1000) : 0;
  }
  function recordFailure(addr) {
    const t = now();
    prune(t);
    const a = attempts.get(addr) || { fails: [], blockedUntil: 0 };
    a.fails.push(t);
    if (a.fails.length >= RATE_MAX_FAILS) { a.blockedUntil = t + RATE_BLOCK_MS; a.fails = []; }
    attempts.set(addr, a);
  }
  // Returns 'ok' | 'wrong' | 'blocked'. A MISSING password is 'wrong' but not counted: that is
  // a viewer arriving at a protected RangerView for the first time, not someone guessing.
  function checkPassword(req, expected) {
    const addr = req.socket.remoteAddress || '';
    const retry = blockedFor(addr);
    if (retry) return { result: 'blocked', retry };
    const given = req.headers['x-board-password'];
    if (typeof given === 'string' && safeEqual(given, expected)) { attempts.delete(addr); return { result: 'ok' }; }
    if (typeof given === 'string' && given !== '') recordFailure(addr);
    return { result: 'wrong' };
  }
  const sendBlocked = (res, retry) => send(res, 429, { error: 'Too many wrong passwords. Wait a minute and try again.', retryAfter: retry }, { 'Retry-After': String(retry) });

  // ---- who is asking ----
  // The publisher's calls. 409: nobody has claimed, or the key is from before a restart - the client
  // claims again and resends. 403: this station's key was superseded by a takeover - the client stops
  // publishing. Returns the station's publisher, or false after answering.
  function keyed(req, res) {
    if (publishers.size === 0) { send(res, 409, { state: 'unclaimed' }); return false; }
    const key = req.headers['x-board-key'];
    if (typeof key === 'string') {
      for (const p of publishers.values()) {
        if (safeEqual(key, p.key)) { p.seenAt = now(); return p; }
      }
      // A key this process never issued but that carries another process's tag: a restart forgot it.
      const dot = key.indexOf('.');
      if (dot > 0 && key.slice(0, dot) !== instance && /^[\w-]{8}$/.test(key.slice(0, dot))) { send(res, 409, { state: 'unclaimed' }); return false; }
    }
    // Who holds the station is told only to a device that provably held it (its key was superseded by a
    // takeover) or when RangerView is open anyway. Any other key gets no details, so a stranger on the
    // network learns nothing from a password-protected RangerView.
    const retired = typeof key === 'string' ? retiredKeys.find((r) => r.hash === digest(key).toString('hex')) : undefined;
    const holder = retired ? publishers.get(retired.station) : password ? undefined : primaryPublisher();
    send(res, 403, holder ? { state: 'replaced', by: holder.by, at: holder.at } : { state: 'replaced' });
    return false;
  }
  // A viewer's calls. No publisher means no password exists yet, so there is nothing to check.
  function viewerAllowed(req, res) {
    if (publishers.size === 0 || !password) return true;
    const { result, retry } = checkPassword(req, password);
    if (result === 'ok') return true;
    if (result === 'blocked') sendBlocked(res, retry);
    else send(res, 401, { needPassword: true });
    return false;
  }
  const primaryPublisher = () => publishers.get(primary);
  const lettersNow = () => [...publishers.keys()].filter(Boolean).sort();

  const modeLine = () => (password ? 'Password required' : 'Open to this network');
  const byLine = (by) => `${by.mission || '(unnamed mission)'}, op period ${by.opPeriod || '?'}, by ${by.scribe || 'a scribe with no name set'} (${by.agent || 'unknown browser'})`;

  // ---- originals: an in-memory LRU, oldest dropped first ----
  function storeOriginal(sha, buf) {
    if (originals.has(sha)) { originalsBytes -= originals.get(sha).length; originals.delete(sha); }
    while (originalsBytes + buf.length > originalsCap && originals.size > 0) {
      const oldest = originals.keys().next().value;
      originalsBytes -= originals.get(oldest).length;
      originals.delete(oldest);
    }
    if (buf.length > originalsCap) return false;
    originals.set(sha, buf);
    originalsBytes += buf.length;
    return true;
  }

  // The first valid entry of the snapshot's `maps` (v1 sends at most one: the custom map or the demo's detail).
  function wantedMapOf(mission) {
    for (const m of Array.isArray(mission.maps) ? mission.maps : []) {
      const sha = m && typeof m.sha256 === 'string' ? m.sha256.toLowerCase() : '';
      const bytes = Number(m && m.bytes);
      if (!SHA_RE.test(sha) || !Number.isInteger(bytes) || bytes <= 0) continue;
      const bbox = Array.isArray(m.bbox) && m.bbox.length === 4 && m.bbox.every((n) => Number.isFinite(n)) ? m.bbox.map(Number) : null;
      return { sha, bytes, name: cleanText(m.name, 120), bbox };
    }
    return null;
  }

  function wantedSetupOf(mission) {
    const m = mission.setup;
    const sha = m && typeof m.sha256 === 'string' ? m.sha256.toLowerCase() : '';
    const bytes = Number(m && m.bytes);
    if (!SHA_RE.test(sha) || !Number.isInteger(bytes) || bytes <= 0) return null;
    return { sha, bytes, name: cleanText(m.name, 120) };
  }

  function collectRefs(mission) {
    const found = new Map();
    for (const report of Array.isArray(mission.reports) ? mission.reports : []) {
      for (const a of report && Array.isArray(report.attachments) ? report.attachments : []) {
        const sha = a && typeof a.sha256 === 'string' ? a.sha256.toLowerCase() : '';
        if (!SHA_RE.test(sha) || a.removed || a.replaced || found.has(sha)) continue;
        found.set(sha, { size: Number(a.size), type: a.type });
      }
    }
    return found;
  }

  // D-72 item 4: what viewers may ask for is the union over every station's snapshot. Requests and held
  // originals nobody lists any more are dropped.
  function rebuildRefs() {
    refs = new Map();
    for (const m of stationRefs.values()) for (const [sha, r] of m) if (!refs.has(sha)) refs.set(sha, r);
    for (const sha of [...requests]) if (!refs.has(sha)) requests.delete(sha);
    for (const [sha, buf] of [...originals]) {
      if (!refs.has(sha)) { originals.delete(sha); originalsBytes -= buf.length; }
    }
  }

  // The primary changed hands or was cleared: the map and Setup file belong to the primary only, and the new
  // primary's own offers apply on its next publish.
  function dropPrimaryOffers() {
    wantedMap = null; heldMap = null; wantedSetup = null; heldSetup = null;
  }

  // ---- routes ----
  async function postClaim(req, res) {
    const body = await readJson(req, SMALL_BODY_LIMIT);
    const by = cleanBy(body && body.by);
    if (!by) { send(res, 400, { error: 'by is required' }); return; }
    const given = typeof body.password === 'string' ? body.password : '';
    const station = body.station === undefined || body.station === null ? '' : body.station;
    if (typeof station !== 'string' || !STATION_RE.test(station)) { send(res, 400, { error: 'station must be one upper-case letter A-Z, or empty' }); return; }
    const stamp = new Date(now()).toISOString();
    const who = station ? `station ${station}: ` : '';

    if (publishers.size === 0) {
      password = given;
      primary = station;
      const first = { station, key: newKey(), by, at: stamp, seenAt: 0 };
      publishers.set(station, first);
      log(`RangerView claimed: ${who}${byLine(by)}, ${clock(now())}`);
      log(modeLine());
      send(res, 200, { key: first.key, stations: lettersNow() });
      onClaim();
      return;
    }

    const present = publishers.get(station);
    const entitled = () => !password || safeEqual(given, password);

    if (!present) {
      // Joining: a station not yet publishing. Needs the password when there is one. A reclaim may join too.
      if (body.reclaim === true) {
        if (!entitled()) { send(res, 409, { error: 'claimed' }); return; }
      } else if (password) {
        const addr = req.socket.remoteAddress || '';
        const retry = blockedFor(addr);
        if (retry) { sendBlocked(res, retry); return; }
        if (!entitled()) { recordFailure(addr); send(res, 403, { error: 'password', needPassword: true }); return; }
        attempts.delete(addr);
      }
      if (publishers.size >= MAX_STATIONS) { send(res, 409, { error: 'too-many-stations' }); return; }
      const joined = { station, key: newKey(), by, at: stamp, seenAt: 0 };
      publishers.set(station, joined);
      log(`Station joined: ${who || '(no station letter) '}${byLine(by)}, ${clock(now())} (${publishers.size} publishing)`);
      send(res, 200, { key: joined.key, stations: lettersNow() });
      onClaim();
      return;
    }

    // An automatic re-claim (the client's answer to a 409 after a restart) never takes over: a
    // device superseded before the restart may re-claim first-come, and must not then be able
    // to swap this station back and forth with the real publisher with nobody acting. Only a claim
    // without reclaim - a person pressing "Take over" - falls through to the takeover below.
    if (body.reclaim === true) {
      send(res, 409, entitled() ? { error: 'claimed', by: present.by, at: present.at } : { error: 'claimed' });
      return;
    }
    // Takeover of THIS station. With a password set, the claim body must carry it; with none, anyone may.
    if (password) {
      const addr = req.socket.remoteAddress || '';
      const retry = blockedFor(addr);
      if (retry) { sendBlocked(res, retry); return; }
      if (!entitled()) {
        recordFailure(addr);
        send(res, 403, { error: 'claimed', needPassword: true });
        return;
      }
      attempts.delete(addr);
    }
    const previous = { by: present.by, at: present.at };
    retiredKeys.push({ hash: digest(present.key).toString('hex'), station });
    if (retiredKeys.length > 20) retiredKeys.shift();
    const taken = { station, key: newKey(), by, at: stamp, seenAt: 0, previous };
    publishers.set(station, taken);
    // Only the primary's holder may set a new password, as before; another station keeps the board's.
    if (station === primary && given !== '') password = given;
    log(`Publisher changed to ${who}${byLine(by)}, ${clock(now())} (was ${previous.by.scribe || 'unnamed'}, ${previous.by.mission || 'unnamed mission'})`);
    log(modeLine());
    send(res, 200, { key: taken.key, tookOverFrom: previous, stations: lettersNow() });
    onClaim();
  }

  async function postPassword(req, res) {
    if (!keyed(req, res)) return;
    const body = await readJson(req, SMALL_BODY_LIMIT);
    const me = keyed(req, res);
    if (!me) return;
    // Rung 2: the password is the board's, and the first station to connect owns it.
    if (me.station !== primary) { send(res, 403, { state: 'not-primary', primary }); return; }
    password = body && typeof body.password === 'string' ? body.password : '';
    log(modeLine());
    send(res, 204);
    onClaim();
  }

  // The station's device turned RangerView off. Its publisher and snapshot go; the oldest station left
  // becomes primary, and the last one leaving puts RangerView back to unclaimed.
  function postLeave(req, res) {
    const me = keyed(req, res);
    if (!me) return;
    publishers.delete(me.station);
    snapshots.delete(me.station);
    stationRefs.delete(me.station);
    rebuildRefs();
    log(`Station left: ${me.station ? `station ${me.station}: ` : ''}${me.by.scribe || 'unnamed'}, ${clock(now())} (${publishers.size} still publishing)`);
    if (publishers.size === 0) {
      password = ''; primary = null; dropPrimaryOffers();
    } else if (me.station === primary) {
      primary = publishers.keys().next().value;
      dropPrimaryOffers();
      log(`Station ${primary || '(no letter)'} is now the first station.`);
    }
    send(res, 204);
    onClaim();
  }

  async function postMission(req, res) {
    if (!keyed(req, res)) return;
    const body = await readJson(req, MISSION_BODY_LIMIT);
    if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'Snapshot must be a JSON object' }); return; }
    const me = keyed(req, res); // the claim may have moved while the body was arriving
    if (!me) return;
    snapshots.set(me.station, body);
    stationRefs.set(me.station, collectRefs(body));
    // The snapshots are the only authority on what viewers may ask for and what is worth holding.
    rebuildRefs();
    // The map and the Setup file come from the primary's snapshot only; another station's fields are ignored.
    if (me.station === primary) {
      wantedMap = wantedMapOf(body);
      if (heldMap && (!wantedMap || wantedMap.sha !== heldMap.sha)) heldMap = null;
      wantedSetup = wantedSetupOf(body);
      if (heldSetup && (!wantedSetup || wantedSetup.sha !== heldSetup.sha)) heldSetup = null;
    }
    log(`[${new Date(now()).toLocaleTimeString()}] Published${publishers.size > 1 ? ` by station ${me.station || '(no letter)'}` : ''}: "${cleanText(body.mission) || '(unnamed)'}" - ${(Array.isArray(body.reports) ? body.reports : []).length} report(s).`);
    send(res, 204);
  }

  function getRequests(req, res) {
    const me = keyed(req, res);
    if (!me) return;
    // A station is asked only for files its own snapshot lists; the area map and Setup file are the primary's.
    const mine = stationRefs.get(me.station) || new Map();
    const isPrimary = me.station === primary;
    // E-293 phase B: also whether the area map the snapshot lists is still to be sent.
    send(res, 200, { state: 'ok', requests: [...requests].filter((sha) => mine.has(sha)), ...(isPrimary && wantedMap ? { map: { sha256: wantedMap.sha, held: !!heldMap } } : {}), ...(isPrimary && wantedSetup ? { setup: { sha256: wantedSetup.sha, held: !!heldSetup } } : {}) });
  }

  // Counts each address that read the mission in the last minute. Nothing else is kept about it.
  function noteViewer(req) {
    viewers.set(req.socket.remoteAddress || '', now());
  }
  function viewerCount(windowMs = 60000) {
    const t = now();
    for (const [addr, seen] of viewers) if (t - seen >= windowMs) viewers.delete(addr);
    return viewers.size;
  }

  function getMission(req, res) {
    if (publishers.size === 0) { noteViewer(req); send(res, 200, { waiting: true }); return; }
    // Password before "no snapshot yet": a protected RangerView shouldn't tell a stranger even that
    // much, and a viewer with a saved password just sees "Waiting for the scribe..." after it.
    if (!viewerAllowed(req, res)) return;
    noteViewer(req);
    if (snapshots.size === 0) { send(res, 200, { waiting: true }); return; }
    const head = primaryPublisher();
    // The primary's snapshot gives the header fields; until it has published, the oldest station that has will do.
    const baseStation = snapshots.has(primary) ? primary : snapshots.keys().next().value;
    const info = { by: head.by, at: head.at, open: !password, name: board.name };
    if (head.seenAt) info.scribeSeenAt = new Date(head.seenAt).toISOString();
    if (wifi) info.wifi = wifi;
    if (head.previous) info.previous = head.previous;
    const payload = { ...snapshots.get(baseStation), board: info };
    const listOf = (st) => { const snap = snapshots.get(st); return snap && Array.isArray(snap.reports) ? snap.reports : []; };
    if (publishers.size > 1) {
      // Every station's reports, each marked with the publisher's letter (a report's own msgNo letter is never touched).
      payload.reports = [];
      for (const st of publishers.keys()) {
        for (const r of listOf(st)) payload.reports.push(r && typeof r === 'object' && !Array.isArray(r) ? { ...r, station: st } : r);
      }
    }
    payload.stations = [...publishers.values()].map((p) => {
      const snap = snapshots.get(p.station);
      return {
        station: p.station, scribe: p.by.scribe,
        mission: snap ? cleanText(snap.mission) : p.by.mission, opPeriod: p.by.opPeriod,
        seenAt: p.seenAt ? new Date(p.seenAt).toISOString() : '', reports: listOf(p.station).length,
        ...(snap && snap.event ? { event: cleanText(snap.event) } : {}),
      };
    });
    send(res, 200, payload);
  }

  function postRequest(req, res, sha) {
    if (!viewerAllowed(req, res)) return;
    if (snapshots.size === 0 || !refs.has(sha)) { send(res, 404, { error: 'That file is not in the current snapshot.' }); return; }
    if (originals.has(sha)) { send(res, 200, { ready: true }); return; }
    requests.add(sha);
    send(res, 202, { pending: true });
  }

  function getAttachment(req, res, sha) {
    if (!viewerAllowed(req, res)) return;
    const held = originals.get(sha);
    if (held) {
      res.writeHead(200, {
        'Content-Type': safeContentType((refs.get(sha) || {}).type),
        'Content-Length': held.length,
        'Cache-Control': 'no-store',
        // Attachment bytes are scribe-supplied. Never let a browser treat them as a page on this origin.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      });
      res.end(held);
      return;
    }
    if (requests.has(sha)) { send(res, 202, { pending: true }); return; }
    send(res, 404, { error: 'Not held.' });
  }

  async function postAttachment(req, res, sha) {
    const me = keyed(req, res);
    if (!me) return;
    const ref = (stationRefs.get(me.station) || new Map()).get(sha);
    if (!requests.has(sha) || !ref) { send(res, 404, { error: 'That file was not requested.' }); return; }
    if (!Number.isInteger(ref.size) || ref.size < 0) { send(res, 400, { error: 'The snapshot gives no valid size for this file.' }); return; }
    if (ref.size > uploadCap) { send(res, 413, { error: 'File is over the per-upload limit.', limit: uploadCap }); return; }
    const buf = await readBody(req, ref.size);
    if (!keyed(req, res)) return;
    if (!requests.has(sha)) { send(res, 404, { error: 'That file is no longer requested.' }); return; }
    if (buf.length !== ref.size) { send(res, 400, { error: 'Size does not match the snapshot.', expected: ref.size, received: buf.length }); return; }
    // Viewers re-check the fingerprint themselves (D-60 item 9), so this is a courtesy that stops
    // a corrupt upload being held and shown as "ready"; the viewer's check is the safeguard.
    if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) { send(res, 422, { error: 'Fingerprint does not match.' }); return; }
    if (!storeOriginal(sha, buf)) { send(res, 413, { error: 'File is larger than RangerView can hold.' }); return; }
    requests.delete(sha);
    send(res, 204);
  }

  // ---- E-293 phase B: the area map ----
  function getMap(req, res, sha) {
    if (!viewerAllowed(req, res)) return;
    if (!heldMap || heldMap.sha !== sha) { send(res, 404, { error: 'That map is not held.' }); return; }
    const size = heldMap.buf.length;
    const base = {
      'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
    };
    const range = parseRange(req.headers.range, size);
    if (range === 'bad') { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 }); res.end(); return; }
    const part = range || { start: 0, end: size - 1 };
    res.writeHead(range ? 206 : 200, {
      ...base, 'Content-Length': part.end - part.start + 1,
      ...(range ? { 'Content-Range': `bytes ${part.start}-${part.end}/${size}` } : {}),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(heldMap.buf.subarray(part.start, part.end + 1));
  }

  async function postMap(req, res, sha) {
    const me = keyed(req, res);
    if (!me) return;
    if (me.station !== primary || !wantedMap || wantedMap.sha !== sha) { send(res, 404, { error: 'That map is not in the current snapshot.' }); return; }
    if (wantedMap.bytes > mapCap) { send(res, 413, { error: 'The map is over the RangerView map limit.', limit: mapCap }); return; }
    if (heldMap && heldMap.sha === sha) { send(res, 204); return; }
    const buf = await readBody(req, wantedMap.bytes);
    if (!keyed(req, res)) return;
    if (!wantedMap || wantedMap.sha !== sha) { send(res, 404, { error: 'That map is no longer in the snapshot.' }); return; }
    if (buf.length !== wantedMap.bytes) { send(res, 400, { error: 'Size does not match the snapshot.', expected: wantedMap.bytes, received: buf.length }); return; }
    if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) { send(res, 422, { error: 'Fingerprint does not match.' }); return; }
    heldMap = { sha, buf };
    log(`[${new Date(now()).toLocaleTimeString()}] Area map received: ${wantedMap.name || 'map'} (${(buf.length / 1048576).toFixed(1)} MB).`);
    send(res, 204);
  }

  // ---- E-287: the Setup file for phones ----
  function getSetup(req, res, sha) {
    if (!viewerAllowed(req, res)) return;
    if (!heldSetup || heldSetup.sha !== sha) { send(res, 404, { error: 'That Setup file is not held.' }); return; }
    res.writeHead(200, {
      'Content-Type': 'application/zip', 'Content-Length': heldSetup.buf.length, 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${heldSetup.filename}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox',
    });
    res.end(req.method === 'HEAD' ? undefined : heldSetup.buf);
  }

  async function postSetup(req, res, sha) {
    const me = keyed(req, res);
    if (!me) return;
    if (me.station !== primary || !wantedSetup || wantedSetup.sha !== sha) { send(res, 404, { error: 'That Setup file is not in the current snapshot.' }); return; }
    if (wantedSetup.bytes > setupCap) { send(res, 413, { error: 'The Setup file is over the RangerView limit.', limit: setupCap }); return; }
    if (heldSetup && heldSetup.sha === sha) { send(res, 204); return; }
    const buf = await readBody(req, wantedSetup.bytes);
    if (!keyed(req, res)) return;
    if (!wantedSetup || wantedSetup.sha !== sha) { send(res, 404, { error: 'That Setup file is no longer in the snapshot.' }); return; }
    if (buf.length !== wantedSetup.bytes) { send(res, 400, { error: 'Size does not match the snapshot.', expected: wantedSetup.bytes, received: buf.length }); return; }
    if (crypto.createHash('sha256').update(buf).digest('hex') !== sha) { send(res, 400, { error: 'Fingerprint does not match.' }); return; }
    // Rule 5: whatever the snapshot says, the file itself must hold no roster and no photos.
    const checked = checkSetupZip(buf);
    if (!checked.ok) {
      log(`[${new Date(now()).toLocaleTimeString()}] Setup file refused: ${checked.reason}`);
      send(res, 422, { error: checked.reason });
      return;
    }
    const label = cleanText(snapshots.get(primary) && snapshots.get(primary).mission, 80).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'mission';
    heldSetup = { sha, buf, filename: `${label}-setup.zip` };
    log(`[${new Date(now()).toLocaleTimeString()}] Setup file received (${(buf.length / 1024).toFixed(0)} KB).`);
    send(res, 204);
  }

  async function route(req, res, urlPath) {
    const m = req.method;
    const wrongMethod = () => send(res, 405, { error: 'Method not allowed' });
    // E-216: lets the app tell "a RangerView" from "something else". No password, no claim, no state read.
    if (urlPath === '/api/hello') return m === 'GET' ? send(res, 200, { app: 'rangertrak-board', name: board.name, version, ...(update() ? { newer: update().version } : {}) }) : wrongMethod();
    if (urlPath === '/api/claim') return m === 'POST' ? postClaim(req, res) : wrongMethod();
    if (urlPath === '/api/password') return m === 'POST' ? postPassword(req, res) : wrongMethod();
    if (urlPath === '/api/leave') return m === 'POST' ? postLeave(req, res) : wrongMethod();
    if (urlPath === '/api/requests') return m === 'GET' ? getRequests(req, res) : wrongMethod();
    if (urlPath === '/api/mission') {
      if (m === 'POST') return postMission(req, res);
      return m === 'GET' ? getMission(req, res) : wrongMethod();
    }
    const mapPath = /^\/api\/map\/([^/]*)$/.exec(urlPath);
    if (mapPath) {
      if (!SHA_RE.test(mapPath[1])) { send(res, 400, { error: 'Not a SHA-256 fingerprint (64 lower-case hex digits).' }); return; }
      if (m === 'GET' || m === 'HEAD') return getMap(req, res, mapPath[1]);
      return m === 'POST' ? postMap(req, res, mapPath[1]) : wrongMethod();
    }
    const setupPath = /^\/api\/setup\/([^/]*)$/.exec(urlPath);
    if (setupPath) {
      if (!SHA_RE.test(setupPath[1])) { send(res, 400, { error: 'Not a SHA-256 fingerprint (64 lower-case hex digits).' }); return; }
      if (m === 'GET' || m === 'HEAD') return getSetup(req, res, setupPath[1]);
      return m === 'POST' ? postSetup(req, res, setupPath[1]) : wrongMethod();
    }
    const sha = /^\/api\/(request|attachments)\/([^/]*)$/.exec(urlPath);
    if (sha) {
      if (!SHA_RE.test(sha[2])) { send(res, 400, { error: 'Not a SHA-256 fingerprint (64 lower-case hex digits).' }); return; }
      if (sha[1] === 'request') return m === 'POST' ? postRequest(req, res, sha[2]) : wrongMethod();
      if (m === 'GET') return getAttachment(req, res, sha[2]);
      return m === 'POST' ? postAttachment(req, res, sha[2]) : wrongMethod();
    }
    send(res, 404, { error: 'Unknown API path' });
  }

  // The PWA runs on its own origin, so every call is cross-origin. No cookies or credentials
  // are involved - the secrets travel in headers the page sets itself - so a wildcard origin is
  // the simplest correct answer, not a shortcut.
  function handle(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Board-Key, X-Board-Password, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    route(req, res, req.url.split('?')[0]).catch((e) => {
      if (res.headersSent) { res.destroy(); return; }
      const status = e.status || 500;
      if (status === 413) {
        // The client may still be sending; answer, then drop the connection rather than read on.
        res.setHeader('Connection', 'close');
        res.on('finish', () => req.destroy());
      }
      send(res, status, { error: status === 500 ? 'Internal error' : e.message });
    });
  }

  // For the QR code: whether anyone has claimed RangerView, and the viewer password if there is one.
  const claimState = () => ({ claimed: publishers.size > 0, password });

  // For the server's own console status line (E-216). Times are epoch ms (0 = never); no addresses.
  function status() {
    const snap = snapshots.get(primary);
    const reports = snap && Array.isArray(snap.reports) ? snap.reports : [];
    const last = reports.reduce((m, r) => Math.max(m, Date.parse(r && r.date) || 0), 0);
    const head = primaryPublisher();
    return {
      claimed: publishers.size > 0,
      // E-291 (c): the same words as the claim line, and no brackets (the status line adds its own).
      scribe: head ? head.by.scribe || 'a scribe with no name set' : '',
      claimedAt: head ? Date.parse(head.at) : 0,
      scribeSeenAt: Math.max(0, ...[...publishers.values()].map((p) => p.seenAt)),
      viewers: viewerCount(),
      lastReportAt: last,
    };
  }

  return { handle, board, claimState, viewerCount, status };
}

module.exports = { createBoard, SHA_RE };
