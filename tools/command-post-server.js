// E-87 Stage 1 (2026-08-31) - "Command Post Server: serving the mission to nearby devices".
// See `E-87 Command Post Server.md` in the private docs for the full scoping this implements.
//
// Read-only mirror, not a sync server: the PWA running on a scribe's own device POSTs a
// redacted snapshot of the radio log here whenever it changes (opt-in, see MissionType's
// commandPostEnabled/commandPostServerUrl and command-post-publish.service.ts); this process
// just holds the LATEST one in memory and hands it back to anyone who asks. No persistence,
// no write-back, no identity, no conflict resolution - one writer, many readers, matching the
// "structurally simpler read problem" the 2026-08-15 exercise actually validated a need for.
//
// Forked from tools/serve-dist.js rather than extending it in place (the scoping doc's own
// §5 flagged this as a five-minute call either way, not worth blocking on): that file is a
// dev-only local-preview convenience nobody ships; this one is a real end-user feature with a
// different audience, and conflating "preview the build" with "run the command post" in one
// file risked the two drifting into each other by accident. Static-file serving below is
// intentionally the same logic, not a shared module - see that file if this ever needs to be
// reconciled with it.
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
// Small, server-tooling-only dependency (pure JS, no native deps, never touches the PWA
// bundle) - same exception this doc's own scoping already accepted for a QR code. See
// getOrCreateCert() below for why this server needs to generate a certificate at all.
const selfsigned = require('selfsigned');

const ROOT = path.join(__dirname, '..', 'dist', 'rangertrak', 'browser');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
// Never committed - see .gitignore's existing `/non-distributed` entry, reused here rather
// than inventing a second "local, not for git" convention. A private key belongs here even
// though it is self-signed and low-stakes: no reason to make a habit of committing one.
const CERT_DIR = path.join(__dirname, '..', 'non-distributed', 'command-post-cert');

// In-memory only, on purpose - see this file's own header comment. Never written to disk:
// the mission may carry field-report notes and coordinates, and this process has no reason
// to persist operator data past its own runtime (D-35).
let latestMission = null;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.pmtiles': 'application/octet-stream', '.txt': 'text/plain'
};

function sendStatic(res, filePath, stats, range) {
  const contentType = MIME[path.extname(filePath)] || 'application/octet-stream';

  if (range) {
    const size = stats.size;
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function serveStaticFile(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  fs.stat(filePath, (err, stats) => {
    // Found live testing this feature, 2026-08-31: a request for exactly `/view` (no
    // trailing slash - the natural, expected form for a typed/QR-coded URL, and what this
    // server's own startup message and the Settings UI both print) resolves to the
    // DIRECTORY `view/`, not a file. `stats.isFile()` is false for a directory, `/view` has
    // no extension, so without this branch it fell straight into the SPA fallback below and
    // silently served the real Angular app's index.html instead of the hand-written viewer
    // page - confirmed live via curl before this fix (`data-beasties-container`, an Angular-
    // build-only marker, showed up in the response for `/view`). Try `<path>/index.html`
    // before falling all the way back to the SPA shell.
    if (!err && stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (errIdx, statsIdx) => {
        if (!errIdx && statsIdx.isFile()) {
          sendStatic(res, indexPath, statsIdx, req.headers.range);
          return;
        }
        fallbackToSpaShell(res);
      });
      return;
    }

    if (err || !stats.isFile()) {
      if (path.extname(urlPath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`Not found: ${urlPath}`);
        return;
      }
      fallbackToSpaShell(res);
      return;
    }

    sendStatic(res, filePath, stats, req.headers.range);
  });
}

function fallbackToSpaShell(res) {
  const filePath = path.join(ROOT, 'index.html');
  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    sendStatic(res, filePath, stats, undefined);
  });
}

