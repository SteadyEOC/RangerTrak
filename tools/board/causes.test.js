// E-216 slice 2: the shared causes (src/app/domain/board-causes.json) and the viewer page, which
// cannot import them and so carries its own copy of two sentences. This test is what keeps the copy honest.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { boardCause, fill, causes } = require('./causes');

const VIEWER = path.join(__dirname, '..', '..', 'src', 'command-post-view', 'index.html');

// The fixed words of a message: split on {placeholders} and [[ ]] markers, keep the pieces long enough to mean something.
const pieces = (message) => message.split(/\{\w+\}|\[\[|\]\]/).map((p) => p.trim()).filter((p) => p.length >= 4);

test('every cause has the fields the three screens need, and an id used once', () => {
  const ids = new Set();
  for (const c of causes) {
    assert.ok(c.id && c.message && c.detail && c.anchor && Array.isArray(c.seenFrom) && c.seenFrom.length, `complete: ${c.id}`);
    assert.ok(!ids.has(c.id), `unique: ${c.id}`);
    ids.add(c.id);
    assert.match(c.anchor, /^[a-z0-9-]+$/, `anchor is a slug: ${c.id}`);
  }
  for (const id of ['no-network', 'different-network', 'firewall-public', 'port-taken', 'node-too-old', 'not-built',
    'certificate-not-accepted', 'blocked-by-browser', 'vpn-or-shield', 'wrong-address', 'not-a-board',
    'board-lost', 'scribe-quiet', 'phone-left-wifi', 'laptop-asleep']) assert.ok(ids.has(id), `has ${id}`);
});

test('main text uses plain words: no TLS, CORS, mDNS, port or HTTP', () => {
  for (const c of causes) {
    // placeholder names such as {port} are not shown to anyone
    const text = c.message.replace(/\{\w+\}/g, '');
    assert.doesNotMatch(text, /\b(TLS|CORS|mDNS|port|HTTPS?)\b/i, c.id);
  }
});

test('boardCause fills placeholders and drops an optional clause whose value is missing', () => {
  assert.strictEqual(boardCause('board-lost', { time: '12:04', ssid: 'CERT-Net' }).message,
    'Lost RangerView at 12:04. Still on CERT-Net? Is the laptop running the mini web server awake?');
  assert.strictEqual(boardCause('board-lost', { time: '12:04' }).message,
    'Lost RangerView at 12:04. Is the laptop running the mini web server awake?');
  assert.strictEqual(boardCause('scribe-quiet', { minutes: 6 }).message,
    "RangerView is fine. The scribe's device last checked in 6 min ago.");
  assert.match(boardCause('port-taken', { port: 443, other: 8080, name: 'a web server' }).message, /answers on 443 \(a web server\)\. The mini web server is using 8080 instead/);
  assert.doesNotMatch(boardCause('port-taken', { port: 443, other: 8080 }).message, /\(\)|\{/);
  assert.throws(() => boardCause('no-such-cause'), /Unknown RangerView cause/);
  assert.strictEqual(fill('a {x} b', {}), 'a  b');
});

test('the viewer page carries the words of board-lost and scribe-quiet (it cannot import the list)', () => {
  const html = fs.readFileSync(VIEWER, 'utf8');
  for (const id of ['board-lost', 'scribe-quiet']) {
    const message = causes.find((c) => c.id === id).message;
    const parts = pieces(message);
    assert.ok(parts.length >= 2, `${id} has fixed words to look for`);
    for (const part of parts) assert.ok(html.includes(part), `viewer index.html is missing "${part}" from ${id}; update both places together`);
  }
});
