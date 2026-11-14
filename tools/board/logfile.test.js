// E-290: the Board's log file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { openLog, teeConsole, plain } = require('./logfile');

// One folder per run inside the repo's git-ignored .tmp, removed afterwards (with retries: Windows holds files briefly).
const RUN_DIR = path.join(__dirname, '..', '..', '.tmp', `board-logfile-test-${process.pid}-${Date.now()}`);
test.after(() => {
  for (let i = 0; i < 20; i++) {
    try { fs.rmSync(RUN_DIR, { recursive: true, force: true }); } catch { /* retry */ }
    if (!fs.existsSync(RUN_DIR)) return;
    const until = Date.now() + 250; while (Date.now() < until) { /* wait */ }
  }
  console.warn(`WARNING: could not remove ${RUN_DIR}`);
});

let n = 0;
const fixedNow = () => new Date(2026, 10, 14, 11, 5, 9, 42);
const fresh = () => path.join(RUN_DIR, `case-${++n}`);
const read = (log) => fs.readFileSync(log.file, 'utf8');

test('names the file by start time, writes the header, timestamps each line', () => {
  const log = openLog({ dir: fresh(), header: ['RangerTrak Board 1.0.0-beta.3'], now: fixedNow });
  log.line('STEP 1 - SCRIBE');
  log.close();
  assert.strictEqual(path.basename(log.file), 'board-2026-11-14-110509.txt');
  assert.strictEqual(read(log), '2026-11-14 11:05:09.042  RangerTrak Board 1.0.0-beta.3\n2026-11-14 11:05:09.042  STEP 1 - SCRIBE\n');
});

test('multi-line text gets a timestamp on every line; colour codes and carriage returns are dropped', () => {
  const log = openLog({ dir: fresh(), now: fixedNow });
  log.line('\x1b[32m✔ ok\x1b[0m\r\nsecond');
  log.close();
  assert.strictEqual(read(log), '2026-11-14 11:05:09.042  ✔ ok\n2026-11-14 11:05:09.042  second\n');
  assert.strictEqual(plain('a\x1b[1;31mb\rc'), 'abc');
});

const fakeExchange = (method, url, address) => {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableFinished = false;
  return { req: { method, url, headers: { 'x-board-key': 'SECRET-KEY', 'x-board-password': 'SECRET-PW' }, socket: { remoteAddress: address } }, res };
};

test('one line per request: address, method, path, status, time; never the secret headers', () => {
  const log = openLog({ dir: fresh(), now: fixedNow });
  const ok = fakeExchange('POST', '/api/publish?ngsw-bypass=1', '::ffff:10.0.0.156');
  log.request(ok.req, ok.res);
  ok.res.statusCode = 204; ok.res.writableFinished = true;
  ok.res.emit('finish'); ok.res.emit('close');
  const cut = fakeExchange('GET', '/api/attachment/abc', '10.0.0.20');
  log.request(cut.req, cut.res);
  cut.res.emit('close');
  log.close();
  const text = read(log);
  assert.match(text, /REQ 10\.0\.0\.156 POST \/api\/publish\?ngsw-bypass=1 204 0ms\n/);
  assert.match(text, /REQ 10\.0\.0\.20 GET \/api\/attachment\/abc closed before the reply finished, 0ms\n/);
  assert.strictEqual(text.split('\n').filter(Boolean).length, 2, 'a finished request is written once');
  assert.doesNotMatch(text, /SECRET/);
});

test('failed TLS handshakes are logged with the address', () => {
  const log = openLog({ dir: fresh(), now: fixedNow });
  log.tlsError(Object.assign(new Error('x'), { code: 'ECONNRESET' }), { remoteAddress: '10.0.0.30' });
  // The usual case: the TLS socket has lost its address; the raw socket under it was remembered on connection.
  const raw = { remoteAddress: '10.0.0.31' };
  log.remember(raw);
  raw.remoteAddress = undefined;
  log.tlsError({ code: 'ECONNRESET' }, { remoteAddress: undefined, _parent: raw });
  log.close();
  assert.match(read(log), /TLS 10\.0\.0\.30 handshake failed: ECONNRESET/);
  assert.match(read(log), /TLS 10\.0\.0\.31 handshake failed: ECONNRESET/);
});

test('teeConsole copies console.log into the log and can be undone', () => {
  const log = openLog({ dir: fresh(), now: fixedNow });
  const shown = [];
  const target = { log: (...a) => shown.push(a.join(' ')) };
  const undo = teeConsole(log, target);
  target.log('Scribe:', 'connected');
  undo();
  target.log('not copied');
  log.close();
  assert.deepStrictEqual(shown, ['Scribe: connected', 'not copied']);
  assert.strictEqual(read(log), '2026-11-14 11:05:09.042  Scribe: connected\n');
});

test('a folder that cannot be made returns null and says why; nothing throws', () => {
  const blocker = path.join(fresh(), 'a-file');
  fs.mkdirSync(path.dirname(blocker), { recursive: true });
  fs.writeFileSync(blocker, '');
  const warnings = [];
  const log = openLog({ dir: path.join(blocker, 'logs'), warn: (w) => warnings.push(w) });
  assert.strictEqual(log, null);
  assert.match(warnings[0], /runs without one/);
});

test('writing after close is ignored', () => {
  const log = openLog({ dir: fresh(), now: fixedNow });
  log.close();
  log.line('late');
  log.close();
  assert.strictEqual(read(log), '');
});
