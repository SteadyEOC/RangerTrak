'use strict';
// E-287: RangerView holds a Setup file for phones to download, and must NEVER hold the roster (CLAUDE.md rule 5).
// This reads a zip's central directory (no dependency) and says whether the file is safe to hold: no photos, no
// attachments, and a manifest ("mission-zip.json") with no `rangers` and no radio log `entries`.
const zlib = require('node:zlib');

const MANIFEST = 'mission-zip.json';
// E-328: the call sign list (public licence data) may ride in a Setup file as its own entry, four fields per row only.
const CALLSIGNS = 'callsigns.json';
const CALLSIGN_FIELDS = new Set(['call', 'name', 'city', 'region']);
const PHOTO_RE = /\.(jpe?g|png|gif|webp|heic|bmp)$/i;

// Returns [{ name, method, compressedSize, localOffset }] or null when this is not a readable zip.
function listEntries(buf) {
  const min = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) return null;
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, e) {
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 20 * 1024 * 1024 });
  return null;
}

// { ok: true } or { ok: false, reason } where reason is a sentence for the scribe's log.
function checkSetupZip(buf) {
  let entries;
  try { entries = listEntries(buf); } catch { entries = null; }
  if (!entries) return { ok: false, reason: 'That is not a readable Setup file.' };
  const base = (n) => n.split(/[/\\]/).pop() || n;
  for (const e of entries) {
    const dir = e.name.replace(/\\/g, '/').toLowerCase();
    if (dir.startsWith('photos/') || dir.includes('/photos/') || dir.startsWith('attachments/') || dir.includes('/attachments/') || PHOTO_RE.test(base(e.name))) {
      return { ok: false, reason: 'RangerView never holds photos or attachments, and a Setup file for phones must not carry them.' };
    }
  }
  const manifest = entries.find((e) => base(e.name) === MANIFEST);
  if (!manifest) return { ok: false, reason: 'That zip has no mission-zip.json, so it is not a Setup file.' };
  let parsed;
  try {
    const bytes = readEntry(buf, manifest);
    parsed = bytes && JSON.parse(bytes.toString('utf8'));
  } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'The Setup file\'s mission-zip.json could not be read.' };
  if ('rangers' in parsed) return { ok: false, reason: 'RangerView never holds the roster, and a Setup file for phones must not carry rangers.' };
  if ('entries' in parsed) return { ok: false, reason: 'A Setup file for phones must not carry radio log entries.' };
  const cs = entries.find((e) => base(e.name) === CALLSIGNS);
  if (cs) {
    let list;
    try {
      const bytes = readEntry(buf, cs);
      list = bytes && JSON.parse(bytes.toString('utf8'));
    } catch { list = null; }
    const rows = list && Array.isArray(list.rows) ? list.rows : null;
    if (!rows || rows.some((r) => !r || typeof r !== 'object' || Object.keys(r).some((k) => !CALLSIGN_FIELDS.has(k)))) {
      return { ok: false, reason: 'This Setup file call sign list could not be read, or holds more than call sign, name and town.' };
    }
  }
  return { ok: true };
}

module.exports = { checkSetupZip, listEntries };
