import { NextResponse, type NextRequest } from 'next/server';

const AUTH_PAGES = new Set(['/login', '/register', '/forgot-password', '/verify-email', '/verify-email-change']);
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/health'];
const COOKIE_NAME = 'milk_session';

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

async function verifySessionToken(token: string | undefined) {
  if (!token) return false;

  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;

  const secret = process.env.SESSION_SECRET || 'development-session-secret-must-be-at-least-32-chars';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  if (base64UrlEncode(new Uint8Array(expected)) !== signature) {
    return false;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (!Number.isInteger(parsed.id) || parsed.id <= 0 || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/manifest') || pathname.includes('.')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const hasValidSession = await verifySessionToken(token);
  const isAuthPage = AUTH_PAGES.has(pathname);
  const isDashboardPath = pathname === '/dashboard' || pathname.startsWith('/dashboard/');

  if (pathname === '/' && hasValidSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (isAuthPage && hasValidSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (isDashboardPath && !hasValidSession) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname.startsWith('/api/') && !PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix)) && !hasValidSession) {
    return NextResponse.json({ ok: false, message: 'Not authenticated.' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
