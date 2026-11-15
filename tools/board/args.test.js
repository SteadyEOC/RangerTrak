// E-290: the mini web server's log is off unless --log is given (on by default only for the 2026-11-14 exercise).
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('../command-post-server');

test('log is off by default', () => assert.strictEqual(parseArgs([]).log, false));
test('--log turns the log on', () => assert.strictEqual(parseArgs(['--log']).log, true));
test('--no-log is still accepted and keeps it off', () => assert.strictEqual(parseArgs(['--no-log']).log, false));
test('the last of --log / --no-log wins', () => {
  assert.strictEqual(parseArgs(['--log', '--no-log']).log, false);
  assert.strictEqual(parseArgs(['--no-log', '--log']).log, true);
});
