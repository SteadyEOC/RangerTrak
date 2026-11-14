// D-61 item 1 - the Board announces `rangertrak-board.local` over multicast DNS, so its address
// stays the same from one network to the next (the IPs change every time; the name does not).
//
// A minimal responder, written by hand rather than pulled in as a dependency (this tool adds no
// npm packages). It does exactly three things:
//   1. PROBES for the name before claiming it (RFC 6762 section 8, simplified): three queries
//      250 ms apart. An A-record answer from an address that is not ours means another device
//      holds the name, so try rangertrak-board-2.local, then -3, and so on.
//   2. ANNOUNCES the name twice, 1 s apart, then answers A queries for it.
//   3. Sends a GOODBYE (TTL 0) on exit so neighbours' caches drop it at once.
// Also answers (E-289) a query that asks for a unicast reply (the QU bit) straight to the asker, and a
// "legacy unicast" query - one sent from a port other than 5353 by a plain DNS resolver - the way RFC 6762
// section 6.7 says: the query's id echoed, the question repeated, a short TTL, no cache-flush bit.
// IPv4 only. Not a general mDNS stack: no AAAA, no service discovery, no known-answer
// suppression, no simultaneous-probe tiebreak. If another responder already owns UDP 5353
// exclusively (Bonjour on some Windows machines), claim() resolves null and the caller carries
// on with plain IP addresses - the name is a convenience, never a requirement.
const dgram = require('dgram');

const MDNS_ADDRESS = '224.0.0.251';
const MDNS_PORT = 5353;
const TYPE_A = 1;
const TYPE_ANY = 255;
const CLASS_IN = 1;
const FLAG_TOP_BIT = 0x8000; // question: "unicast response wanted"; answer: "cache-flush"
const RESPONSE_AUTHORITATIVE = 0x8400;

// ---- Packet encode / decode -----------------------------------------------------------------

function encodeName(name) {
  const out = [];
  for (const label of String(name).replace(/\.$/, '').split('.')) {
    const bytes = Buffer.from(label, 'latin1');
    if (bytes.length === 0 || bytes.length > 63) throw new Error(`Bad DNS label in "${name}"`);
    out.push(Buffer.from([bytes.length]), bytes);
  }
  out.push(Buffer.from([0]));
  return Buffer.concat(out);
}

function header(flags, questions, answers, id = 0) {
  const h = Buffer.alloc(12);
  h.writeUInt16BE(id, 0); // id: 0 in mDNS, the query's own id in a legacy unicast reply
  h.writeUInt16BE(flags, 2);
  h.writeUInt16BE(questions, 4);
  h.writeUInt16BE(answers, 6);
  return h; // authority and additional counts stay 0
}

function encodeQuery(name) {
  const q = Buffer.alloc(4);
  q.writeUInt16BE(TYPE_A, 0);
  q.writeUInt16BE(CLASS_IN, 2);
  return Buffer.concat([header(0, 1, 0), encodeName(name), q]);
}

// One A record per address, the cache-flush bit set (this host owns the whole record set).
// ttl 0 is the goodbye packet.
function encodeAnswer(name, addresses, ttl) {
  const encodedName = encodeName(name);
  const parts = [header(RESPONSE_AUTHORITATIVE, 0, addresses.length)];
  for (const address of addresses) {
    const rr = Buffer.alloc(10 + 4);
    rr.writeUInt16BE(TYPE_A, 0);
    rr.writeUInt16BE(CLASS_IN | FLAG_TOP_BIT, 2);
    rr.writeUInt32BE(ttl, 4);
    rr.writeUInt16BE(4, 8);
    Buffer.from(address.split('.').map(Number)).copy(rr, 10);
    parts.push(encodedName, rr);
  }
  return Buffer.concat(parts);
}

