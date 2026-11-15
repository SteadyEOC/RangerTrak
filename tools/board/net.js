// D-61 item 3 - "It listens only on private and link-local addresses and localhost, never on a
// public one, unless an explicit override is given at start."
//
// Pure functions over the shape os.networkInterfaces() returns, so the classification can be
// tested without depending on whatever network the test machine happens to be on.

function parseIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// 'loopback' | 'private' | 'link-local' | 'public' | null (not an IPv4 address).
// 100.64/10 (carrier-grade NAT, which is what Tailscale and some cellular hotspots hand out) is
// deliberately 'public': it is not a network the person at this laptop controls.
function classifyIPv4(ip) {
  const p = parseIPv4(ip);
  if (!p) return null;
  const [a, b] = p;
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  return 'public';
}

// E-216 (#7): adapters that exist inside this computer (virtual machines, containers, VPN tunnels, packet
// capture). A phone can never be on their network, so an address on one is no use to give out. Matched on the
// adapter's name. Windows' own hotspot ("Local Area Connection* 10"), Wi-Fi, Ethernet, en0 and wlan0 are NOT here.
const VIRTUAL_ADAPTER = /^vEthernet|WSL|Hyper-V|Default Switch|VirtualBox|VMware|VMnet|docker|^br-|^veth|Npcap|^TAP-|NordLynx|ZeroTier|^utun/i;
function isVirtualAdapter(name) {
  return VIRTUAL_ADAPTER.test(String(name || ''));
}

/**
 * Splits this machine's IPv4 addresses into what RangerView may listen on and what it must not.
 *  - listen:  private, link-local and loopback addresses (one server is started per address);
 *  - lan:     the listen addresses minus loopback - the ones other devices can actually reach,
 *             so the ones the mDNS name should resolve to;
 *  - skipped: public addresses, reported to the person at the laptop rather than silently dropped;
 *  - virtual: addresses on virtual adapters (isVirtualAdapter), { name, address }. Left out of listen and lan,
 *             and out of skipped; the start-up check says they were left out and why.
 */
function privateAddresses(nets) {
  const listen = [];
  const lan = [];
  const skipped = [];
  const virtual = [];
  const seen = new Set();
  for (const name of Object.keys(nets || {})) {
    for (const net of nets[name] || []) {
      // Node 18.0-18.3 reported family as the number 4, later versions as the string 'IPv4'.
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (seen.has(net.address)) continue;
      seen.add(net.address);
      const kind = classifyIPv4(net.address);
      if (kind !== 'loopback' && kind !== null && isVirtualAdapter(name)) {
        virtual.push({ name, address: net.address });
        continue;
      }
      if (kind === 'loopback') {
        listen.push(net.address);
      } else if (kind === 'private' || kind === 'link-local') {
        listen.push(net.address);
        lan.push(net.address);
      } else if (kind === 'public') {
        skipped.push(net.address);
      }
    }
  }
  return { listen, lan, skipped, virtual };
}

module.exports = { classifyIPv4, privateAddresses, isVirtualAdapter };
