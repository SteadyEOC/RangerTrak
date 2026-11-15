// E-216 slice 1: /hello holds no data, escapes the name, and never touches the claim.
const test = require('node:test');
const assert = require('node:assert');
const { helloPage, handleHello } = require('./hello');

function fakeRes() {
  const r = { status: 0, headers: {}, body: '' };
  r.writeHead = (s, h) => { r.status = s; r.headers = h || {}; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}

test('the page names RangerView and says it is safe to go back', () => {
  const html = helloPage('rangerview.local');
  assert.match(html, /This device can reach RangerView <strong>rangerview.local<\/strong>/);
  assert.match(html, /go back to RangerTrak/);
  assert.doesNotMatch(html, /https?:\/\/|<script|<link/); // self-contained, no external assets
});

test('the name is escaped', () => {
  const html = helloPage('<script>alert(1)</script>"&');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&quot;&amp;/);
});

test('answers 200 as HTML with no password and no claim', () => {
  const res = fakeRes();
  handleHello({ method: 'GET', headers: {} }, res, 'rangerview.local');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /rangerview.local/);
});