// RFC 6762 section 6.7: the reply to a legacy unicast query. TTL at most 10 s, no cache-flush bit,
// the question repeated so an ordinary DNS resolver accepts it.
const LEGACY_TTL = 10;
function encodeLegacyAnswer(id, name, addresses) {
  const encodedName = encodeName(name);
  const q = Buffer.alloc(4);
  q.writeUInt16BE(TYPE_A, 0);
  q.writeUInt16BE(CLASS_IN, 2);
  const parts = [header(RESPONSE_AUTHORITATIVE, 1, addresses.length, id), encodedName, q];
  for (const address of addresses) {
    const rr = Buffer.alloc(10 + 4);
    rr.writeUInt16BE(TYPE_A, 0);
    rr.writeUInt16BE(CLASS_IN, 2);
    rr.writeUInt32BE(LEGACY_TTL, 4);
    rr.writeUInt16BE(4, 8);
    Buffer.from(address.split('.').map(Number)).copy(rr, 10);
    parts.push(encodedName, rr);
  }
  return Buffer.concat(parts);
}

// The addresses with the asker's own /24 first, so a resolver that takes the first answer gets one it can reach.
function nearestFirst(addresses, from) {
  const net = (a) => String(a).split('.').slice(0, 3).join('.');
  return [...addresses].sort((a, b) => (net(b) === net(from)) - (net(a) === net(from)));
}

