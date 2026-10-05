import dns from "node:dns/promises";
import net from "node:net";

export type UrlSafetyResult =
  | { safe: true; url: string; resolvedIp: string }
  | { safe: false; url: string; reason: string };

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => ((acc << 8) + parseInt(octet, 10)) >>> 0, 0);
}

function inCidrIPv4(ipStr: string, cidrNet: string, maskBits: number): boolean {
  if (!net.isIPv4(ipStr)) return false;
  const ip = ipToLong(ipStr);
  const netIp = ipToLong(cidrNet);
  const mask = (0xffffffff << (32 - maskBits)) >>> 0;
  return (ip & mask) === (netIp & mask);
}

export function isPrivateIp(ip: string): boolean {
  // Normalize decimal/hex IP representation (e.g. 2130706433 -> 127.0.0.1, 0x7f.0.0.1)
  let normalizedIp = ip;
  if (/^\d+$/.test(ip)) {
    const num = parseInt(ip, 10);
    if (num >= 0 && num <= 0xffffffff) {
      normalizedIp = [(num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff].join(".");
    }
  }

  if (net.isIPv4(normalizedIp)) {
    // 127.0.0.0/8 (loopback)
    if (inCidrIPv4(normalizedIp, "127.0.0.0", 8)) return true;
    // 10.0.0.0/8 (private)
    if (inCidrIPv4(normalizedIp, "10.0.0.0", 8)) return true;
    // 172.16.0.0/12 (private)
    if (inCidrIPv4(normalizedIp, "172.16.0.0", 12)) return true;
    // 192.168.0.0/16 (private)
    if (inCidrIPv4(normalizedIp, "192.168.0.0", 16)) return true;
    // 169.254.0.0/16 (link-local)
    if (inCidrIPv4(normalizedIp, "169.254.0.0", 16)) return true;
    // 100.64.0.0/10 (CGNAT / Carrier-grade NAT)
    if (inCidrIPv4(normalizedIp, "100.64.0.0", 10)) return true;
    // 0.0.0.0/8
    if (inCidrIPv4(normalizedIp, "0.0.0.0", 8)) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    // IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
    if (normalized.startsWith("::ffff:")) {
      const ipv4 = normalized.slice(7);
      if (net.isIPv4(ipv4)) {
        return isPrivateIp(ipv4);
      }
    }
    // ::1 (loopback) or :: (unspecified)
    if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1" || normalized === "::") return true;
    // fe80::/10 (link-local)
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    // fc00::/7 (unique local)
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    return false;
  }
  return false;
}

export async function validateUrlSafety(inputUrl: string): Promise<UrlSafetyResult> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return { safe: false, url: inputUrl, reason: "Invalid URL syntax" };
  }

  // Allow only http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, url: inputUrl, reason: `Blocked protocol "${parsed.protocol}". Only http and https are allowed.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost or .localhost or .local
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { safe: false, url: inputUrl, reason: `Blocked localhost host "${hostname}".` };
  }

  // Direct IP check
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { safe: false, url: inputUrl, reason: `Blocked private or loopback IP address "${hostname}".` };
    }
    return { safe: true, url: parsed.href, resolvedIp: hostname };
  }

  // DNS resolution check
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, url: inputUrl, reason: `Could not resolve hostname "${hostname}".` };
    }

    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        return { safe: false, url: inputUrl, reason: `Hostname "${hostname}" resolved to private IP "${addr.address}".` };
      }
    }

    return { safe: true, url: parsed.href, resolvedIp: addresses[0].address };
  } catch (err: any) {
    return { safe: false, url: inputUrl, reason: `DNS resolution failed for "${hostname}": ${err.message}` };
  }
}

export async function fetchSafe(
  initialUrl: string,
  options: RequestInit & { maxRedirects?: number } = {}
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = initialUrl;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const safety = await validateUrlSafety(currentUrl);
    if (!safety.safe) {
      throw new Error(`Security error: ${safety.reason}`);
    }

    const { maxRedirects: _, ...fetchOpts } = options;
    const res = await fetch(currentUrl, {
      ...fetchOpts,
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      const location = res.headers.get("location")!;
      currentUrl = new URL(location, currentUrl).href;
      redirects++;
      continue;
    }

    return res;
  }

  throw new Error(`Too many redirects (limit ${maxRedirects})`);
}
