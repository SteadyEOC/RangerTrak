#!/usr/bin/env node
// E-270 (2026-11-10): index.html carries one inline <script> (the pre-Angular theme/skin
// applier), allowed by the CSP in src/_headers through its SHA-256 hash instead of
// 'unsafe-inline'. Any edit to that script changes its hash, and the browser then blocks it
// without a sound: the page still works, but paints the default theme and flips.
//
// This check hashes every inline <script> in the BUILT index.html (what is actually served,
// after Angular's own index processing) and fails unless src/_headers and the built
// _headers list each hash in script-src. It also fails if script-src gains 'unsafe-inline'.
// On failure it prints the exact token to paste.
//
// Usage: node tools/check-csp-hash.js        (after `ng build`)
//        node tools/check-csp-hash.js --src  (hash src/index.html; no build needed)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const useSrc = process.argv.includes('--src');
const indexFile = useSrc
  ? path.join(root, 'src', 'index.html')
  : path.join(root, 'dist', 'rangertrak', 'browser', 'index.html');
const headerFiles = [path.join(root, 'src', '_headers')];
if (!useSrc) headerFiles.push(path.join(root, 'dist', 'rangertrak', 'browser', '_headers'));

function fail(msg) {
  console.error(`check:csp-hash FAILED: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(indexFile)) fail(`${path.relative(root, indexFile)} not found (run ng build, or pass --src)`);

// Strip HTML comments first: the explanatory comment in index.html mentions <script>.
const html = fs.readFileSync(indexFile, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const inline = [];
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc\s*=/i.test(m[1])) continue;
  if (/\btype\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(m[1])) continue;
  inline.push(m[2]);
}
const tokens = inline.map(body => `'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`);

let bad = false;
for (const file of headerFiles) {
  const rel = path.relative(root, file);
  if (!fs.existsSync(file)) fail(`${rel} not found`);
  const csp = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .find(l => /^\s*Content-Security-Policy(-Report-Only)?:/.test(l));
  if (!csp) fail(`no Content-Security-Policy line in ${rel}`);
  const scriptSrc = (csp.match(/script-src([^;]*)/) || [, ''])[1];
  if (/'unsafe-inline'/.test(scriptSrc)) { console.error(`${rel}: script-src must not allow 'unsafe-inline'`); bad = true; }
  for (const t of tokens) {
    if (!scriptSrc.includes(t)) { console.error(`${rel}: script-src lacks ${t}`); bad = true; }
  }
  const listed = scriptSrc.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
  for (const t of listed) {
    if (!tokens.includes(t)) console.warn(`${rel}: script-src lists ${t}, which matches no inline script (stale?)`);
  }
}
if (bad) fail(`update script-src in src/_headers with the token(s) above (${path.relative(root, indexFile)} has ${inline.length} inline script(s))`);
console.log(`check:csp-hash OK: ${inline.length} inline script(s), each allowed by hash in ${headerFiles.length} _headers file(s)`);
