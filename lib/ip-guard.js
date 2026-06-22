// SSRF IP guard — rejects any IP that could reach internal/cloud-metadata/private targets.
// Uses node:net BlockList (well-tested) + explicit IPv4-mapped-IPv6 unwrapping so that
// ::ffff:169.254.169.254 (cloud metadata expressed as v6) is caught by the v4 rules.
import net from 'node:net';

const block = new net.BlockList();

// IPv4 ranges (RFC 1918 private, loopback, link-local incl. 169.254 cloud metadata,
// CGNAT, this-network, TEST-NETs, benchmarking, multicast, reserved).
const V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
for (const [addr, bits] of V4) block.addSubnet(addr, bits, 'ipv4');
block.addAddress('255.255.255.255', 'ipv4');

// IPv6 ranges (loopback, unspecified, ULA fc00::/7, link-local fe80::/10, multicast,
// 6to4 and NAT64 which can embed v4 internal targets).
const V6 = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2002::', 16],
  ['64:ff9b::', 96],
];
for (const [addr, bits] of V6) block.addSubnet(addr, bits, 'ipv6');

/**
 * @param {string} ip a resolved IP literal (v4 or v6)
 * @returns {{blocked: boolean, reason?: string}}
 */
export function isBlockedIp(ip) {
  const type = net.isIP(ip);
  if (type === 0) return { blocked: true, reason: 'invalid-ip' };

  if (type === 6) {
    // Unwrap IPv4-mapped (::ffff:a.b.c.d) and re-check as v4 so metadata/private v4
    // targets can't be smuggled through a v6 literal.
    const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (mapped) return isBlockedIp(mapped[1]);
    // Hex form ::ffff:wwww:xxxx is rare; the v4-mapped subnet check below would need
    // expansion — we conservatively also block ::ffff:0:0/96 wholesale for v6 hex form.
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i.test(ip)) {
      return { blocked: true, reason: 'ipv4-mapped-v6-hex' };
    }
  }

  if (block.check(ip, type === 6 ? 'ipv6' : 'ipv4')) {
    return { blocked: true, reason: `blocked-range-v${type}` };
  }
  return { blocked: false };
}
