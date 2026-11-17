// E-216 slice 2: the console status line.
const test = require('node:test');
const assert = require('node:assert');
const { statusLine, startStatusLine } = require('./statusline');

const at = (hh, mm, ss = 0) => new Date(2026, 9, 23, hh, mm, ss).getTime();
const base = { claimed: true, scribe: 'K7ABC', claimedAt: at(12, 4), scribeSeenAt: at(12, 10), viewers: 3, lastReportAt: at(12, 3) };

test('connected: the scribe was heard in the last 30 s', () => {
  assert.match(statusLine(base, at(12, 10, 20)), /^Scribe: connected \(K7ABC, \d\d?:04[^)]*\) · Viewers: 3 · Last report \d\d?:03.*$/);
});

test('quiet: not heard for over 30 s, and it says since when', () => {
  assert.match(statusLine(base, at(12, 12)), /^Scribe: quiet since \d\d?:10.* · Viewers: 3 · Last report \d\d?:03.*$/);
});

test('none yet before a claim or before the scribe has been heard; no reports yet', () => {
  assert.strictEqual(statusLine({ claimed: false, scribe: '', claimedAt: 0, scribeSeenAt: 0, viewers: 0, lastReportAt: 0 }, at(12, 0)),
    'Scribe: none yet · Viewers: 0 · No reports yet');
  assert.match(statusLine({ ...base, scribeSeenAt: 0, lastReportAt: 0 }, at(12, 0)), /^Scribe: none yet · Viewers: 3 · No reports yet$/);
});

test('the line carries nothing but the scribe name the claim already printed, counts and times', () => {
  const line = statusLine({ ...base, scribe: 'K7ABC' }, at(12, 10, 5));
  assert.doesNotMatch(line, /\d+\.\d+\.\d+\.\d+|::/, 'no addresses');
});

test('startStatusLine prints only when the line changed, and its timer does not keep the process alive', () => {
  let t = at(12, 10, 0);
  let st = { ...base };
  const out = [];
  const s = startStatusLine({ status: () => st, log: (l) => out.push(l), now: () => t, everyMs: 1e9 });
  s.tick(); s.tick();
  assert.strictEqual(out.length, 1, 'same line twice prints once');
  st = { ...st, scribeSeenAt: at(12, 10, 10) };   // the heartbeat moves; connected line is unchanged
  t = at(12, 10, 15);
  s.tick();
  assert.strictEqual(out.length, 1, 'a heartbeat alone prints nothing');
  st = { ...st, viewers: 4 };
  s.tick();
  assert.strictEqual(out.length, 2);
  t = at(12, 13);
  s.tick();
  assert.match(out[2], /quiet since/);
  s.stop();
});

test('E-291 (b): a last report from another day shows its date', () => {
  const { statusLine } = require('./statusline');
  const now = new Date(2026, 10, 14, 10, 1).getTime();
  const yesterday = new Date(2026, 10, 13, 10, 17).getTime();
  const line = statusLine({ claimed: false, viewers: 0, lastReportAt: yesterday }, now);
  assert.match(line, /Last report Nov 13 /);
  assert.doesNotMatch(statusLine({ claimed: false, viewers: 0, lastReportAt: now - 60000 }, now), /Nov/);
});
