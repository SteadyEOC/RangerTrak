// D-61 / D-60 - the Board's HTTP API: who may publish, who may read, and how a full-size
// attachment gets from the scribe's device to a viewer.
//
// ALL state is in this process's memory and nothing here touches the disk (D-61 item 8): the
// claim (publisher, password, key), the latest snapshot, the viewers' pending requests, and the
// requested originals. A restart forgets everything, on purpose; the scribe's device notices
// (every keyed call answers 409 'unclaimed'), claims again and re-sends (D-61 item 6).
//
// A claim body may carry `reclaim: true`. The client sets it only for the AUTOMATIC re-claim after
// a 409 (restart), never for a person's "Take over". A reclaim on an unclaimed Board is a normal
// first claim; on a claimed Board it never takes over (409 'claimed') - see postClaim().
//
// Two secrets, never printed or logged anywhere in this file:
//   - the viewer PASSWORD (optional; blank = the Wi-Fi is the boundary), sent by viewers in
//     X-Board-Password;
//   - the publish KEY, issued fresh on every claim and takeover, sent by the publisher in
//     X-Board-Key. Only the current key may publish or upload, so a takeover cuts the old device
//     off at once.
const crypto = require('crypto');

const SHA_RE = /^[0-9a-f]{64}$/;
const SMALL_BODY_LIMIT = 64 * 1024;
const MISSION_BODY_LIMIT = 25 * 1024 * 1024; // as before: generous for JSON, cheap insurance
const MB500 = 500 * 1024 * 1024;
const RATE_MAX_FAILS = 5;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_BLOCK_MS = 60 * 1000;

// Compared as SHA-256 digests so the two buffers always have the same length, which is what
// timingSafeEqual requires - and so the comparison leaks nothing about the length either.
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Text that ends up on the server's console or on the Board. Control characters are stripped so
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
 * @param {Function} [o.update]         () => { version } of a newer kit, once the start-up check finds one (update-check.js)
 * @param {string}   [o.wifi]           the Wi-Fi network's name when the server could read it, told to viewers
 *                                      so "Lost the Board" can ask "Still on <name>?" (E-216)
 */
