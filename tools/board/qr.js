// D-61 item 7 - the viewer QR code. For phone users, who would otherwise type the address.
//
// With a password set, the QR link carries it after a `#`: the browser never sends that part to
// the server, and the Board page reads it, keeps it for the tab and removes it from the address bar.
//
// Two places show it. After a claim the terminal prints a small one. And `/qr` serves a page with
// a large one plus the address in big type, for the laptop's user to open full screen. That page
// shows the password, so it answers ONLY requests that come from this machine (127.0.0.1 or ::1);
// anyone else gets the same 404 as any unknown path. Nothing here logs the password.
const QRCode = require('qrcode');

// An IPv4 loopback may arrive as an IPv4-mapped IPv6 address when the server listens dual-stack.
function isLoopback(address) {
  if (typeof address !== 'string') return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || /^127(\.\d{1,3}){3}$/.test(a);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The address a phone should open. `host` is the first LAN address (E-289), else the .local name.
function viewUrl({ host, port, password }) {
  const hostPort = port === 443 ? host : `${host}:${port}`;
  return `https://${hostPort}/view${password ? `#code=${encodeURIComponent(password)}` : ''}`;
}

// The same address without the password, for the big type on the page and the console.
const plainUrl = ({ host, port }) => viewUrl({ host, port, password: '' });

async function terminalQr(url) {
  return QRCode.toString(url, { type: 'terminal', small: true });
}

async function qrPage({ host, port, password, claimed }) {
  const address = escapeHtml(plainUrl({ host, port }));
  const body = claimed
    ? `<div class="qr">${await QRCode.toString(viewUrl({ host, port, password }), { type: 'svg', margin: 1 })}</div>
<p class="note">${password ? 'The code includes the Board password.' : 'Open to anyone on this network.'}</p>`
    : '<p class="wait">Waiting for the scribe to turn on publishing.</p>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RangerTrak Board address</title>
<style>
  body { margin: 0; padding: 2rem 1rem; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; text-align: center; background: #fff; color: #111; }
  .address { font-size: clamp(1.5rem, 5vw, 3rem); font-weight: 700; word-break: break-all; margin: 0 0 1.5rem; }
  .qr svg { width: min(80vmin, 32rem); height: auto; }
  .note, .wait { font-size: 1.1rem; color: #444; }
</style></head><body>
<p class="address">${address}</p>
${body}
</body></html>
`;
}

/**
 * The `/qr` route. Returns true when it handled the request. `state()` gives the current
 * { host, port, password, claimed }; it is a function so the page always shows the latest.
 */
async function handleQr(req, res, state) {
  const path = req.url.split('?')[0];
  if (path !== '/qr') return false;
  if (req.method !== 'GET' || !isLoopback(req.socket && req.socket.remoteAddress)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return true;
  }
  const html = await qrPage(state());
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
  return true;
}

module.exports = { isLoopback, viewUrl, plainUrl, terminalQr, qrPage, handleQr };
