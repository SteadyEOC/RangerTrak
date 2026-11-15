// E-216 slice 1: GET /hello - a page that holds no data and needs no password. A device opens it
// to find out whether it can reach RangerView at all, and to accept the certificate. It is not a
// claim and not a viewer: nothing here touches the mini web server's state.
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function helloPage(name) {
  const board = escapeHtml(name || 'rangerview.local');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RangerView</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5;font-size:1.2rem}</style>
</head><body>
<p>✔ This device can reach the mini web server <strong>${board}</strong>.</p>
<p>You can close this tab and go back to RangerTrak.</p>
</body></html>
`;
}

function handleHello(req, res, name) {
  const body = helloPage(name);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

module.exports = { helloPage, handleHello, escapeHtml };
