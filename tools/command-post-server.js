// E-87 Stage 1 (2026-08-31) - "Command Post Server: serving the mission to nearby devices".
// See `E-87 Command Post Server.md` in the private docs for the full scoping this implements.
// Revised for D-61 (the Board's name, port, local-network-only listening, viewer password and
// single publisher) and D-60 (full-size attachments on request).
//
// Read-only mirror, not a sync server: the PWA running on a scribe's own device POSTs a
// redacted snapshot of the radio log here whenever it changes (opt-in, see MissionType's
// commandPostEnabled/commandPostServerUrl and command-post-publish.service.ts); this process
// just holds the LATEST one in memory and hands it back to anyone who asks. No persistence,
// no write-back, no identity, no conflict resolution - one writer, many readers, matching the
// "structurally simpler read problem" the 2026-08-15 exercise actually validated a need for.
//
// Where things live: this file starts the servers and serves the static viewer; tools/board/
// holds the pieces with their own tests - net.js (which addresses may be listened on),
// mdns.js (the rangertrak-board.local name) and protocol.js (the API, the claim, the secrets).
//
// Forked from tools/serve-dist.js rather than extending it in place (the scoping doc's own
// §5 flagged this as a five-minute call either way, not worth blocking on): that file is a
// dev-only local-preview convenience nobody ships; this one is a real end-user feature with a
// different audience, and conflating "preview the build" with "run the command post" in one
// file risked the two drifting into each other by accident. Static-file serving below is
// intentionally the same logic, not a shared module - see that file if this ever needs to be
// reconciled with it.
//
//   node tools/command-post-server.js [--port N] [--name label] [--allow-public]
//     --port N        (or the PORT env var) use exactly this port, no fallback
//     --name label    ask for <label>.local instead of rangertrak-board.local
//     --allow-public  also listen on public addresses (never the default - D-61 item 3)
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
// Small, server-tooling-only dependency (pure JS, no native deps, never touches the PWA
// bundle) - same exception this doc's own scoping already accepted for a QR code. See
// getOrCreateCert() below for why this server needs to generate a certificate at all.
const selfsigned = require('selfsigned');
const { privateAddresses, isVirtualAdapter } = require('./board/net');
const { createResponder, sanitizeLabel } = require('./board/mdns');
const { createBoard } = require('./board/protocol');
const qr = require('./board/qr');
const { handleHello } = require('./board/hello');
const { boardCause } = require('./board/causes');
const selfcheck = require('./board/selfcheck');
const { startStatusLine } = require('./board/statusline');
const { version: APP_VERSION } = require('../package.json');

// E-255: the Board kit (tools/board-kit/) runs this file bundled, from a folder with the built
// app in app/ and the certificate kept in certificate/. Its entry sets this before loading us.
const KIT_DIR = process.env.RANGERTRAK_BOARD_KIT || '';
const ROOT = KIT_DIR ? path.join(KIT_DIR, 'app') : path.join(__dirname, '..', 'dist', 'rangertrak', 'browser');
const DEFAULT_LABEL = 'rangertrak-board';
const PREFERRED_PORT = 443;
const FALLBACK_PORT = 8080;
// Never committed - see .gitignore's existing `/non-distributed` entry, reused here rather
// than inventing a second "local, not for git" convention. A private key belongs here even
// though it is self-signed and low-stakes: no reason to make a habit of committing one.
const CERT_DIR = KIT_DIR ? path.join(KIT_DIR, 'certificate') : path.join(__dirname, '..', 'non-distributed', 'command-post-cert');

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

/**
 * 2026-08-31 (live discussion, same day as Stage 1 shipped): `CommandPostPublishService`'s
 * `fetch()` POST is blocked by mixed content on the real `https://rangertrak.org` deployment
 * - a browser refuses an HTTPS page's own fetch()/XHR to a plain HTTP endpoint outright, a
 * different mechanism than CORS (handled in tools/board/protocol.js) and one this
 * feature's original scoping never checked. Self-signed HTTPS fixes it: once a device visits
 * this server's HTTPS URL directly and accepts the one-time "not private" warning (the same
 * pattern router admin pages / Plex / Synology already use), the browser trusts this exact
 * certificate for this exact host going forward, which satisfies mixed-content policy for
 * every subsequent fetch() too - not just the one direct visit. See `E-87 Command Post
 * Server.md`'s own dated banner for the full reasoning. (Authentication is the claim and the
 * optional viewer password now - D-61 - not this certificate.)
 *
 * Cached to disk (not regenerated every run) so a routine restart does not force every
 * already-trusted device to click through the warning again - but ONLY reused when its own
 * recorded address and name lists still cover everything this run actually needs. A laptop
 * commonly joins a DIFFERENT hotspot at the next incident, and an IP missing from the cert's
 * SAN list produces a hostname-mismatch warning regardless of caching, so correctness for
 * TODAY's network wins over reuse when the two conflict. IP-address SANs cannot be
 * wildcarded (unlike DNS-name SANs), so "cover every possible LAN IP" is not an option -
 * this is why the check exists at all, not just an optimization.
 *
 * D-61: the SAN list also carries the `.local` name actually taken (rangertrak-board.local, or
 * -2 / -3 if another Board already held it). The same coverage rule applies: a cached cert that
 * lacks today's name is replaced. The cache file used to be a bare array of addresses; that
 * old shape reads as "addresses, no names", so the first run after upgrading regenerates once.
 */