// The PWA runs on its own origin (rangertrak.org, or localhost:4200 in dev) - a different
// origin from this server even when both happen to run on the same laptop, since the port
// differs at minimum. That makes the publish POST a cross-origin request; without these
// headers the browser blocks it before it ever reaches the handlers below. No credentials
// are involved (no cookies, no auth) so a wildcard origin is the simplest correct answer,
// not a shortcut - see command-post-publish.service.ts's own header comment on why there is
// no join-code/auth model in this v1 for a wildcard to weaken.
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// A plain function now, not `http.createServer(...)`'s inline callback - the server itself
// is created in start() below, once the cert is ready, since https.createServer() needs the
// key/cert up front and getOrCreateCert() is async.
function requestHandler(req, res) {
  const urlPath = req.url.split('?')[0];

  if (urlPath === '/api/mission') {
    setCorsHeaders(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'POST') {
      // 25MB is generous for a JSON radio-log snapshot (no roster, no photos - see
      // command-post-publish.service.ts's own payload shape) and cheap insurance against a
      // misbehaving or malicious client filling this process's memory.
      readJsonBody(req, 25 * 1024 * 1024)
        .then((body) => {
          latestMission = body;
          console.log(`[${new Date().toLocaleTimeString()}] Published: "${body.mission || '(unnamed)'}" - ${(body.reports || []).length} report(s).`);
          res.writeHead(204);
          res.end();
        })
        .catch((e) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid request body: ${e.message}` }));
        });
      return;
    }

    if (req.method === 'GET') {
      if (!latestMission) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No mission has published yet.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(latestMission));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  serveStaticFile(req, res);
}

// Every non-internal IPv4 address this machine has, not just one guess - a laptop at a
// command post commonly has more than one active interface (WiFi + a wired uplink, or a
// USB-tethered phone hotspot) and there is no reliable way to know which one the field
// devices will actually be able to reach. Also feeds the cert's own SAN list below - a
// self-signed cert whose Subject Alternative Names don't include the address a device is
// actually connecting to gets a HOSTNAME-MISMATCH warning on top of the expected
// self-signed one, which is a strictly worse experience than one warning.
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

/**
 * 2026-08-31 (live discussion, same day as Stage 1 shipped): `CommandPostPublishService`'s
 * `fetch()` POST is blocked by mixed content on the real `https://rangertrak.org` deployment
 * - a browser refuses an HTTPS page's own fetch()/XHR to a plain HTTP endpoint outright, a
 * different mechanism than CORS (already handled, see setCorsHeaders()) and one this
 * feature's original scoping never checked. Self-signed HTTPS fixes it: once a device visits
 * this server's HTTPS URL directly and accepts the one-time "not private" warning (the same
 * pattern router admin pages / Plex / Synology already use), the browser trusts this exact
 * certificate for this exact host going forward, which satisfies mixed-content policy for
 * every subsequent fetch() too - not just the one direct visit. See `E-87 Command Post
 * Server.md`'s own dated banner for the full reasoning and what this does NOT fix
 * (authentication - still just the WiFi password, unchanged from Stage 1).
 *
 * Cached to disk (not regenerated every run) so a routine restart does not force every
 * already-trusted device to click through the warning again - but ONLY reused when its own
 * recorded address list still covers every address this run actually discovered. A laptop
 * commonly joins a DIFFERENT hotspot at the next incident, and an IP missing from the cert's
 * SAN list produces a hostname-mismatch warning regardless of caching, so correctness for
 * TODAY's network wins over reuse when the two conflict. IP-address SANs cannot be
 * wildcarded (unlike DNS-name SANs), so "cover every possible LAN IP" is not an option -
 * this is why the check exists at all, not just an optimization.
 */
async function getOrCreateCert(addresses) {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  const metaPath = path.join(CERT_DIR, 'addresses.json');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
    try {
      const cachedAddresses = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const stillCovered = addresses.every((a) => cachedAddresses.includes(a));
      if (stillCovered) {
        return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
      }
      console.log('Network address changed since the last cached certificate - generating a new one (every device will need to accept it once more).');
    } catch (e) {
      console.log(`Cached certificate unreadable (${e.message}) - generating a new one.`);
    }
  }

  const altNames = [
    { type: 2, value: 'localhost' }, // type 2 = DNS name
    { type: 7, ip: '127.0.0.1' },    // type 7 = IP address
    ...addresses.map((ip) => ({ type: 7, ip })),
  ];
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'RangerTrak Command Post' }],
    {
      days: 3650, keySize: 2048, algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
        { name: 'subjectAltName', altNames },
      ],
    }
  );

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify(addresses));

  return { key: pems.private, cert: pems.cert };
}

/**
 * Raised live 2026-08-31: "does the user still have to get the server address and plug it
 * into our server field - manually?" - yes, still, but this closes the copy-it-out half:
 * whoever is AT THIS LAPTOP can paste the primary address straight into Mission Setup's
 * "Server address" field instead of retyping it from the console. Does not help a coordinator
 * setting up a DIFFERENT device (a scribe's own phone/laptop) - that address still has to be
 * read off this console and typed there by hand; there is no discovery mechanism (mDNS or
 * similar) for the PWA to find this server on its own, and browsers have no API for that
 * regardless. Best-effort and silent on failure - a clipboard miss should never be treated as
 * the server itself failing to start.
 */
function copyToClipboard(text) {
  try {
    if (process.platform === 'win32') {
      execSync('clip', { input: text });
    } else if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text });
    } else {
      // Linux: no single guaranteed-installed clipboard tool: try the two most common,
      // don't treat either's absence as an error.
      const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
      if (xclip.error) {
        spawnSync('xsel', ['--clipboard', '--input'], { input: text });
      }
    }
    return true;
  } catch {
    return false;
  }
}

function printLanUrls(addresses) {
  const primaryUrl = `https://${addresses[0] || 'localhost'}:${PORT}`;

  console.log('');
  console.log('RangerTrak Board');
  console.log('================');
  console.log(`Serving ${ROOT}`);
  console.log('');
  console.log('Give teams this address to view the live comms log:');
  console.log('');
  if (addresses.length === 0) {
    console.log('  (no non-internal network interface found - check your WiFi/hotspot connection)');
  }
  for (const addr of addresses) {
    console.log(`  https://${addr}:${PORT}/view`);
  }
  console.log(`  https://localhost:${PORT}/view   (this machine only)`);
  console.log('');
  console.log('FIRST VISIT ON EACH DEVICE: the browser will warn "Your connection is not');
  console.log('private" - that is expected for a private server with no public certificate');
  console.log('authority, the same warning router admin pages show. Click Advanced, then');
  console.log('Proceed. Needed ONCE per device; the browser remembers it after that.');
  console.log('');
  console.log('In RangerTrak\'s own Mission Setup, turn on "Publish to Command Post Server" and');
  console.log(`set the server address to one of the URLs above (without /view), e.g.:`);
  console.log(`  ${primaryUrl}`);
  console.log('(Visit that address directly in THIS device\'s own browser first, and accept the');
  console.log('warning, before turning the toggle on - publishing fails silently otherwise.)');

  if (copyToClipboard(primaryUrl)) {
    console.log('');
    console.log(`Copied to the clipboard on THIS computer: ${primaryUrl}`);
    console.log('(Other devices still need to read it off this screen - there is no way for');
    console.log('their browsers to discover it automatically.)');
  }
  console.log('');
}

async function start() {
  const addresses = getLanAddresses();
  const { key, cert } = await getOrCreateCert(addresses);
  const server = https.createServer({ key, cert }, requestHandler);
  server.listen(PORT, () => printLanUrls(addresses));
}

start();
