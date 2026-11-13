// The Board's start-up update check (John, 2026-11-13): version order, and silence when offline.
const test = require('node:test');
const assert = require('node:assert');
const { isNewer, checkForUpdate, updateLine } = require('./update-check');

test('isNewer follows semver, betas included', () => {
  assert.equal(isNewer('v1.0.0-beta.4', '1.0.0-beta.3'), true);
  assert.equal(isNewer('v1.0.0-beta.10', '1.0.0-beta.9'), true, 'numeric, not text, order');
  assert.equal(isNewer('v1.0.0', '1.0.0-beta.9'), true, 'a release beats its betas');
  assert.equal(isNewer('v1.0.1', '1.0.0'), true);
  assert.equal(isNewer('v1.0.0-beta.3', '1.0.0-beta.3'), false);
  assert.equal(isNewer('v1.0.0-beta.2', '1.0.0-beta.3'), false);
  assert.equal(isNewer('v1.0.0-beta.9', '1.0.0'), false);
  assert.equal(isNewer('nightly', '1.0.0'), false, 'not a version: never newer');
});

const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a newer release is reported with the guide link', async () => {
  const u = await checkForUpdate({ current: '1.0.0-beta.3', fetchImpl: reply(200, { tag_name: 'v1.0.0-beta.4' }) });
  assert.deepStrictEqual(u, { version: '1.0.0-beta.4', url: 'https://rangertrak.org/board/' });
  assert.match(updateLine(u, '1.0.0-beta.3'), /1\.0\.0-beta\.4 \(this is 1\.0\.0-beta\.3\)/);
});

test('the same or an older release, an error reply, junk, or no network: nothing', async () => {
  assert.equal(await checkForUpdate({ current: '1.0.0-beta.3', fetchImpl: reply(200, { tag_name: 'v1.0.0-beta.3' }) }), null);
  assert.equal(await checkForUpdate({ current: '1.0.0-beta.3', fetchImpl: reply(403, { message: 'rate limited' }) }), null);
  assert.equal(await checkForUpdate({ current: '1.0.0-beta.3', fetchImpl: reply(200, null) }), null);
  assert.equal(await checkForUpdate({ current: '1.0.0-beta.3', fetchImpl: async () => { throw new TypeError('fetch failed'); } }), null);
});