async function getOrCreateCert(addresses, names = [], certDir = CERT_DIR) {
  const keyPath = path.join(certDir, 'key.pem');
  const certPath = path.join(certDir, 'cert.pem');
  const metaPath = path.join(certDir, 'addresses.json');

  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      const cachedAddresses = Array.isArray(cached) ? cached : cached.addresses || [];
      const cachedNames = Array.isArray(cached) ? [] : cached.names || [];
      const stillCovered = addresses.every((a) => cachedAddresses.includes(a)) && names.every((n) => cachedNames.includes(n));
      if (stillCovered) {
        return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
      }
      console.log('Network address or Board name changed since the last cached certificate - generating a new one (every device will need to accept it once more).');
    } catch (e) {
      console.log(`Cached certificate unreadable (${e.message}) - generating a new one.`);
    }
  }

  const altNames = [
    { type: 2, value: 'localhost' }, // type 2 = DNS name
    ...names.map((value) => ({ type: 2, value })),
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

  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(metaPath, JSON.stringify({ addresses, names }));

  return { key: pems.private, cert: pems.cert };
}

/**
 * One https server per address, all sharing one handler and one certificate (D-61 item 3: the
 * Board listens on the addresses it chose, not on 0.0.0.0). If ANY address fails to bind, the
 * ones already open are closed and the error is thrown, so the caller can retry everything on
 * another port rather than run half-open. Exported so the protocol tests can start a real
 * instance on a random port with a throwaway certificate.
 *
 * `port` 0 asks the OS for a free one - only meaningful with a single address, since each
 * address would otherwise get a different port.
 */
async function createServer({ port, cert, addresses = ['127.0.0.1'], name = '', log = console.log, boardOptions = {} }) {
  const servers = [];
  // D-61 item 7: the address a phone should open, and the password if the Board has one.
  const qrState = () => ({ host: name || addresses[0], port: servers[0].address().port, ...claimState() });
  const printQr = async () => {
    try {
      const s = qrState();
      log('');
      log(`Scan to open the Board on a phone (${qr.plainUrl(s)}):`);
      log(await qr.terminalQr(qr.viewUrl(s)));
      log(`To show it full screen on this computer, open https://localhost${s.port === 443 ? '' : ':' + s.port}/qr`);
    } catch (e) {
      log(`Could not draw the QR code (${e.message}); use the address above.`);
    }
  };
  const { handle, board, claimState, viewerCount, status } = createBoard({ log, name, ...boardOptions, onClaim: printQr });
  const handler = (req, res) => {
    if (req.url.startsWith('/api/')) return handle(req, res);
    // E-216: reachability check. No data, no password, not a claim and not a viewer.
    if (req.url.split('?')[0] === '/hello' && (req.method === 'GET' || req.method === 'HEAD')) {
      handleHello(req, res, name);
      return undefined;
    }
    if (req.url.split('?')[0] === '/qr') {
      qr.handleQr(req, res, qrState).catch(() => { if (!res.headersSent) { res.writeHead(500); } res.end(); });
      return undefined;
    }
    return serveStaticFile(req, res);
  };
  const closeAll = () => Promise.all(servers.map((s) => new Promise((resolve) => {
    s.close(() => resolve());
    s.closeAllConnections(); // keep-alive connections would otherwise hold close() open
  })));

  try {
    for (const address of addresses) {
      const server = https.createServer({ key: cert.key, cert: cert.cert }, handler);
      // Node's default gives a request five minutes to finish. A scribe uploading a 400 MB
      // video over weak Wi-Fi can need longer, and the body size is already capped.
      server.requestTimeout = 0;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, address, () => { server.removeListener('error', reject); resolve(); });
      });
      servers.push(server);
    }
  } catch (e) {
    await closeAll();
    throw e;
  }
  return { servers, port: servers[0].address().port, board, viewerCount, status, close: closeAll };
}