function createBoard({ log = () => {}, now = Date.now, originalsCap = MB500, uploadCap = MB500, name = '', onClaim = () => {}, version = '', wifi = '', update = () => null } = {}) {
  let claim = null; // { key, password, by, at, previous? }
  let snapshot = null;
  let refs = new Map(); // sha -> { size, type }, the non-removed attachment refs in the snapshot
  const requests = new Set();
  const originals = new Map(); // sha -> Buffer; Map keeps insertion order, so the first key is the oldest
  let originalsBytes = 0;
  const retiredKeys = []; // SHA-256 hex of keys superseded by a takeover, newest last, capped
  const attempts = new Map(); // remote address -> { fails: number[], blockedUntil }
  const board = { name };
  // E-216: when the scribe's device last made a keyed call (the heartbeat), and which viewer addresses have
  // read the mission lately. The addresses are only ever counted: they are never printed, logged or returned.
  let scribeSeenAt = 0;
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
  // a viewer arriving at a protected Board for the first time, not someone guessing.
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
  // The publisher's calls. 409: nobody has claimed (a restart) - the client claims again and
  // resends. 403: somebody else holds the Board now - the client stops publishing.
  function keyed(req, res) {
    if (!claim) { send(res, 409, { state: 'unclaimed' }); return false; }
    const key = req.headers['x-board-key'];
    if (typeof key !== 'string' || !safeEqual(key, claim.key)) {
      // Who holds the Board is told only to a device that provably held it (its key was
      // superseded by a takeover) or when the Board is open anyway. Any other key gets no details,
      // so a stranger on the network learns nothing from a password-protected Board.
      const known = typeof key === 'string' && retiredKeys.includes(digest(key).toString('hex'));
      send(res, 403, !claim.password || known ? { state: 'replaced', by: claim.by, at: claim.at } : { state: 'replaced' });
      return false;
    }
    scribeSeenAt = now();
    return true;
  }
  // A viewer's calls. No claim means no password exists yet, so there is nothing to check.
  function viewerAllowed(req, res) {
    if (!claim || !claim.password) return true;
    const { result, retry } = checkPassword(req, claim.password);
    if (result === 'ok') return true;
    if (result === 'blocked') sendBlocked(res, retry);
    else send(res, 401, { needPassword: true });
    return false;
  }

  const modeLine = () => (claim.password ? 'Password required' : 'Open to this network');
  const byLine = (by) => `${by.mission || '(unnamed mission)'}, op period ${by.opPeriod || '?'}, by ${by.scribe || '(unnamed)'} (${by.agent || 'unknown browser'})`;

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

  // ---- routes ----
  async function postClaim(req, res) {
    const body = await readJson(req, SMALL_BODY_LIMIT);
    const by = cleanBy(body && body.by);
    if (!by) { send(res, 400, { error: 'by is required' }); return; }
    const password = typeof body.password === 'string' ? body.password : '';

    if (!claim) {
      claim = { key: crypto.randomBytes(32).toString('base64url'), password, by, at: new Date(now()).toISOString() };
      log(`Board claimed: ${byLine(by)}, ${clock(now())}`);
      log(modeLine());
      send(res, 200, { key: claim.key });
      onClaim();
      return;
    }

    // An automatic re-claim (the client's answer to a 409 after a restart) never takes over: a
    // device superseded before the restart may re-claim first-come, and must not then be able
    // to swap the Board back and forth with the real publisher with nobody acting. Only a claim
    // without reclaim - a person pressing "Take over" - falls through to the takeover below.
    if (body.reclaim === true) {
      const entitled = !claim.password || safeEqual(password, claim.password);
      send(res, 409, entitled ? { error: 'claimed', by: claim.by, at: claim.at } : { error: 'claimed' });
      return;
    }
    // Takeover. With a password set, the claim body must carry it; with none, anyone may.
    if (claim.password) {
      const addr = req.socket.remoteAddress || '';
      const retry = blockedFor(addr);
      if (retry) { sendBlocked(res, retry); return; }
      if (!safeEqual(password, claim.password)) {
        recordFailure(addr);
        send(res, 403, { error: 'claimed', needPassword: true });
        return;
      }
      attempts.delete(addr);
    }
    const previous = { by: claim.by, at: claim.at };
    retiredKeys.push(digest(claim.key).toString('hex'));
    if (retiredKeys.length > 20) retiredKeys.shift();
    claim = {
      key: crypto.randomBytes(32).toString('base64url'),
      password: password !== '' ? password : claim.password,
      by, at: new Date(now()).toISOString(), previous,
    };
    log(`Publisher changed to ${byLine(by)}, ${clock(now())} (was ${previous.by.scribe || 'unnamed'}, ${previous.by.mission || 'unnamed mission'})`);
    log(modeLine());
    send(res, 200, { key: claim.key, tookOverFrom: previous });
    onClaim();
  }

  async function postPassword(req, res) {
    if (!keyed(req, res)) return;
    const body = await readJson(req, SMALL_BODY_LIMIT);
    if (!keyed(req, res)) return;
    claim.password = body && typeof body.password === 'string' ? body.password : '';
    log(modeLine());
    send(res, 204);
    onClaim();
  }

  async function postMission(req, res) {
    if (!keyed(req, res)) return;
    const body = await readJson(req, MISSION_BODY_LIMIT);
    if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'Snapshot must be a JSON object' }); return; }
    if (!keyed(req, res)) return; // the claim may have moved while the body was arriving
    snapshot = body;
    refs = collectRefs(body);
    // The snapshot is the only authority on what viewers may ask for and what is worth holding.
    for (const sha of [...requests]) if (!refs.has(sha)) requests.delete(sha);
    for (const [sha, buf] of [...originals]) {
      if (!refs.has(sha)) { originals.delete(sha); originalsBytes -= buf.length; }
    }
    log(`[${new Date(now()).toLocaleTimeString()}] Published: "${cleanText(body.mission) || '(unnamed)'}" - ${(Array.isArray(body.reports) ? body.reports : []).length} report(s).`);
    send(res, 204);
  }

  function getRequests(req, res) {
    if (!keyed(req, res)) return;
    send(res, 200, { state: 'ok', requests: [...requests] });
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
    if (!claim) { noteViewer(req); send(res, 200, { waiting: true }); return; }
    // Password before "no snapshot yet": a protected Board shouldn't tell a stranger even that
    // much, and a viewer with a saved password just sees "Waiting for the scribe..." after it.
    if (!viewerAllowed(req, res)) return;
    noteViewer(req);
    if (!snapshot) { send(res, 200, { waiting: true }); return; }
    const info = { by: claim.by, at: claim.at, open: !claim.password, name: board.name };
    if (scribeSeenAt) info.scribeSeenAt = new Date(scribeSeenAt).toISOString();
    if (wifi) info.wifi = wifi;
    if (claim.previous) info.previous = claim.previous;
    send(res, 200, { ...snapshot, board: info });
  }

  function postRequest(req, res, sha) {
    if (!viewerAllowed(req, res)) return;
    if (!snapshot || !refs.has(sha)) { send(res, 404, { error: 'That file is not in the current snapshot.' }); return; }
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
    if (!keyed(req, res)) return;
    const ref = refs.get(sha);
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
    if (!storeOriginal(sha, buf)) { send(res, 413, { error: 'File is larger than the Board can hold.' }); return; }
    requests.delete(sha);
    send(res, 204);
  }

  async function route(req, res, urlPath) {
    const m = req.method;
    const wrongMethod = () => send(res, 405, { error: 'Method not allowed' });
    // E-216: lets the app tell "a RangerTrak Board" from "something else". No password, no claim, no state read.
    if (urlPath === '/api/hello') return m === 'GET' ? send(res, 200, { app: 'rangertrak-board', name: board.name, version, ...(update() ? { newer: update().version } : {}) }) : wrongMethod();
    if (urlPath === '/api/claim') return m === 'POST' ? postClaim(req, res) : wrongMethod();
    if (urlPath === '/api/password') return m === 'POST' ? postPassword(req, res) : wrongMethod();
    if (urlPath === '/api/requests') return m === 'GET' ? getRequests(req, res) : wrongMethod();
    if (urlPath === '/api/mission') {
      if (m === 'POST') return postMission(req, res);
      return m === 'GET' ? getMission(req, res) : wrongMethod();
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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Board-Key, X-Board-Password');
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

  // For the QR code: whether anyone has claimed the Board, and the viewer password if there is one.
  const claimState = () => ({ claimed: !!claim, password: claim ? claim.password : '' });

  // For the server's own console status line (E-216). Times are epoch ms (0 = never); no addresses.
  function status() {
    const reports = snapshot && Array.isArray(snapshot.reports) ? snapshot.reports : [];
    const last = reports.reduce((m, r) => Math.max(m, Date.parse(r && r.date) || 0), 0);
    return {
      claimed: !!claim,
      scribe: claim ? claim.by.scribe || '(unnamed)' : '',
      claimedAt: claim ? Date.parse(claim.at) : 0,
      scribeSeenAt,
      viewers: viewerCount(),
      lastReportAt: last,
    };
  }

  return { handle, board, claimState, viewerCount, status };
}

module.exports = { createBoard, SHA_RE };
