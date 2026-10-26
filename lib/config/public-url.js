const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const normalizeBaseUrl = (raw, { allowLocal = false } = {}) => {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    if (url.protocol !== 'https:' && !(allowLocal && LOCAL_HOSTS.has(url.hostname.toLowerCase()))) return null;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.origin;
  } catch {
    return null;
  }
};

const resolvePublicBaseUrl = ({ request, env = process.env } = {}) => {
  const configured = normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL || env.FRONTEND_URL, {
    allowLocal: env.NODE_ENV !== 'production',
  });
  if (configured) return configured;
  if (env.NODE_ENV === 'production') return null;
  const candidate = request?.nextUrl?.origin || request?.url;
  return normalizeBaseUrl(candidate, { allowLocal: true });
};

module.exports = { LOCAL_HOSTS, normalizeBaseUrl, resolvePublicBaseUrl };
