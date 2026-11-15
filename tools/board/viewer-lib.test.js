// E-293 phase A: the /view-lib/ route that serves the viewer's Map tab files, with HTTP Range support for the
// world base map (PMTiles reads byte ranges). Against a real server, as protocol.test.js does.
const test = require('node:test');
const assert = require('node:assert');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const selfsigned = require('selfsigned');
const { createServer } = require('../command-post-server');
const { parseRange, NAMES } = require('./viewer-lib');

const REPO = path.join(__dirname, '..', '..');
const WORLD = path.join(REPO, 'src', 'assets', 'maps', fs.readdirSync(path.join(REPO, 'src', 'assets', 'maps')).filter((f) => /^world-z5-/.test(f)).sort().pop());

let cert;
test.before(async () => {
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'viewer lib test' }], { days: 1, keySize: 2048, algorithm: 'sha256' });
  cert = { key: pems.private, cert: pems.cert };
});

async function withServer(fn) {
  const server = await createServer({ port: 0, cert, name: 'rangerview.local', log: () => {} });
  const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
  const get = (urlPath, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    https.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, agent, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
  try { await fn(get); } finally { await server.close(); }
}

test('world map: 200 whole file with no Range header, and says it accepts ranges', () => withServer(async (get) => {
  const r = await get('/view-lib/world.pmtiles');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['accept-ranges'], 'bytes');
  assert.strictEqual(r.headers['content-type'], 'application/octet-stream');
  assert.strictEqual(Number(r.headers['content-length']), fs.statSync(WORLD).size);
  assert.strictEqual(r.raw.length, fs.statSync(WORLD).size);
}));

test('world map: 206 with the right bytes and Content-Range for a range, an open end and a suffix', () => withServer(async (get) => {
  const whole = fs.readFileSync(WORLD);
  const a = await get('/view-lib/world.pmtiles', { Range: 'bytes=0-126' });
  assert.strictEqual(a.status, 206);
  assert.strictEqual(a.headers['content-range'], `bytes 0-126/${whole.length}`);
  assert.strictEqual(a.headers['content-length'], '127');
  assert.ok(a.raw.equals(whole.subarray(0, 127)));
  const b = await get('/view-lib/world.pmtiles', { Range: 'bytes=1000-1999' });
  assert.strictEqual(b.status, 206);
  assert.ok(b.raw.equals(whole.subarray(1000, 2000)));
  const c = await get('/view-lib/world.pmtiles', { Range: `bytes=${whole.length - 10}-` });
  assert.strictEqual(c.status, 206);
  assert.strictEqual(c.headers['content-range'], `bytes ${whole.length - 10}-${whole.length - 1}/${whole.length}`);
  assert.ok(c.raw.equals(whole.subarray(whole.length - 10)));
  const d = await get('/view-lib/world.pmtiles', { Range: 'bytes=-5' });
  assert.strictEqual(d.status, 206);
  assert.ok(d.raw.equals(whole.subarray(whole.length - 5)));
  const e = await get('/view-lib/world.pmtiles', { Range: `bytes=${whole.length - 3}-${whole.length + 500}` }); // end past the file is clamped
  assert.strictEqual(e.status, 206);
  assert.strictEqual(e.raw.length, 3);
}));

test('world map: 416 with Content-Range */size for a range outside the file or a bad one', () => withServer(async (get) => {
  const size = fs.statSync(WORLD).size;
  for (const range of [`bytes=${size}-`, `bytes=${size + 10}-${size + 20}`, 'bytes=50-10', 'bytes=-', 'bytes=abc', 'bytes=-0']) {
    const r = await get('/view-lib/world.pmtiles', { Range: range });
    assert.strictEqual(r.status, 416, range);
    assert.strictEqual(r.headers['content-range'], `bytes */${size}`, range);
    assert.strictEqual(r.raw.length, 0, range);
  }
}));

test('unknown names and paths that try to leave the folder are 404', () => withServer(async (get) => {
  for (const p of ['/view-lib/nothing.js', '/view-lib/', '/view-lib/..%2Fpackage.json', '/view-lib/%2e%2e/package.json', '/view-lib/maplibre-gl.mjs.map', '/view-lib/%E0%A4%A']) {
    assert.strictEqual((await get(p)).status, 404, p);
  }
}));

test('the map libraries have the right MIME types and real content', () => withServer(async (get) => {
  const expected = {
    'maplibre-gl.mjs': 'text/javascript; charset=utf-8',
    'maplibre-gl-worker.mjs': 'text/javascript; charset=utf-8',
    'maplibre-gl-shared.mjs': 'text/javascript; charset=utf-8',
    'pmtiles.js': 'text/javascript; charset=utf-8',
    'maplibre-gl.css': 'text/css; charset=utf-8',
  };
  for (const [name, type] of Object.entries(expected)) {
    const r = await get('/view-lib/' + name);
    assert.strictEqual(r.status, 200, name);
    assert.strictEqual(r.headers['content-type'], type, name);
    assert.strictEqual(r.headers['x-content-type-options'], 'nosniff', name);
  }
  assert.ok((await get('/view-lib/maplibre-gl.mjs')).raw.length > 100000);
  assert.ok((await get('/view-lib/pmtiles.js')).raw.toString('utf8').includes('PMTiles'));
  assert.ok(NAMES.every((n) => n in expected || n === 'world.pmtiles'));
}));

test('HEAD sends headers and no body; other methods are 405', () => withServer(async (get) => {
  const h = await get('/view-lib/pmtiles.js', {}, 'HEAD');
  assert.strictEqual(h.status, 200);
  assert.strictEqual(h.raw.length, 0);
  assert.ok(Number(h.headers['content-length']) > 1000);
  assert.strictEqual((await get('/view-lib/pmtiles.js', {}, 'POST')).status, 405);
}));

test('parseRange', () => {
  assert.strictEqual(parseRange(undefined, 100), null);
  assert.deepStrictEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepStrictEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
  assert.strictEqual(parseRange('bytes=100-', 100), 'bad');
  assert.strictEqual(parseRange('bytes=0-1,5-6', 100), null); // several ranges: send the whole file
  assert.strictEqual(parseRange('bytes=0-5', 0), 'bad');
});
