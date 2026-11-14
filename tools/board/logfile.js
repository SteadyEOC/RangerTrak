// E-290 (John 2026-11-13): the Board keeps a log file, on by default, so a field test can be read afterwards on
// every Board, not only on a laptop someone remembered to set up for capture. It holds everything the window
// prints, plus one line per request (time, address, method, path, status, ms) and failed TLS handshakes (a device
// that has not accepted the certificate yet). Request secrets travel in headers (x-board-key, x-board-password),
// which are never written. --no-log turns it off. Never fatal: if the file can't be opened, the Board runs on.
const fs = require('fs');
const path = require('path');

const pad = (n, w = 2) => String(n).padStart(w, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  + ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
const fileStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
// Colour codes and the status line's carriage returns would make the file hard to read.
const plain = (s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
const shortUrl = (u) => { const s = String(u || ''); return s.length > 200 ? `${s.slice(0, 200)}...` : s; };
// A TLS socket that failed its handshake has already lost its address; remember() keeps the raw socket's.
const remember = (raw) => { if (raw) raw.rtPeer = raw.remoteAddress; };
const peer = (socket) => {
  const a = (socket && (socket.remoteAddress || socket.rtPeer || (socket._parent && socket._parent.rtPeer))) || '?';
  return a.startsWith('::ffff:') ? a.slice(7) : a;
};

/**
 * Opens <dir>/board-YYYY-MM-DD-HHMMSS.txt. Returns null (and says why through `warn`) if it can't.
 * { file, line(text), request(req, res), tlsError(err, socket), remember(rawSocket), close() }
 */
function openLog({ dir, header = [], now = () => new Date(), warn = () => {} }) {
  let fd;
  let file;
  try {
    fs.mkdirSync(dir, { recursive: true });
    file = path.join(dir, `board-${fileStamp(now())}.txt`);
    fd = fs.openSync(file, 'a');
  } catch (e) {
    warn(`Couldn't open the log file in ${dir} (${e.message}); the Board runs without one.`);
    return null;
  }
  let open = true;
  // Synchronous on purpose: a Board closed with the window's X, or a laptop that dies, keeps every line so far.
  const write = (text) => {
    if (!open) return;
    try { fs.writeSync(fd, `${text}\n`); } catch { open = false; }
  };
  const line = (text) => {
    const t = stamp(now());
    for (const l of plain(text).split('\n')) write(`${t}  ${l}`);
  };
  for (const h of header) line(h);

  const request = (req, res) => {
    const started = now();
    res.on('finish', () => {
      write(`${stamp(now())}  REQ ${peer(req.socket)} ${req.method} ${shortUrl(req.url)} ${res.statusCode} ${now() - started}ms`);
    });
    res.on('close', () => {
      if (!res.writableFinished) write(`${stamp(now())}  REQ ${peer(req.socket)} ${req.method} ${shortUrl(req.url)} closed before the reply finished, ${now() - started}ms`);
    });
  };
  const tlsError = (err, socket) => {
    write(`${stamp(now())}  TLS ${peer(socket)} handshake failed: ${(err && (err.code || err.message)) || 'unknown'}`);
  };
  const close = () => {
    if (!open) return;
    open = false;
    try { fs.closeSync(fd); } catch { /* already gone */ }
  };
  return { file, line, request, tlsError, remember, close };
}

/** Copies every console.log line into the log as well. Returns a function that undoes it. */
function teeConsole(log, target = console) {
  const original = target.log;
  target.log = (...args) => {
    original.apply(target, args);
    log.line(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  };
  return () => { target.log = original; };
}

module.exports = { openLog, teeConsole, plain };
