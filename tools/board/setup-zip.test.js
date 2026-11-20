'use strict';
// E-328: a Setup file for phones may carry the call sign list (public data) but still never rangers, photos or attachments.
const test = require('node:test');
const assert = require('node:assert');
const { checkSetupZip } = require('./setup-zip');

// A minimal stored (method 0) zip writer, enough for the central-directory reader.
function crc32(b) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name); const d = Buffer.from(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc32(d), 14);
    lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
    ch.writeUInt32LE(crc32(d), 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameBuf, d); centrals.push(ch, nameBuf); offset += 30 + nameBuf.length + d.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const manifest = JSON.stringify({ schemaVersion: 3, settings: { mission: 'x' }, locations: [] });
const list = (rows) => JSON.stringify({ version: 1, source: 'ised', rows });

test('a Setup file with a call sign list (four fields) is allowed', () => {
  const zip = makeZip({ 'mission-zip.json': manifest, 'callsigns.json': list([{ call: 'VE7AAA', name: 'Pat Example', city: 'Victoria', region: 'BC' }]) });
  assert.deepStrictEqual(checkSetupZip(zip), { ok: true });
});

test('a call sign list with any other field (address, phone) is refused', () => {
  const zip = makeZip({ 'mission-zip.json': manifest, 'callsigns.json': list([{ call: 'VE7AAA', name: 'P', city: 'V', region: 'BC', phone: '555' }]) });
  assert.strictEqual(checkSetupZip(zip).ok, false);
});

test('a call sign list that is not readable is refused', () => {
  assert.strictEqual(checkSetupZip(makeZip({ 'mission-zip.json': manifest, 'callsigns.json': 'nope' })).ok, false);
});

test('rangers, photos and attachments are still refused alongside a call sign list', () => {
  const cs = list([]);
  assert.strictEqual(checkSetupZip(makeZip({ 'mission-zip.json': JSON.stringify({ rangers: [] }), 'callsigns.json': cs })).ok, false);
  assert.strictEqual(checkSetupZip(makeZip({ 'mission-zip.json': manifest, 'callsigns.json': cs, 'photos/a.jpg': 'x' })).ok, false);
  assert.strictEqual(checkSetupZip(makeZip({ 'mission-zip.json': manifest, 'callsigns.json': cs, 'attachments/a.bin': 'x' })).ok, false);
});

test('a Setup file without a list is still fine', () => {
  assert.deepStrictEqual(checkSetupZip(makeZip({ 'mission-zip.json': manifest })), { ok: true });
});
