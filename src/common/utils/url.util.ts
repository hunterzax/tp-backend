export function tryParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function isPrivateHostnameOrIp(hostname: string): boolean {
  // IPv6 localhost
  if (hostname === 'localhost' || hostname === '::1') return true;

  // IPv4 checks
  const ipv4 = hostname.match(/^\d+\.\d+\.\d+\.\d+$/);
  if (ipv4) {
    const [a, b] = hostname.split('.').map((n) => parseInt(n, 10));
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
  }

  // Heuristic for local domains
  if (/\.local$/.test(hostname)) return true;
  return false;
}

/**
 * Validate that a user-controlled URL is safe to fetch from this server.
 * - Only http/https
 * - No credentials in URL
 * - Not private/localhost unless explicitly allowlisted via env ALLOWED_IMAGE_HOSTS
 */
export function assertSafeExternalUrl(raw: string): void {
  const url = tryParseUrl(raw);
  if (!url) {
    throw new Error('Invalid URL');
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error('URL protocol not allowed');
  }

  if (url.username || url.password) {
    throw new Error('Credentials in URL not allowed');
  }

  const allowlistRaw = process.env.ALLOWED_IMAGE_HOSTS || '';
  const allowlist = allowlistRaw
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);

  const hostname = url.hostname.toLowerCase();
  const inAllowlist = allowlist.length > 0 && allowlist.includes(hostname);
  const isPrivate = isPrivateHostnameOrIp(hostname);

  if (!inAllowlist && isPrivate) {
    throw new Error('Private or localhost hosts are not allowed');
  }
}


/**
 * Validate service path segments that will be concatenated to an internal base URL (from env).
 * Rejects any absolute URLs, protocol-relative URLs, path traversal, query, or fragment.
 * Allows only relative paths composed of safe URL path characters.
 */
export function assertSafeServicePath(rawPath: string): void {
  if (typeof rawPath !== 'string') {
    throw new Error('Path must be string');
  }
  const path = rawPath.trim();
  if (path.length === 0) {
    throw new Error('Empty path');
  }
  // Disallow absolute URLs or protocol-relative
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path) || path.startsWith('//')) {
    throw new Error('Absolute URL not allowed');
  }
  // Disallow query or fragment
  if (path.includes('?') || path.includes('#')) {
    throw new Error('Query or fragment not allowed');
  }
  // Normalize and check traversal
  const segments = path.split('/');
  if (segments.some(seg => seg === '..')) {
    throw new Error('Path traversal not allowed');
  }
  // Prevent empty segments that could collapse
  if (segments.some(seg => seg.length === 0)) {
    // allow a single leading slash but not repeated // or trailing /
    const normalized = path.replace(/^\/+/, '').replace(/\/+$/,'');
    if (normalized.split('/').some(seg => seg.length === 0)) {
      throw new Error('Malformed path');
    }
  }
  // Allow only safe characters per segment
  const safeSegment = /^[A-Za-z0-9._~!$&'()*+,;=:@-]+$/;
  for (const seg of segments) {
    if (seg === '') continue; // skip leading slash case handled above
    if (!safeSegment.test(seg)) {
      throw new Error('Unsafe characters in path');
    }
  }
}


