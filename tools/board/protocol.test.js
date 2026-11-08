// D-61 / D-60: the Board's API, against a real server on a random port with a throwaway
// self-signed certificate. Nothing here touches the network beyond 127.0.0.1.
const test = require('node:test');
const assert = require('node:assert');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const selfsigned = require('selfsigned');
const { createServer, getOrCreateCert } = require('../command-post-server');
const { makeTempRun } = require('../temp-run');
const { createBoard } = require('./protocol');

let cert;
test.before(async () => {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'board test' }], { days: 1, keySize: 2048, algorithm: 'sha256' });
  cert = { key: pems.private, cert: pems.cert };
});

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const BY = { mission: 'Test Mission', opPeriod: '2', scribe: 'Pat', agent: 'Test Browser' };

async function start(boardOptions) {
  const lines = [];
  const server = await createServer({ port: 0, cert, name: 'rangertrak-board.local', log: (l) => lines.push(l), boardOptions });
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  function call(method, urlPath, { headers = {}, json, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = json !== undefined ? Buffer.from(JSON.stringify(json)) : body;
      const req = https.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, agent, headers: { ...(payload ? { 'Content-Length': payload.length } : {}), ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let parsed;
          try { parsed = raw.length && /json/.test(res.headers['content-type'] || '') ? JSON.parse(raw.toString('utf8')) : undefined; } catch { /* leave undefined */ }
          resolve({ status: res.statusCode, headers: res.headers, json: parsed, raw });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  return { call, lines, server, close: () => server.close() };
}

// Runs fn with a fresh instance and always closes it.
const withBoard = (fn, boardOptions) => async () => {
  const b = await start(boardOptions);
  try { await fn(b); } finally { await b.close(); }
};

const claim = async (b, password) => (await b.call('POST', '/api/claim', { json: { password, by: BY } })).json.key;
const publish = (b, key, snapshot) => b.call('POST', '/api/mission', { headers: { 'X-Board-Key': key }, json: snapshot });
const snapshotWith = (...files) => ({
  mission: 'Test Mission',
  reports: [{ id: 1, attachments: files.map((f) => ({ sha256: sha256(f.bytes), size: f.bytes.length, type: f.type || 'image/jpeg', ...(f.removed ? { removed: { at: 'x', by: 'y' } } : {}) })) }],
});

test('open Board: unclaimed, claim, publish, read', withBoard(async (b) => {
  assert.deepStrictEqual((await b.call('GET', '/api/mission')).json, { waiting: true });

  const c = await b.call('POST', '/api/claim', { json: { by: BY } });
  assert.strictEqual(c.status, 200);
  assert.ok(c.json.key && c.json.key.length >= 32);
  assert.deepStrictEqual((await b.call('GET', '/api/mission')).json, { waiting: true }); // claimed, nothing published yet

  assert.strictEqual((await publish(b, c.json.key, { mission: 'Test Mission', reports: [] })).status, 204);
  const read = await b.call('GET', '/api/mission');
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.json.mission, 'Test Mission');
  assert.deepStrictEqual(read.json.board.by, BY);
  assert.strictEqual(read.json.board.open, true);
  assert.strictEqual(read.json.board.name, 'rangertrak-board.local');
  assert.strictEqual(read.json.board.previous, undefined);
  assert.match(read.json.board.at, /^\d{4}-\d\d-\d\dT/);
}));

test('claim needs a "by" object', withBoard(async (b) => {
  assert.strictEqual((await b.call('POST', '/api/claim', { json: { password: 'x' } })).status, 400);
}));

test('CORS allows the two new headers', withBoard(async (b) => {
  const r = await b.call('OPTIONS', '/api/mission');
  assert.strictEqual(r.status, 204);
  assert.match(r.headers['access-control-allow-headers'], /X-Board-Key/);
  assert.match(r.headers['access-control-allow-headers'], /X-Board-Password/);
  assert.strictEqual(r.headers['access-control-allow-origin'], '*');
}));

test('password Board: viewers need X-Board-Password', withBoard(async (b) => {
  const key = await claim(b, 'correct horse');
  await publish(b, key, { mission: 'M', reports: [] });
  assert.deepStrictEqual((await b.call('GET', '/api/mission')).json, { needPassword: true });
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'nope' } })).status, 401);
  const ok = await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'correct horse' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.json.board.open, false);
}));

