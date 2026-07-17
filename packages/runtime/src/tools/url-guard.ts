import { isIP } from 'node:net';
import dns from 'node:dns/promises';

/** Parse an IPv4 dotted-quad into a uint32, or null if malformed. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function inCidr(ip: number, cidr: string): boolean {
  const [net, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const netInt = ipv4ToInt(net);
  if (netInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (netInt & mask);
}

// Loopback, private, link-local (incl. cloud metadata 169.254.169.254),
// CGNAT, benchmarking, multicast, and reserved ranges.
const BLOCKED_V4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return BLOCKED_V4_CIDRS.some((cidr) => inCidr(n, cidr));
}

function isBlockedV6(ip: string): boolean {
  const a = ip.toLowerCase();
  if (a === '::1' || a === '::') return true;
  // link-local fe80::/10 and unique-local fc00::/7
  if (
    a.startsWith('fe8') ||
    a.startsWith('fe9') ||
    a.startsWith('fea') ||
    a.startsWith('feb')
  ) {
    return true;
  }
  if (a.startsWith('fc') || a.startsWith('fd')) return true;
  // IPv4-mapped: dotted (::ffff:127.0.0.1) or hex (::ffff:7f00:1)
  const dotted = a.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isBlockedV4(dotted[1]);
  const hex = a.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isBlockedV4(v4);
  }
  return false;
}

/** True if a literal IP address is private/loopback/link-local/reserved. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // not a valid IP -> block defensively
}

/** True if a hostname is obviously local/internal (before DNS resolution). */
export function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost') return true;
  return (
    h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')
  );
}

/**
 * Validate that a URL points at a public destination. Throws an Error with a
 * human-readable message if the protocol is unsupported, the host is local, or
 * the host resolves to a private/loopback/link-local/reserved address.
 * Returns the parsed URL on success.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL "${rawUrl}"`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`only http(s) URLs are supported (got "${u.protocol}")`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(host)) {
    throw new Error(`refusing to fetch internal host "${host}"`);
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    const resolved = await dns.lookup(host, { all: true });
    addresses = resolved.map((r) => r.address);
  }
  if (addresses.length === 0) {
    throw new Error(`could not resolve host "${host}"`);
  }
  for (const addr of addresses) {
    if (isBlockedAddress(addr)) {
      throw new Error(
        `refusing to fetch "${host}" — resolves to non-public address ${addr}`,
      );
    }
  }
  return u;
}
