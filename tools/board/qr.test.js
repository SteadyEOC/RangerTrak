// D-61 item 7: the QR page. /qr shows the password, so it answers this machine only.
const test = require('node:test');
const assert = require('node:assert');
const https = require('node:https');
const selfsigned = require('selfsigned');
const { createServer } = require('../command-post-server');
const qr = require('./qr');

test('isLoopback accepts this machine and nothing else', () => {
  for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) assert.strictEqual(qr.isLoopback(a), true, a);
  for (const a of ['192.168.1.5', '10.0.0.2', '::ffff:192.168.1.5', 'fe80::1', '', undefined, null]) assert.strictEqual(qr.isLoopback(a), false, String(a));
});

test('the viewer link carries the password after a # and nowhere else', () => {
  assert.strictEqual(qr.viewUrl({ host: 'rangerview.local', port: 443, password: '' }), 'https://rangerview.local/view');
  assert.strictEqual(qr.viewUrl({ host: 'rangerview.local', port: 8080, password: 'a b&c' }), 'https://rangerview.local:8080/view#code=a%20b%26c');
  assert.strictEqual(qr.plainUrl({ host: 'h', port: 8080 }), 'https://h:8080/view');
});

function fakeRes() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; r.headers = h || {}; };
  r.end = (b) => { r.body = b || ''; };
  r.headersSent = false;
  return r;
}
const state = () => ({ host: 'rangerview.local', port: 443, password: 'secretword', claimed: true });

test('a request from another address is refused and sees nothing', async () => {
  for (const addr of ['192.168.1.9', '::ffff:10.0.0.4', 'fe80::2']) {
    const res = fakeRes();
    const handled = await qr.handleQr({ url: '/qr', method: 'GET', socket: { remoteAddress: addr } }, res, state);
    assert.strictEqual(handled, true);
    assert.strictEqual(res.status, 404);
    assert.ok(!res.body.includes('secretword') && !res.body.includes('svg'));
  }
});

test('a request from this machine gets the page, with the QR and the address', async () => {
  const res = fakeRes();
  await qr.handleQr({ url: '/qr', method: 'GET', socket: { remoteAddress: '::1' } }, res, state);
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.includes('<svg'));
  assert.ok(res.body.includes('https://rangerview.local/view'));
  assert.ok(!res.body.includes('secretword'), 'the password rides inside the QR code, never as text on the page');
});

test('before the first claim the page says it is waiting and draws no code', async () => {
  const html = await qr.qrPage({ host: 'h', port: 8080, password: '', claimed: false });
  assert.ok(html.includes('Waiting for the scribe to turn on publishing'));
  assert.ok(!html.includes('<svg'));
});

test('other paths are not its business', async () => {
  assert.strictEqual(await qr.handleQr({ url: '/view', method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, fakeRes(), state), false);
});

test('against a real server: /qr from loopback is 200 and tracks the claim', async () => {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'qr test' }], { days: 1, keySize: 2048, algorithm: 'sha256' });
  const lines = [];
  const server = await createServer({ port: 0, cert: { key: pems.private, cert: pems.cert }, name: 'rangerview.local', log: (l) => lines.push(String(l)) });
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  const get = (path) => new Promise((resolve, reject) => {
    https.get({ host: '127.0.0.1', port: server.port, path, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });
  const post = (path, json) => new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(json));
    const req = https.request({ host: '127.0.0.1', port: server.port, method: 'POST', path, agent, headers: { 'Content-Length': payload.length } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end(payload);
  });
  try {
    const before = await get('/qr');
    assert.strictEqual(before.status, 200);
    assert.ok(before.body.includes('Waiting for the scribe'));
    await post('/api/claim', { password: 'pw', by: { mission: 'm', opPeriod: '1', scribe: 's', agent: 'a' } });
    const after = await get('/qr');
    assert.strictEqual(after.status, 200);
    assert.ok(after.body.includes('<svg'));
    await new Promise((r) => setTimeout(r, 200)); // the terminal QR is drawn after the reply
    assert.ok(lines.some((l) => l.includes('Scan to open the mini web server')), 'the console shows a QR after a claim');
    assert.ok(!lines.join('\n').includes('code=pw'), 'the password is never printed as text');
  } finally {
    await server.close();
  }
});