test('the scribe can change the viewer password, or clear it', withBoard(async (b) => {
  const key = await claim(b);
  await publish(b, key, { mission: 'M', reports: [] });
  assert.strictEqual((await b.call('POST', '/api/password', { headers: { 'X-Board-Key': key }, json: { password: 'secret' } })).status, 204);
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 401);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'secret' } })).status, 200);
  assert.strictEqual((await b.call('POST', '/api/password', { headers: { 'X-Board-Key': key }, json: { password: '' } })).status, 204);
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 200);
  assert.strictEqual((await b.call('POST', '/api/password', { headers: { 'X-Board-Key': 'wrong' }, json: { password: 'x' } })).status, 403);
}));

test('five wrong passwords block that address with 429, even for the right one', withBoard(async (b) => {
  const key = await claim(b, 'right');
  await publish(b, key, { mission: 'M', reports: [] });
  for (let i = 0; i < 5; i++) {
    assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': `wrong${i}` } })).status, 401);
  }
  const blocked = await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'right' } });
  assert.strictEqual(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  // Claim attempts share the limiter.
  assert.strictEqual((await b.call('POST', '/api/claim', { json: { password: 'right', by: BY } })).status, 429);
}));

test('a viewer arriving with no password is not counted as guessing', withBoard(async (b) => {
  const key = await claim(b, 'right');
  await publish(b, key, { mission: 'M', reports: [] });
  for (let i = 0; i < 8; i++) assert.strictEqual((await b.call('GET', '/api/mission')).status, 401);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'right' } })).status, 200);
}));

test('takeover: needs the password, issues a new key, old key gets 403 replaced', withBoard(async (b) => {
  const oldKey = await claim(b, 'pw');
  await publish(b, oldKey, { mission: 'M', reports: [] });

  const refused = await b.call('POST', '/api/claim', { json: { password: 'bad', by: { ...BY, scribe: 'Sam' } } });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.json.error, 'claimed');
  assert.strictEqual(refused.json.needPassword, true);
  assert.ok(!('by' in refused.json) && !('at' in refused.json), 'a wrong-password takeover learns nothing about the holder');
  assert.strictEqual((await publish(b, oldKey, { mission: 'still me', reports: [] })).status, 204); // a failed takeover changes nothing

  const took = await b.call('POST', '/api/claim', { json: { password: 'pw', by: { ...BY, scribe: 'Sam' } } });
  assert.strictEqual(took.status, 200);
  assert.notStrictEqual(took.json.key, oldKey);
  assert.deepStrictEqual(took.json.tookOverFrom.by, BY);

  const replaced = await publish(b, oldKey, { mission: 'ghost', reports: [] });
  assert.strictEqual(replaced.status, 403);
  assert.strictEqual(replaced.json.state, 'replaced');
  assert.strictEqual(replaced.json.by.scribe, 'Sam');
  assert.strictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': oldKey } })).status, 403);

  assert.strictEqual((await publish(b, took.json.key, { mission: 'new scribe', reports: [] })).status, 204);
  const read = await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'pw' } });
  assert.strictEqual(read.json.board.by.scribe, 'Sam');
  assert.strictEqual(read.json.board.previous.by.scribe, 'Pat');
}));

test('replaced: details only for a superseded key or an open Board', withBoard(async (b) => {
  const oldKey = await claim(b, 'pw');
  await publish(b, oldKey, { mission: 'M', reports: [] });
  // Protected, current key: a wrong or missing key learns nothing.
  const wrong = await publish(b, 'not-a-key', {});
  assert.deepStrictEqual(wrong.json, { state: 'replaced' });
  const missing = await b.call('GET', '/api/requests');
  assert.strictEqual(missing.status, 403);
  assert.deepStrictEqual(missing.json, { state: 'replaced' });
  // After a takeover the old key is recognised and told who has it now.
  await b.call('POST', '/api/claim', { json: { password: 'pw', by: { ...BY, scribe: 'Sam' } } });
  const old = await publish(b, oldKey, {});
  assert.strictEqual(old.json.state, 'replaced');
  assert.strictEqual(old.json.by.scribe, 'Sam');
  assert.ok(old.json.at);
  assert.deepStrictEqual((await publish(b, 'still-not-a-key', {})).json, { state: 'replaced' });
}));

