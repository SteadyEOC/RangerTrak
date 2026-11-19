// D-61 / D-60: RangerView's API, against a real server on a random port with a throwaway
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
  const server = await createServer({ port: 0, cert, name: 'rangerview.local', log: (l) => lines.push(l), boardOptions });
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

test('open RangerView: unclaimed, claim, publish, read', withBoard(async (b) => {
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
  assert.strictEqual(read.json.board.name, 'rangerview.local');
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

test('password RangerView: viewers need X-Board-Password', withBoard(async (b) => {
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

test('replaced: details only for a superseded key or an open RangerView', withBoard(async (b) => {
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

test('replaced on an open RangerView still names the holder', withBoard(async (b) => {
  await claim(b);
  const r = await publish(b, 'not-a-key', {});
  assert.strictEqual(r.status, 403);
  assert.deepStrictEqual(r.json.by, BY);
}));

test('takeover of an open RangerView needs nothing; a new password in the body is adopted', withBoard(async (b) => {
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

test('after a restart two devices re-claim: the first gets RangerView, the second is refused, not given it', withBoard(async (b) => {
  const first = await b.call('POST', '/api/claim', { json: { reclaim: true, by: BY } });
  assert.strictEqual(first.status, 200);
  const second = await b.call('POST', '/api/claim', { json: { reclaim: true, by: { ...BY, scribe: 'Sam' } } });
  assert.strictEqual(second.status, 409);
  assert.strictEqual(second.json.error, 'claimed');
  assert.strictEqual(second.json.by.scribe, 'Pat'); // open RangerView: details are fine
  assert.strictEqual((await publish(b, first.json.key, { mission: 'M', reports: [] })).status, 204, 'first key still works');
  // A person's takeover (no reclaim) still works.
  assert.strictEqual((await b.call('POST', '/api/claim', { json: { by: { ...BY, scribe: 'Sam' } } })).status, 200);
}));

test('a refused reclaim on a protected RangerView hides the holder unless the password matches', withBoard(async (b) => {
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
    assert.ok(output.includes('RangerView claimed: Test Mission, op period 2, by Pat (Test Browser)'));
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
    const first = await getOrCreateCert(['192.168.1.7'], ['rangerview.local'], dir);
    assert.match(san(first), /DNS:rangerview.local/);
    assert.match(san(first), /IP Address:192\.168\.1\.7/);

    const reused = await getOrCreateCert(['192.168.1.7'], ['rangerview.local'], dir);
    assert.strictEqual(reused.cert, first.cert, 'covered: reused');

    // E-288: the fallback names come with it, and a new network address keeps the same certificate.
    assert.match(san(first), /DNS:rangerview-2\.local/)
    assert.match(san(first), /DNS:rangerview-9\.local/)
    const sameName2 = await getOrCreateCert(['192.168.1.7'], ['rangerview-2.local'], dir);
    assert.strictEqual(sameName2.cert, first.cert, 'a fallback name is already covered');
    const newNetwork = await getOrCreateCert(['10.0.0.44'], ['rangerview.local'], dir);
    assert.strictEqual(newNetwork.cert, first.cert, 'a new address alone does not make a new certificate');

    const second = await getOrCreateCert(['192.168.1.7'], ['ops.local'], dir);
    assert.notStrictEqual(second.cert, first.cert, 'new name: regenerated');
    assert.match(san(second), /DNS:ops-2\.local/);

    // The pre-D-61 cache was a bare array of addresses: it has no names, so it is replaced once.
    fs.writeFileSync(path.join(dir, 'addresses.json'), JSON.stringify(['192.168.1.7']));
    const upgraded = await getOrCreateCert(['192.168.1.7'], ['ops.local'], dir);
    assert.notStrictEqual(upgraded.cert, second.cert);
  } finally {
    run.cleanup();
  }
});

test('getOrCreateCert: a RangerView whose saved certificate names rangertrak-board.local gets a new one for rangerview.local (E-305)', async () => {
  const run = makeTempRun('board-cert-');
  const dir = run.dir;
  try {
    const san = (c) => new crypto.X509Certificate(c.cert).subjectAltName;
    const old = await getOrCreateCert(['192.168.1.7'], ['rangertrak-board.local'], dir);
    assert.match(san(old), /DNS:rangertrak-board.local/);
    const renamed = await getOrCreateCert(['192.168.1.7'], ['rangerview.local'], dir);
    assert.notStrictEqual(renamed.cert, old.cert, 'the old name does not cover the new one: regenerated');
    assert.match(san(renamed), /DNS:rangerview.local/);
  } finally {
    run.cleanup();
  }
});

// ---- E-216 slice 2: /api/hello, the scribe's heartbeat, the viewer count, the Wi-Fi name ----

test('GET /api/hello names RangerView with no password, even on a protected RangerView, and says nothing else', withBoard(async (b) => {
  await claim(b, 'hunter2');
  const r = await b.call('GET', '/api/hello');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { app: 'rangertrak-board', name: 'rangerview.local', version: '9.9.9' });
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

test('RangerView has no wifi field when the name is unknown', async () => {
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

// ---- E-293 phase B: the area map ----
const mapSnapshot = (bytes, extra = {}) => ({ mission: 'Test Mission', reports: [], maps: [{ sha256: sha256(bytes), bytes: bytes.length, name: 'Area', bbox: [-122.5, 47.3, -122.4, 47.5], ...extra }] });

test('area map: wanted, uploaded once, then read in byte ranges', withBoard(async (b) => {
  const map = crypto.randomBytes(5000);
  const sha = sha256(map);
  const key = await claim(b);
  assert.strictEqual((await publish(b, key, mapSnapshot(map))).status, 204);
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json.map, { sha256: sha, held: false });
  assert.strictEqual((await b.call('GET', `/api/map/${sha}`)).status, 404, 'nothing to read before the upload');

  assert.strictEqual((await b.call('POST', `/api/map/${sha}`, { body: map })).status, 403, 'no key, no upload');
  assert.strictEqual((await b.call('POST', `/api/map/${sha}`, { headers: { 'X-Board-Key': key }, body: map })).status, 204);
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json.map, { sha256: sha, held: true });
  assert.strictEqual((await b.call('POST', `/api/map/${sha}`, { headers: { 'X-Board-Key': key }, body: map })).status, 204, 'a repeat is harmless');

  const whole = await b.call('GET', `/api/map/${sha}`);
  assert.strictEqual(whole.status, 200);
  assert.ok(whole.raw.equals(map));
  assert.strictEqual(whole.headers['accept-ranges'], 'bytes');
  assert.strictEqual(whole.headers['content-security-policy'], 'sandbox');

  const part = await b.call('GET', `/api/map/${sha}`, { headers: { Range: 'bytes=100-199' } });
  assert.strictEqual(part.status, 206);
  assert.strictEqual(part.headers['content-range'], 'bytes 100-199/5000');
  assert.ok(part.raw.equals(map.subarray(100, 200)));

  const tail = await b.call('GET', `/api/map/${sha}`, { headers: { Range: 'bytes=-10' } });
  assert.ok(tail.raw.equals(map.subarray(4990)));
  assert.strictEqual((await b.call('GET', `/api/map/${sha}`, { headers: { Range: 'bytes=6000-7000' } })).status, 416);
}));

test('area map: refused when not in the snapshot, the wrong size, the wrong fingerprint or over the cap', withBoard(async (b) => {
  const map = crypto.randomBytes(3000);
  const sha = sha256(map);
  const key = await claim(b);
  const up = (s, body) => b.call('POST', `/api/map/${s}`, { headers: { 'X-Board-Key': key }, body });
  assert.strictEqual((await up(sha, map)).status, 404, 'no snapshot lists it yet');
  await publish(b, key, mapSnapshot(map));
  assert.strictEqual((await up(sha, map.subarray(0, 2999))).status, 400);
  const other = Buffer.from(map); other[0] ^= 1;
  await publish(b, key, { ...mapSnapshot(map), maps: [{ sha256: sha, bytes: other.length }] });
  assert.strictEqual((await up(sha, other)).status, 422);
  assert.strictEqual((await b.call('POST', '/api/map/not-a-sha', { headers: { 'X-Board-Key': key }, body: map })).status, 400);
}, { mapCap: 4000 }));

test('area map: over the cap is refused', withBoard(async (b) => {
  const map = crypto.randomBytes(5000);
  const key = await claim(b);
  await publish(b, key, mapSnapshot(map));
  assert.strictEqual((await b.call('POST', `/api/map/${sha256(map)}`, { headers: { 'X-Board-Key': key }, body: map })).status, 413);
}, { mapCap: 4000 }));

test('area map: a snapshot without it, or with another, drops the held one; viewers need the password', withBoard(async (b) => {
  const map = crypto.randomBytes(2000);
  const sha = sha256(map);
  const key = await claim(b, 'pw');
  await publish(b, key, mapSnapshot(map));
  await b.call('POST', `/api/map/${sha}`, { headers: { 'X-Board-Key': key }, body: map });
  assert.strictEqual((await b.call('GET', `/api/map/${sha}`)).status, 401);
  assert.strictEqual((await b.call('GET', `/api/map/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 200);
  await publish(b, key, { mission: 'Test Mission', reports: [] });
  assert.strictEqual((await b.call('GET', `/api/map/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 404);
  assert.strictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json.map, undefined);
}));

// ---- E-287: the Setup file for phones (settings and places; never the roster) ----
const { zipSync, strToU8 } = require('fflate');
const setupZip = (manifest, extra = {}) => Buffer.from(zipSync({ 'mission-zip.json': strToU8(JSON.stringify(manifest)), 'README.txt': strToU8('hi'), ...extra }));
const GOOD_MANIFEST = { schemaVersion: 3, exportedAt: '2026-11-18T00:00:00Z', appVersion: '1', settings: { mission: 'Fernhollow' }, locations: [{ name: 'Shelter' }] };
const setupSnapshot = (zip, extra = {}) => ({ mission: 'Fern hollow/Test', reports: [], setup: { sha256: sha256(zip), bytes: zip.length, name: 'x-setup.zip', ...extra } });
const upSetup = (b, key, sha, body) => b.call('POST', `/api/setup/${sha}`, { headers: { 'X-Board-Key': key }, body });

test('setup file: wanted, uploaded, then downloaded as an attachment', withBoard(async (b) => {
  const zip = setupZip(GOOD_MANIFEST);
  const sha = sha256(zip);
  const key = await claim(b);
  assert.strictEqual((await publish(b, key, setupSnapshot(zip))).status, 204);
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json.setup, { sha256: sha, held: false });
  assert.strictEqual((await b.call('GET', `/api/setup/${sha}`)).status, 404, 'nothing to read before the upload');
  assert.strictEqual((await b.call('POST', `/api/setup/${sha}`, { body: zip })).status, 403, 'no key, no upload');
  assert.strictEqual((await upSetup(b, key, sha, zip)).status, 204);
  assert.strictEqual((await upSetup(b, key, sha, zip)).status, 204, 'a repeat is harmless');
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': key } })).json.setup, { sha256: sha, held: true });
  const got = await b.call('GET', `/api/setup/${sha}`);
  assert.strictEqual(got.status, 200);
  assert.ok(got.raw.equals(zip));
  assert.strictEqual(got.headers['content-disposition'], 'attachment; filename="Fern_hollow_Test-setup.zip"');
  assert.strictEqual(got.headers['content-type'], 'application/zip');
}));

test('setup file: wrong fingerprint or size is 400, not in the snapshot is 404', withBoard(async (b) => {
  const zip = setupZip(GOOD_MANIFEST);
  const key = await claim(b);
  assert.strictEqual((await upSetup(b, key, sha256(zip), zip)).status, 404, 'no snapshot lists it yet');
  const other = Buffer.from(zip); other[other.length - 30] ^= 1;
  await publish(b, key, setupSnapshot(zip));
  assert.strictEqual((await upSetup(b, key, sha256(zip), other)).status, 400, 'right size, wrong fingerprint');
  assert.strictEqual((await upSetup(b, key, sha256(zip), zip.subarray(1))).status, 400, 'wrong size');
  assert.strictEqual((await b.call('POST', '/api/setup/not-a-sha', { headers: { 'X-Board-Key': key }, body: zip })).status, 400);
}));

test('setup file: over the cap is refused', withBoard(async (b) => {
  const zip = setupZip(GOOD_MANIFEST);
  const key = await claim(b);
  await publish(b, key, setupSnapshot(zip));
  assert.strictEqual((await upSetup(b, key, sha256(zip), zip)).status, 413);
}, { setupCap: 100 }));

test('setup file: a roster, photos or radio log entries are refused, with the reason', withBoard(async (b) => {
  const key = await claim(b);
  const refuse = async (zip, pattern) => {
    await publish(b, key, setupSnapshot(zip));
    const r = await upSetup(b, key, sha256(zip), zip);
    assert.strictEqual(r.status, 422);
    assert.match(r.json.error, pattern);
    assert.strictEqual((await b.call('GET', `/api/setup/${sha256(zip)}`)).status, 404, 'a refused file is not held');
  };
  await refuse(setupZip({ ...GOOD_MANIFEST, rangers: [{ name: 'A Ranger' }] }), /roster/);
  await refuse(setupZip({ ...GOOD_MANIFEST, rangers: [] }), /roster/); // presence of the key, not emptiness
  await refuse(setupZip(GOOD_MANIFEST, { 'photos/K7ABC.jpg': new Uint8Array([1, 2, 3]) }), /photos/);
  await refuse(setupZip(GOOD_MANIFEST, { 'attachments/abc.png': new Uint8Array([1, 2, 3]) }), /photos or attachments/);
  await refuse(setupZip({ ...GOOD_MANIFEST, entries: [] }), /radio log/);
  await refuse(Buffer.from('this is not a zip file at all'), /not a readable/);
  await refuse(Buffer.from(zipSync({ 'README.txt': strToU8('no manifest') })), /no mission-zip\.json/);
}));

test('setup file: a snapshot without it, or a new claim, forgets it; viewers need the password', withBoard(async (b) => {
  const zip = setupZip(GOOD_MANIFEST);
  const sha = sha256(zip);
  const key = await claim(b, 'pw');
  await publish(b, key, setupSnapshot(zip));
  await upSetup(b, key, sha, zip);
  assert.strictEqual((await b.call('GET', `/api/setup/${sha}`)).status, 401);
  assert.strictEqual((await b.call('GET', `/api/setup/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 200);
  // A takeover: the new publisher's first snapshot does not list the file, so RangerView drops it.
  const took = await b.call('POST', '/api/claim', { json: { password: 'pw', by: { ...BY, scribe: 'Sam' } } });
  assert.strictEqual(took.status, 200);
  await publish(b, took.json.key, { mission: 'Test Mission', reports: [] });
  assert.strictEqual((await b.call('GET', `/api/setup/${sha}`, { headers: { 'X-Board-Password': 'pw' } })).status, 404);
  assert.strictEqual((await b.call('GET', '/api/requests', { headers: { 'X-Board-Key': took.json.key } })).json.setup, undefined);
}));

// ---- E-306 rung 2 (D-72): several stations publish to one RangerView ----
const claimAs = (b, station, extra = {}, scribe = `Scribe ${station || 'none'}`) =>
  b.call('POST', '/api/claim', { json: { station, by: { ...BY, scribe }, ...extra } });
const K = (key) => ({ 'X-Board-Key': key });
const rep = (id, extra = {}) => ({ id, date: '2026-11-18T14:30:00Z', callsign: 'K7ABC', msgNo: `A00${id}`, ...extra });

test('rung 2: two stations join an open RangerView and each keeps its own key and snapshot', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  assert.strictEqual(a.status, 200);
  assert.deepStrictEqual(a.json.stations, ['A']);
  const c = await claimAs(b, 'C');
  assert.strictEqual(c.status, 200);
  assert.notStrictEqual(c.json.key, a.json.key);
  assert.deepStrictEqual(c.json.stations, ['A', 'C']);
  assert.strictEqual(c.json.primary, 'A', 'the first station to connect');
  assert.strictEqual(c.json.tookOverFrom, undefined, 'a join is not a takeover');
  assert.strictEqual((await publish(b, a.json.key, { mission: 'M', reports: [rep(1)] })).status, 204);
  assert.strictEqual((await publish(b, c.json.key, { mission: 'M', reports: [rep(1, { msgNo: 'C001' }), rep(2, { msgNo: 'C002' })] })).status, 204);
  const read = (await b.call('GET', '/api/mission')).json;
  assert.strictEqual(read.reports.length, 3);
  assert.deepStrictEqual(read.reports.map((r) => [r.station, r.msgNo]), [['A', 'A001'], ['C', 'C001'], ['C', 'C002']], 'the publisher letter never overwrites msgNo');
  assert.deepStrictEqual(read.stations.map((s) => [s.station, s.scribe, s.reports]), [['A', 'Scribe A', 1], ['C', 'Scribe C', 2]]);
  assert.ok(read.stations.every((s) => s.seenAt));
  assert.strictEqual(read.board.by.scribe, 'Scribe A', 'the header is the primary');
}));

test('rung 2: a station with no letter may publish, and the claim reply lists letters only', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  const n = await claimAs(b, '');
  assert.strictEqual(n.status, 200);
  assert.deepStrictEqual(n.json.stations, ['A']);
  await publish(b, a.json.key, { mission: 'M', reports: [rep(1)] });
  await publish(b, n.json.key, { mission: 'M', reports: [rep(2)] });
  const read = (await b.call('GET', '/api/mission')).json;
  assert.deepStrictEqual(read.reports.map((r) => r.station), ['A', '']);
  assert.strictEqual((await claimAs(b, 'a')).status, 400, 'lower case');
  assert.strictEqual((await claimAs(b, 'AB')).status, 400);
  assert.strictEqual((await claimAs(b, 7)).status, 400);
}));

test('rung 2: with a password a join needs it; a wrong one is refused, counted and rate limited', withBoard(async (b) => {
  await claimAs(b, 'A', { password: 'pw' });
  const wrong = await claimAs(b, 'B', { password: 'nope' });
  assert.strictEqual(wrong.status, 403);
  assert.strictEqual(wrong.json.needPassword, true);
  assert.strictEqual((await claimAs(b, 'B', { password: '' })).status, 403);
  const ok = await claimAs(b, 'B', { password: 'pw' });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.json.stations, ['A', 'B']);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'pw' } })).status, 200);
  for (let i = 0; i < 5; i++) await claimAs(b, 'D', { password: `bad${i}` });
  assert.strictEqual((await claimAs(b, 'D', { password: 'pw' })).status, 429, 'five wrong in a minute blocks even the right one');
}));

test('rung 2: taking over one station leaves the others publishing', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  const c = await claimAs(b, 'C');
  await publish(b, a.json.key, { mission: 'M', reports: [rep(1)] });
  await publish(b, c.json.key, { mission: 'M', reports: [rep(2, { msgNo: 'C001' })] });
  const took = await claimAs(b, 'C', {}, 'Sam');
  assert.strictEqual(took.status, 200);
  assert.strictEqual(took.json.tookOverFrom.by.scribe, 'Scribe C');
  assert.strictEqual((await publish(b, c.json.key, { mission: 'M', reports: [] })).status, 403, "C's old key is cut off");
  const old = await publish(b, c.json.key, {});
  assert.strictEqual(old.json.by.scribe, 'Sam', 'and told who holds station C');
  assert.strictEqual((await publish(b, a.json.key, { mission: 'M', reports: [rep(1), rep(3)] })).status, 204, 'A is untouched');
  assert.strictEqual((await publish(b, took.json.key, { mission: 'M', reports: [rep(2, { msgNo: 'C001' })] })).status, 204);
  const read = (await b.call('GET', '/api/mission')).json;
  assert.deepStrictEqual(read.stations.map((s) => [s.station, s.scribe]), [['A', 'Scribe A'], ['C', 'Sam']]);
}));

test('rung 2: takeover of a station on a protected RangerView needs the password', withBoard(async (b) => {
  await claimAs(b, 'A', { password: 'pw' });
  const c = await claimAs(b, 'C', { password: 'pw' });
  const refused = await claimAs(b, 'C', { password: 'nope' });
  assert.strictEqual(refused.status, 403);
  assert.strictEqual(refused.json.error, 'claimed');
  assert.strictEqual((await publish(b, c.json.key, { mission: 'M', reports: [] })).status, 204, 'the real C is unharmed');
  assert.strictEqual((await claimAs(b, 'C', { password: 'pw' })).status, 200);
}));

test('rung 2: an automatic reclaim never takes over a station, but may join one that is not there', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  const again = await claimAs(b, 'A', { reclaim: true });
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.json.error, 'claimed');
  assert.strictEqual((await publish(b, a.json.key, { mission: 'M', reports: [] })).status, 204, 'A still holds its key');
  const joined = await claimAs(b, 'B', { reclaim: true });
  assert.strictEqual(joined.status, 200);
  assert.deepStrictEqual(joined.json.stations, ['A', 'B']);
}));

test('rung 2: a reclaim on a protected RangerView joins only with the password', withBoard(async (b) => {
  await claimAs(b, 'A', { password: 'pw' });
  assert.strictEqual((await claimAs(b, 'B', { reclaim: true, password: '' })).status, 409);
  assert.strictEqual((await claimAs(b, 'B', { reclaim: true, password: 'pw' })).status, 200);
}));

test('rung 2: at most 8 stations', withBoard(async (b) => {
  for (const l of 'ABCDEFGH') assert.strictEqual((await claimAs(b, l)).status, 200, l);
  const ninth = await claimAs(b, 'I');
  assert.strictEqual(ninth.status, 409);
  assert.deepStrictEqual(ninth.json, { error: 'too-many-stations' });
  assert.strictEqual((await claimAs(b, 'A')).status, 200, 'a takeover of a present station is not a ninth');
}));

test('rung 2: only the primary (first to connect) changes the password', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  const c = await claimAs(b, 'C');
  const denied = await b.call('POST', '/api/password', { headers: K(c.json.key), json: { password: 'x' } });
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(denied.json.state, 'not-primary');
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 200, 'unchanged');
  assert.strictEqual((await b.call('POST', '/api/password', { headers: K(a.json.key), json: { password: 'x' } })).status, 204);
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 401);
  // A takeover of C by a device carrying a different password does not change the board's.
  assert.strictEqual((await claimAs(b, 'C', { password: 'x' })).status, 200);
  assert.strictEqual((await b.call('GET', '/api/mission', { headers: { 'X-Board-Password': 'x' } })).status, 200);
}));

test('rung 2: leave drops the station and its reports; the oldest left becomes primary', withBoard(async (b) => {
  const a = await claimAs(b, 'A');
  const c = await claimAs(b, 'C');
  const d = await claimAs(b, 'D');
  await publish(b, a.json.key, { mission: 'M', reports: [rep(1)] });
  await publish(b, c.json.key, { mission: 'M', reports: [rep(2)] });
  await publish(b, d.json.key, { mission: 'M', reports: [rep(3)] });
  assert.strictEqual((await b.call('POST', '/api/leave', { headers: K(c.json.key) })).status, 204);
  let read = (await b.call('GET', '/api/mission')).json;
  assert.deepStrictEqual(read.stations.map((s) => s.station), ['A', 'D']);
  assert.strictEqual(read.reports.length, 2);
  assert.strictEqual((await publish(b, c.json.key, {})).status, 403, 'its key is gone');
  assert.strictEqual((await b.call('POST', '/api/leave', { headers: K('not-a-key') })).status, 403);
  // The primary leaves: D (the oldest left) takes over the password.
  assert.strictEqual((await b.call('POST', '/api/leave', { headers: K(a.json.key) })).status, 204);
  read = (await b.call('GET', '/api/mission')).json;
  assert.deepStrictEqual(read.stations.map((s) => s.station), ['D']);
  assert.strictEqual(read.board.by.scribe, 'Scribe D');
  assert.strictEqual((await b.call('POST', '/api/password', { headers: K(d.json.key), json: { password: 'now' } })).status, 204);
  // The last one leaving puts RangerView back to unclaimed, and the password with it.
  assert.strictEqual((await b.call('POST', '/api/leave', { headers: K(d.json.key) })).status, 204);
  assert.deepStrictEqual((await b.call('GET', '/api/mission')).json, { waiting: true });
  assert.strictEqual((await claimAs(b, 'B')).status, 200);
  assert.strictEqual((await b.call('GET', '/api/mission')).status, 200, 'no password left over');
}));

test("rung 2: a request for station B's attachment works, and only B is asked to upload it", withBoard(async (b) => {
  const photo = { bytes: crypto.randomBytes(2048) };
  const sha = sha256(photo.bytes);
  const a = await claimAs(b, 'A');
  const c = await claimAs(b, 'B');
  await publish(b, a.json.key, { mission: 'M', reports: [] });
  await publish(b, c.json.key, snapshotWith(photo));
  assert.strictEqual((await b.call('POST', `/api/request/${sha}`)).status, 202, 'the union lists it');
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K(a.json.key) })).json.requests, [], 'A has no such file');
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K(c.json.key) })).json.requests, [sha]);
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K(a.json.key), body: photo.bytes })).status, 404, 'A cannot supply it');
  assert.strictEqual((await b.call('POST', `/api/attachments/${sha}`, { headers: K(c.json.key), body: photo.bytes })).status, 204);
  const got = await b.call('GET', `/api/attachments/${sha}`);
  assert.strictEqual(got.status, 200);
  assert.ok(got.raw.equals(photo.bytes));
  // B leaves: its reference, and the held original, go with it.
  await b.call('POST', '/api/leave', { headers: K(c.json.key) });
  assert.strictEqual((await b.call('GET', `/api/attachments/${sha}`)).status, 404);
  assert.strictEqual((await b.call('POST', `/api/request/${sha}`)).status, 404);
}));

test('rung 2: the area map and the Setup file come from the primary only', withBoard(async (b) => {
  const map = crypto.randomBytes(3000);
  const msha = sha256(map);
  const a = await claimAs(b, 'A');
  const c = await claimAs(b, 'C');
  await publish(b, c.json.key, mapSnapshot(map));
  assert.strictEqual((await b.call('GET', '/api/requests', { headers: K(c.json.key) })).json.map, undefined, "C's map is ignored");
  assert.strictEqual((await b.call('POST', `/api/map/${msha}`, { headers: K(c.json.key), body: map })).status, 404);
  const zip = setupZip(GOOD_MANIFEST);
  await publish(b, c.json.key, { ...setupSnapshot(zip), ...mapSnapshot(map) });
  assert.strictEqual((await b.call('POST', `/api/setup/${sha256(zip)}`, { headers: K(c.json.key), body: zip })).status, 404);
  await publish(b, a.json.key, mapSnapshot(map));
  assert.deepStrictEqual((await b.call('GET', '/api/requests', { headers: K(a.json.key) })).json.map, { sha256: msha, held: false });
  assert.strictEqual((await b.call('POST', `/api/map/${msha}`, { headers: K(a.json.key), body: map })).status, 204);
  assert.strictEqual((await b.call('GET', `/api/map/${msha}`)).status, 200);
}));

test('rung 2: one station: the payload is as before, plus stations', withBoard(async (b) => {
  const a = await claimAs(b, 'B');
  const snap = { mission: 'M', event: 'Fern', reports: [rep(1)], places: [] };
  await publish(b, a.json.key, snap);
  const read = (await b.call('GET', '/api/mission')).json;
  const { board, stations, ...rest } = read;
  assert.deepStrictEqual(rest, snap, 'reports carry no station field with one station');
  assert.ok(board);
  assert.strictEqual(stations.length, 1);
  assert.strictEqual(stations[0].station, 'B');
  assert.strictEqual(stations[0].mission, 'M');
  assert.strictEqual(stations[0].reports, 1);
}));

test('rung 2: a key from before a restart is told 409 unclaimed even after another station re-claimed', async () => {
  const first = await start();
  let oldKey;
  try { oldKey = (await claimAs(first, 'C')).json.key; } finally { await first.close(); }
  const b = await start();
  try {
    await claimAs(b, 'A');
    assert.strictEqual((await publish(b, oldKey, {})).status, 409, 'so station C re-claims and joins');
    assert.strictEqual((await publish(b, 'plain-stranger-key', {})).status, 403);
    assert.strictEqual((await claimAs(b, 'C', { reclaim: true })).status, 200);
  } finally { await b.close(); }
});

test('rung 2: join and leave are logged, never a key or password', withBoard(async (b) => {
  const a = await claimAs(b, 'A', { password: 'topsecret' });
  const c = await claimAs(b, 'C', { password: 'topsecret' });
  await b.call('POST', '/api/leave', { headers: K(c.json.key) });
  const text = b.lines.join('\n');
  assert.match(text, /Station joined: station C/);
  assert.match(text, /Station left: station C/);
  assert.ok(!text.includes('topsecret') && !text.includes(a.json.key) && !text.includes(c.json.key));
}));