// 443 is the clean address (no port to type), but it needs privileges on Linux/macOS and is
// often taken on a laptop that also runs a web server. Either way the answer is 8080, and the
// address printed afterwards is the one that actually worked (D-61 item 2). A port forced with
// --port / PORT is never second-guessed: it fails plainly if busy.
async function listenWithFallback(opts, forcedPort) {
  if (forcedPort) return createServer({ ...opts, port: forcedPort });
  try {
    return await createServer({ ...opts, port: PREFERRED_PORT });
  } catch (e) {
    if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
    console.log(`Port ${PREFERRED_PORT} is ${e.code === 'EACCES' ? 'not permitted' : 'already in use'} on ${e.address || 'this machine'} - using ${FALLBACK_PORT} instead.`);
    return createServer({ ...opts, port: FALLBACK_PORT });
  }
}

/**
 * Raised live 2026-08-31: "does the user still have to get the server address and plug it
 * into our server field - manually?" - this closes the copy-it-out half: whoever is AT THIS
 * LAPTOP can paste the address straight into Mission Setup's "Server address" field instead of
 * retyping it from the console. (Other devices read it off this screen, or type the .local
 * name; the browser has no API to discover a server by itself.) Best-effort and silent on
 * failure - a clipboard miss should never be treated as the server itself failing to start.
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

function printBoardUrls({ name, label, port, addresses, skipped, checkLines = [], boxed = false }) {
  const hostPort = (host) => (port === 443 ? host : `${host}:${port}`);
  const nameUrl = name ? `https://${hostPort(name)}` : null;
  const primaryUrl = nameUrl || `https://${hostPort(addresses[0] || 'localhost')}`;

  console.log('');
  console.log('RangerTrak Board');
  console.log('================');
  console.log(`Serving ${ROOT}`);
  console.log('');
  // E-216: what was found out about this computer and its network. ✔ fine, ✖ will stop devices connecting, · worth knowing.
  for (const line of checkLines) console.log(line);
  if (checkLines.length) console.log('');
  if (boxed) for (const line of selfcheck.boxedAddress(`${primaryUrl}/view`)) console.log(line);
  if (skipped.length > 0) {
    console.log(`Not listening on public address${skipped.length > 1 ? 'es' : ''} ${skipped.join(', ')} - the Board is for the local network only.`);
    console.log('');
  }
  if (!name) {
    console.log(`Couldn't announce ${label}.local; use the address below.`);
    console.log('');
  }
  console.log('Give teams this address to view the live comms log:');
  console.log('');
  if (nameUrl) console.log(`  ${nameUrl}/view`);
  for (const addr of addresses) {
    console.log(`  https://${hostPort(addr)}/view${nameUrl && addr === addresses[0] ? '   (if the name does not open, e.g. on an older Android phone)' : ''}`);
  }
  console.log(`  https://${hostPort('localhost')}/view   (this machine only)`);
  console.log('');
  console.log(`To show a QR code for phones full screen, open https://${hostPort('localhost')}/qr on this computer.`);
  console.log('(It is shown here too once the scribe turns on publishing. That page works from this computer only.)');
  if (name && name !== `${label}.local`) {
    console.log('');
    console.log(`Note: ${label}.local was already taken on this network, so this Board is ${name}.`);
  }
  console.log('');
  console.log('FIRST VISIT ON EACH DEVICE: the browser will warn "Your connection is not');
  console.log(`private" for ${name || 'this address'} - that is expected for a private server with no public`);
  console.log('certificate authority, the same warning router admin pages show. Click Advanced,');
  console.log('then Proceed. Needed ONCE per device and name; the browser remembers it after that.');
  console.log('');
  console.log('In RangerTrak, on the Mission page\'s RangerTrak Board card, turn on "Send this log to a');
  console.log('RangerTrak Board" and set the server address to the first address above (without /view),');
  console.log('even when RangerTrak runs on this same computer, e.g.:');
  console.log(`  ${primaryUrl}`);
  console.log('(Visit that address directly in THIS device\'s own browser first, and accept the');
  console.log('warning, before turning the toggle on - publishing fails silently otherwise.)');

  if (copyToClipboard(primaryUrl)) {
    console.log('');
    console.log(`Copied to the clipboard on THIS computer: ${primaryUrl}`);
  }
  console.log('');
  console.log('Waiting for the scribe\'s device to publish. Press Ctrl+C to stop.');
  console.log('');
}

function parseArgs(argv) {
  const args = { allowPublic: false, port: process.env.PORT ? parseInt(process.env.PORT, 10) : 0, label: DEFAULT_LABEL };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow-public') args.allowPublic = true;
    else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--name') args.label = sanitizeLabel(argv[++i] || '') || DEFAULT_LABEL;
  }
  if (args.port && !(args.port > 0 && args.port < 65536)) {
    console.log('The port must be a number from 1 to 65535.');
    process.exit(1);
  }
  return args;
}

async function start() {
  const args = parseArgs(process.argv.slice(2));
  const found = privateAddresses(os.networkInterfaces());

  if (found.lan.length === 0 && !args.allowPublic) {
    console.log('No private network address found, so there is nothing safe to serve on.');
    console.log('The Board only serves the local network (10.x, 172.16-31.x, 192.168.x or 169.254.x).');
    console.log('Connect to the Wi-Fi or hotspot and start it again. To listen on a public address');
    console.log('anyway, start with --allow-public.');
    if (found.skipped.length > 0) console.log(`(Only public address${found.skipped.length > 1 ? 'es' : ''} found: ${found.skipped.join(', ')})`);
    process.exit(1);
  }
  // The Wi-Fi name is told to viewers ("Still on <name>?"), so it is read before the Board starts. Never fatal.
  const wifiPromise = selfcheck.readWifi();
  const listenOn = args.allowPublic ? [...found.listen, ...found.skipped] : found.listen;
  const reachable = args.allowPublic ? [...found.lan, ...found.skipped] : found.lan;
  const skipped = args.allowPublic ? [] : found.skipped;

  // The name must be settled BEFORE the certificate (it goes in the SAN list) and the server
  // is not announced until it is actually listening, so mDNS is claimed first and announced last.
  const responder = createResponder({ label: args.label, addresses: reachable.length ? reachable : found.lan, log: console.log });
  const name = reachable.length ? await responder.claim() : null;
  if (name && name !== `${args.label}.local`) console.log(`${args.label}.local was already taken on this network; this Board is ${name}.`);

  let running;
  try {
    const cert = await getOrCreateCert(reachable, name ? [name] : []);
    const wifi = await wifiPromise;
    running = await listenWithFallback({ cert, addresses: listenOn, name: name || '', log: console.log, boardOptions: { version: APP_VERSION, wifi } }, args.port);
  } catch (e) {
    await responder.stop();
    const where = e.address ? ` on ${e.address}` : '';
    console.log(`Could not start the Board${where}: ${e.code === 'EADDRINUSE' ? `port ${args.port || FALLBACK_PORT} is already in use` : e.code === 'EACCES' ? `not permitted to use port ${args.port || FALLBACK_PORT}` : e.message}`);
    process.exit(1);
  }

  responder.announce();

  // E-216: the start-up self-check. Every part is best-effort; none can stop the Board.
  const wifi = await wifiPromise;
  const nets = os.networkInterfaces();
  const inUse = Object.keys(nets).filter((n) => !isVirtualAdapter(n) && (nets[n] || []).some((a) => reachable.includes(a.address)));
  const fellBack = !args.port && running.port !== PREFERRED_PORT;
  const owner = fellBack ? await selfcheck.portOwner({ port: PREFERRED_PORT }) : '';
  const portLine = fellBack
    ? `✖ ${boardCause('port-taken', { port: PREFERRED_PORT, other: running.port, name: owner }).message}`
    : '';
  const runChecks = () => selfcheck.runSelfCheck({ port: running.port, inUse });
  let check = await runChecks();
  const listFor = (c) => selfcheck.formatSelfCheck({ check: c, wifi, virtual: found.virtual, portLine });
  // John 10-21: offer the fixes after one Windows prompt, never silently, and only at a keyboard.
  const fixes = selfcheck.offerableFixes(check);
  if (process.stdin.isTTY && (fixes.publicAliases.length || fixes.addRule)) {
    console.log('');
    console.log('Checking this computer:');
    for (const line of listFor(check)) console.log(line);
    if (await selfcheck.offerFixes({ check }) === 'ran') {
      check = await runChecks();   // look again, and say what the fix did
      console.log('Checked again after the fix.');
    }
  }
  printBoardUrls({ name, label: args.label, port: running.port, addresses: reachable, skipped, checkLines: listFor(check), boxed: fellBack });
  startStatusLine({ status: running.status });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await responder.stop(); // sends the goodbye so neighbours forget the name at once
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createServer, getOrCreateCert, start };

if (require.main === module) start();