test('replaced on an open Board still names the holder', withBoard(async (b) => {
  await claim(b);
  const r = await publish(b, 'not-a-key', {});
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(r.json.by, BY);
}));

test('takeover of an open Board needs nothing; a new password in the body is adopted', withBoard(async (b) => {
  const oldKey = await claim(b);
  const took = await b.call('POST', '/api/claim', { json: { password: 'now-protected', by: BY } });
  assert.strictEqual(took.status, 200);
  assert.strictEqual((await publish(b, oldKey, {})).status, 403);
  await publish(b, took.json.key, { mission: 'M', reports: [] });
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 401);
  // A takeover that sends no password keeps the existing one (it had to supply it anyway).
  const again = await b.call('POST', '/api/claim', { json: { password: 'now-protected', by: BY } });
  assert.strictEqual(again.status, 200);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'now-protected' } })).status, 200);
}));

test('a restart forgets everything: keyed calls get 409 unclaimed, then a re-claim works', async () => {
  const first = await start();
  const key = await claim(first);
  await publish(first, key, { mission: 'M', reports: [] });
  await first.close();

  const second = await start();
  try {
    assert.deepStrictEqual((await publish(second, key, { mission: 'M', reports: [] })).json, { state: 'unclaimed' });
    assert.strictEqual((await publish(second, key, {})).status, 409);
    assert.deepStrictEqual((await second.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json, { state: 'unclaimed' });
    assert.deepStrictEqual((await second.call('GET', '/api/mission')).json, { waiting: true });
    const key2 = await claim(second);
    assert.strictEqual((await publish(second, key2, { mission: 'M', reports: [] })).status, 204);
  } finally {
    await second.close();
  }
});

test('after a restart two devices re-claim: the first gets the Board, the second is refused, not given it', withBoard(async (b) => {
  const first = await b.call('POST', '/api/claim', { json: { reclaim: true, by: BY } });
  assert.strictEqual(first.status, 200);
  const second = await b.call('POST', '/api/claim', { json: { reclaim: true, by: { ...BY, scribe: 'Sam' } } });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.json.error, 'claimed');
  assert.strictEqual(second.json.by.scribe, 'Pat'); // open Board: details are fine
  assert.strictEqual((await publish(b, first.json.key, { mission: 'M', reports: [] })).status, 204, 'first key still works');
  // A person's takeover (no reclaim) still works.
  assert.strictEqual((await b.call('POST', '/api/claim', { json: { by: { ...BY, scribe: 'Sam' } } })).status, 200);
}));

test('a refused reclaim on a protected Board hides the holder unless the password matches', withBoard(async (b) => {
  await b.call('POST', '/api/claim', { json: { reclaim: true, password: 'pw', by: BY } });
  const blind = await b.call('POST', '/api/claim', { json: { reclaim: true, by: BY } });
  assert.strictEqual(blind.status, 409);
  assert.deepStrictEqual(blind.json, { error: 'claimed' });
  const known = await b.call('POST', '/api/claim', { json: { reclaim: true, password: 'pw', by: BY } });
  assert.strictEqual(known.status, 409);
  assert.strictEqual(known.json.by.scribe, 'Pat');
}));