// Other responders compress names: a two-byte pointer (top two bits set) to an earlier
// occurrence. We never write one, but we must read them. The hop limit stops a malicious packet
// whose pointers loop.
function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let next = -1;
  let hops = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('Name runs past the end of the packet');
    const len = buf[pos];
    if (len === 0) { pos += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error('Truncated name pointer');
      if (next < 0) next = pos + 2;
      if (++hops > 16) throw new Error('Name pointer loop');
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    if (len & 0xc0) throw new Error('Reserved label type');
    if (pos + 1 + len > buf.length) throw new Error('Label runs past the end of the packet');
    labels.push(buf.toString('latin1', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.join('.'), next: next < 0 ? pos : next };
}

/**
 * Decodes a whole message: header flags, the question section, and every resource record in the
 * answer, authority and additional sections (a host's A record often arrives as an
 * "additional"). Only A records get their address decoded; other types are stepped over by
 * their length. Throws on a truncated or malformed packet - callers drop those.
 */
function decodeMessage(buf) {
  if (buf.length < 12) throw new Error('Packet shorter than a DNS header');
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const rrCount = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  const questions = [];
  for (let i = 0; i < qd; i++) {
    const { name, next } = readName(buf, pos);
    if (next + 4 > buf.length) throw new Error('Truncated question');
    const cls = buf.readUInt16BE(next + 2);
    questions.push({ name, type: buf.readUInt16BE(next), class: cls & 0x7fff, unicast: !!(cls & FLAG_TOP_BIT) });
    pos = next + 4;
  }
  const records = [];
  for (let i = 0; i < rrCount; i++) {
    const { name, next } = readName(buf, pos);
    if (next + 10 > buf.length) throw new Error('Truncated record');
    const type = buf.readUInt16BE(next);
    const cls = buf.readUInt16BE(next + 2);
    const ttl = buf.readUInt32BE(next + 4);
    const rdlen = buf.readUInt16BE(next + 8);
    const rdata = next + 10;
    if (rdata + rdlen > buf.length) throw new Error('Truncated record data');
    const record = { name, type, class: cls & 0x7fff, flush: !!(cls & FLAG_TOP_BIT), ttl };
    if (type === TYPE_A && rdlen === 4) record.address = Array.from(buf.subarray(rdata, rdata + 4)).join('.');
    records.push(record);
    pos = rdata + rdlen;
  }
  return { id, flags, response: !!(flags & 0x8000), questions, records };
}

const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// A conflict is somebody ELSE claiming our name: an A-record answer for it from a source address
// that is not one of ours. An answer from our own address is our previous run, still on the wire
// after a quick restart - the name holds (D-61 item 1).
function isConflict(message, name, fromAddress, ownAddresses) {
  if (!message.response) return false;
  if (ownAddresses.includes(fromAddress)) return false;
  return message.records.some((r) => r.type === TYPE_A && sameName(r.name, name));
}

// ---- The responder --------------------------------------------------------------------------

// The DNS label for a name the person typed: lower case, letters, digits and hyphens.
function sanitizeLabel(raw) {
  return String(raw).trim().toLowerCase().replace(/\.local\.?$/, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} o
 * @param {string}   o.label       first-choice label, e.g. 'rangertrak-board'
 * @param {string[]} o.addresses   the private addresses to answer with (also the interfaces we
 *                                 join the multicast group on and send from)
 * @param {function} [o.log]
 * @param {number}   [o.port], [o.group], [o.probeGapMs], [o.maxTries]  test hooks
 */
function createResponder({ label, addresses, log = () => {}, port = MDNS_PORT, group = MDNS_ADDRESS, probeGapMs = 250, maxTries = 9 }) {
  let socket = null;
  let claimedName = null;
  let probing = null; // { name, conflicted } while a candidate name is being probed
  let announceTimer = null;
  let stopped = false;

  function send(packet) {
    // One send per interface: a multi-homed laptop must announce on every network it is on.
    return Promise.all(addresses.map((addr) => new Promise((resolve) => {
      try { socket.setMulticastInterface(addr); } catch { /* interface vanished */ }
      socket.send(packet, 0, packet.length, port, group, () => resolve());
    })));
  }

  function onMessage(buf, rinfo) {
    let message;
    try { message = decodeMessage(buf); } catch { return; } // not ours to complain about
    if (probing && isConflict(message, probing.name, rinfo.address, addresses)) {
      probing.conflicted = true;
      return;
    }
    if (!claimedName || message.response) return;
    const q = message.questions.find((x) => sameName(x.name, claimedName) && (x.type === TYPE_A || x.type === TYPE_ANY));
    if (!q) return;
    const reply = (packet, toPort) => { try { socket.send(packet, 0, packet.length, toPort, rinfo.address); } catch { /* gone */ } };
    if (rinfo.port !== port) {
      // A plain DNS resolver asking (RFC 6762 6.7): reply to it alone, in a form it accepts.
      reply(encodeLegacyAnswer(message.id, q.name, nearestFirst(addresses, rinfo.address)), rinfo.port);
    } else if (q.unicast) {
      reply(encodeAnswer(claimedName, nearestFirst(addresses, rinfo.address), 120), rinfo.port);
    } else {
      send(encodeAnswer(claimedName, addresses, 120)).catch(() => {});
    }
  }

  async function open() {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise((resolve, reject) => {
      s.once('error', reject);
      s.bind(port, () => { s.removeListener('error', reject); resolve(); });
    });
    s.on('error', (e) => log(`mDNS socket error: ${e.message}`));
    let joined = 0;
    for (const addr of addresses) {
      try { s.addMembership(group, addr); joined++; } catch { /* that interface can't multicast */ }
    }
    if (joined === 0) { s.close(); throw new Error('no network interface could join the multicast group'); }
    s.setMulticastTTL(255);
    s.setMulticastLoopback(true);
    s.on('message', onMessage);
    socket = s;
  }

  /** Resolves with the name actually taken (`rangertrak-board.local`, `-2.local`, ...), or null
   *  if mDNS can't be used here (the caller then prints IP addresses only). */
  async function claim() {
    try {
      await open();
    } catch (e) {
      log(`mDNS unavailable: ${e.code || e.message}`);
      return null;
    }
    for (let attempt = 1; attempt <= maxTries && !stopped; attempt++) {
      const name = `${attempt === 1 ? label : `${label}-${attempt}`}.local`;
      probing = { name, conflicted: false };
      for (let i = 0; i < 3 && !probing.conflicted; i++) {
        await send(encodeQuery(name));
        await sleep(probeGapMs);
      }
      const conflicted = probing.conflicted;
      probing = null;
      if (!conflicted) { claimedName = name; return name; }
      log(`${name} is already in use on this network.`);
    }
    await stop();
    return null;
  }

  /** Two unsolicited answers, 1 s apart. Call once the server is actually listening. */
  function announce() {
    if (!claimedName || stopped) return;
    const packet = encodeAnswer(claimedName, addresses, 120);
    send(packet).catch(() => {});
    announceTimer = setTimeout(() => { send(packet).catch(() => {}); announceTimer = null; }, 1000);
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (announceTimer) clearTimeout(announceTimer);
    if (!socket) return;
    if (claimedName) await send(encodeAnswer(claimedName, addresses, 0)); // goodbye
    await new Promise((resolve) => socket.close(resolve));
    socket = null;
  }

  return { claim, announce, stop };
}

module.exports = { createResponder, sanitizeLabel, encodeName, encodeQuery, encodeAnswer, encodeLegacyAnswer, nearestFirst, decodeMessage, isConflict, MDNS_PORT, MDNS_ADDRESS };