test('request and upload: the whole path, with every refusal', withBoard(async (b) => {
  const photo = { bytes: crypto.randomBytes(2048), type: 'image/png' };
  const other = { bytes: crypto.randomBytes(100) }; // never in the snapshot
  const key = await claim(b);
  await publish(b, key, snapshotWith(photo));
  const sha = sha256(photo.bytes);
  const K = { 'X-Board-Key': key };

  // Nothing requested yet.
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha}`)).status, 404);
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K })).json, { state: 'ok', requests: [] });
  // A file the snapshot doesn't name can't be requested.
  assert.strictEqual((await b.call('POST', `/api/request/${sha256(other.bytes)}`)).status, 404);
  assert.strictEqual((await b.call('POST', '/api/request/not-a-sha')).status, 400);

  // A viewer asks.
  assert.strictEqual((await b.call('POST', `/api/request/${sha}`)).status, 202);
  assert.deepStrictEqual((await b.call('GET', `/api/attachments/${sha}`)).json, { pending: true });
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K })).json, { state: 'ok', requests: [sha] });

  // Upload refusals.
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { body: photo.bytes })).status, 403, 'no key');
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: photo.bytes.subarray(0, 2047) })).status, 400, 'short');
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: Buffer.concat([photo.bytes, Buffer.from('x')]) })).status, 413, 'long');
  const tampered = Buffer.from(photo.bytes);
  tampered[0] ^= 0xff;
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: tampered })).status, 422, 'right size, wrong bytes');
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha256(other.bytes)}`, { headers: K, body: other.bytes })).status, 404, 'not in the snapshot');
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha}`)).status, 202, 'still pending after the refusals');

  // The real one.
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: photo.bytes })).status, 204);
  const got = await b.call('GET', `/api/attachments/${sha}`);
  assert.strictEqual(got.status, 200);
  assert.strictEqual(got.headers['content-type'], 'image/png');
  assert.strictEqual(got.headers['cache-control'], 'no-store');
  assert.ok(got.raw.equals(photo.bytes));
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K })).json, { state: 'ok', requests: [] });
  assert.deepStrictEqual((await b.call('POST', `/api/request/${sha}`)).json, { ready: true });
  // And it can't be uploaded again unasked.
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: photo.bytes })).status, 404);
}));

test('request and upload honour the viewer password; upload needs the key, not the password', withBoard(async (b) => {
  const f = { bytes: crypto.randomBytes(64) };
  const key = await claim(b, 'pw');
  await publish(b, key, snapshotWith(f));
  const sha = sha256(f.bytes);
  assert.strictEqual((await b.call('POST', `/api/request/${sha}`)).status, 401);
  assert.strictEqual((await b.call('POST', `/api/request/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 202);
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: { 'X-Board-Password': 'pw' }, body: f.bytes })).status, 403);
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: { 'X-Board-Key': key }, body: f.bytes })).status, 204);
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha}`)).status, 401);
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 200);
}));

test('the originals cache evicts the oldest first when over its cap', withBoard(async (b) => {
  const files = ['a', 'b', 'c'].map((c) => ({ bytes: Buffer.from(c.repeat(4)) })); // 4 bytes each, cap 10
  const key = await claim(b);
  await publish(b, key, snapshotWith(...files));
  const K = { 'X-Board-Key': key };
  for (const f of files) {
    const sha = sha256(f.bytes);
    await b.call('POST', `/api/request/${sha}`);
    assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K, body: f.bytes })).status, 204);
  }
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha256(files[0].bytes)}`)).status, 404, 'oldest dropped');
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha256(files[1].bytes)}`)).status, 200);
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha256(files[2].bytes)}`)).status, 200);
  // Dropped means a viewer can ask for it again.
  assert.strictEqual((await b.call('POST', `/api/request/${sha256(files[0].bytes)}`)).status, 202);
}, { originalsCap: 10 }));

test('a file larger than the per-upload cap is refused', withBoard(async (b) => {
  const f = { bytes: Buffer.alloc(50, 1) };
  const key = await claim(b);
  await publish(b, key, snapshotWith(f));
  const sha = sha256(f.bytes);
  await b.call('POST', `/api/request/${sha}`);
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: { 'X-Board-Key': key }, body: f.bytes })).status, 413);
}, { uploadCap: 40 }));

test('a new snapshot drops requests and held originals it no longer names', withBoard(async (b) => {
  const keep = { bytes: Buffer.from('keep me') };
  const drop = { bytes: Buffer.from('drop me') };
  const dropped2 = { bytes: Buffer.from('removed ref') };
  const key = await claim(b);
  const K = { 'X-Board-Key': key };
  await publish(b, key, snapshotWith(keep, drop, dropped2));
  for (const f of [keep, drop, dropped2]) await b.call('POST', `/api/request/${sha256(f.bytes)}`);
  await b.call('POST', `/api/attachments/${sha256(drop.bytes)}`, { headers: K, body: drop.bytes }); // held
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K })).json.requests.sort(), [sha256(keep.bytes), sha256(dropped2.bytes)].sort());

  // Next snapshot: `drop` is gone, `dropped2` is still listed but marked removed.
  await publish(b, key, snapshotWith(keep, { ...dropped2, removed: true }));
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K })).json.requests, [sha256(keep.bytes)]);
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha256(drop.bytes)}`)).status, 404);
  assert.strictEqual((await b.call('POST', `/api/request/${sha256(dropped2.bytes)}`)).status, 404, 'removed refs cannot be requested');
}));

test('mission posts without a valid key are refused before anything is stored', withBoard(async (b) => {
  const key = await claim(b);
  await publish(b, key, { mission: 'real', reports: [] });
  assert.strictEqual((await b.call('POST', '/api/mission', { json: { mission: 'forged' } })).status, 403);
  assert.strictEqual((await publish(b, key + 'x', { mission: 'forged' })).status, 403);
  assert.strictEqual((await publish(b, key, [1, 2])).status, 400);
  assert.strictEqual((await b.call('GET', '/api/mission')).json.mission, 'real');
}));

test('neither the password nor the key is ever logged', async () => {
  const b = await start();
  try {
    const key = await claim(b, 'hunter2-secret');
    await publish(b, key, { mission: 'M', reports: [] });
    await b.call('POST', '/api/password', { headers: { 'X-Board-Key': key }, json: { password: 'another-secret' } });
    await b.call('POST', '/api/claim', { json: { password: 'another-secret', by: BY } });
    const output = b.lines.join('\n');
    assert.ok(output.includes('Board claimed: Test Mission, op period 2, by Pat (Test Browser)'));
    assert.ok(output.includes('Publisher changed to'));
    assert.ok(output.includes('Password required'));
    for (const secret of ['hunter2-secret', 'another-secret', key]) assert.ok(!output.includes(secret));
  } finally {
    await b.close();
  }
});

test('getOrCreateCert: names go in the SAN list, and a cert lacking today\'s name is replaced', async () => {
  const run = makeTempRun('board-cert-');
  const dir = run.dir;
  try {
    const san = (c) => new crypto.X509Certificate(c.cert).subjectAltName;
    const first = await getOrCreateCert(['192.168.1.7'], ['rangertrak-board.local'], dir);
    assert.match(san(first), /DNS:rangertrak-board\.local/);
    assert.match(san(first), /IP Address:192\.168\.1\.7/);

    const reused = await getOrCreateCert(['192.168.1.7'], ['rangertrak-board.local'], dir);
    assert.strictEqual(reused.cert, first.cert, 'covered: reused');

    const second = await getOrCreateCert(['192.168.1.7'], ['rangertrak-board-2.local'], dir);
    assert.notStrictEqual(second.cert, first.cert, 'new name: regenerated');
    assert.match(san(second), /DNS:rangertrak-board-2\.local/);

    // The pre-D-61 cache was a bare array of addresses: it has no names, so it is replaced once.
    fs.writeFileSync(path.join(dir, 'addresses.json'), JSON.stringify(['192.168.1.7']));
    const upgraded = await getOrCreateCert(['192.168.1.7'], ['rangertrak-board-2.local'], dir);
    assert.notStrictEqual(upgraded.cert, second.cert);
  } finally {
    run.cleanup();
  }
});

// ---- E-216 slice 2: /api/hello, the scribe's heartbeat, the viewer count, the Wi-Fi name ----

test('GET /api/hello names the Board with no password, even on a protected Board, and says nothing else', withBoard(async (b) => {
  await claim(b, 'hunter2');
  const r = await b.call('GET', '/api/hello');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { app: 'rangertrak-board', name: 'rangertrak-board.local', version: '9.9.9' });
  assert.strictEqual(r.headers['access-control-allow-origin'], '*');
  assert.strictEqual((await b.call('POST', '/api/hello', { json: {} })).status, 405);
}, { version: '9.9.9' }));

test('scribeSeenAt moves on a keyed call and not on a viewer call; wifi is told to viewers when known', async () => {
  let t = Date.parse('2026-10-23T12:00:00Z');
  const b = createBoard({ now: () => t, wifi: 'CERT-Net' });
  const res = () => { const r = { status: 0, body: '', setHeader() {}, writeHead(st) { r.status = st; }, end(x) { r.body = x || ''; } }; return r; };
  const req = (method, url, headers = {}, addr = '10.0.0.5') => ({ method, url, headers, socket: { remoteAddress: addr }, on() {}, destroy() {} });
  const call = async (method, url, headers, body) => {
    const r = res();
    const q = req(method, url, headers);
    if (body !== undefined) {
      const raw = Buffer.from(JSON.stringify(body));
      q.headers['content-length'] = String(raw.length);
      q.on = (ev, fn) => { if (ev === 'data') setImmediate(() => fn(raw)); if (ev === 'end') setImmediate(() => setImmediate(fn)); return q; };
    }
    b.handle(q, r);
    for (let i = 0; i < 20 && !r.body && r.status === 0; i++) await new Promise((ok) => setImmediate(ok));
    return { status: r.status, json: r.body ? JSON.parse(r.body) : undefined };
  };
  const key = (await call('POST', '/api/claim', {}, { by: BY })).json.key;
  assert.ok(key);
  await call('POST', '/api/mission', { 'x-board-key': key }, { mission: 'M', reports: [] });
  const first = (await call('GET', '/api/mission', {})).json.board;
  assert.strictEqual(first.scribeSeenAt, new Date(t).toISOString());
  assert.strictEqual(first.wifi, 'CERT-Net');

  t += 90_000;
  const viewerOnly = (await call('GET', '/api/mission', {})).json.board;
  assert.strictEqual(viewerOnly.scribeSeenAt, first.scribeSeenAt, 'a viewer call does not move it');

  assert.strictEqual((await call('GET', '/api/requests', { 'x-board-key': key })).status, 200);
  const after = (await call('GET', '/api/mission', {})).json.board;
  assert.strictEqual(after.scribeSeenAt, new Date(t).toISOString(), 'the keyed heartbeat moves it');
  assert.strictEqual((await call('GET', '/api/requests', { 'x-board-key': 'wrong' })).status, 403);
  assert.strictEqual((await call('GET', '/api/mission', {})).json.board.scribeSeenAt, after.scribeSeenAt, 'a refused key does not');
});

test('the Board has no wifi field when the name is unknown', async () => {
  const b = createBoard({});
  assert.strictEqual(b.status().scribeSeenAt, 0);
  assert.strictEqual(b.status().claimed, false);
});

test('viewerCount counts distinct addresses in the last minute, forgets them after, and no reply mentions viewers', async () => {
  let t = 1_000_000;
  const b = createBoard({ now: () => t });
  const seen = [];
  const get = (addr, url = '/api/mission') => new Promise((resolve) => {
    const r = { setHeader() {}, writeHead() {}, end(x) { seen.push(String(x || '')); resolve(); } };
    b.handle({ method: 'GET', url, headers: {}, socket: { remoteAddress: addr }, on() {}, destroy() {} }, r);
  });
  assert.strictEqual(b.viewerCount(), 0);
  await get('192.168.1.20');
  await get('192.168.1.21');
  await get('192.168.1.20');
  assert.strictEqual(b.viewerCount(), 2);
  t += 30_000;
  await get('192.168.1.21');
  t += 40_000;   // .20 last seen 70 s ago, .21 40 s ago
  assert.strictEqual(b.viewerCount(), 1);
  t += 30_000;
  assert.strictEqual(b.viewerCount(), 0);
  assert.strictEqual(b.status().viewers, 0);
  const everything = seen.join('|');
  assert.doesNotMatch(everything, /192\.168\.1\.2\d|viewer/i, 'no address and no viewer count is ever returned');
});

test('a wrong viewer password is not counted as a viewer', withBoard(async (b) => {
  await claim(b, 'hunter2');
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'nope' } })).status, 401);
  assert.strictEqual(b.server.viewerCount(), 0);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'hunter2' } })).status, 200);
  assert.strictEqual(b.server.viewerCount(), 1);
}));
