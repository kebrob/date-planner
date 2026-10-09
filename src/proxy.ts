import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'dp_session';
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/password',
  '/api/auth/passkey/login',
  '/api/auth/passkey/login-options',
];

// Cheap first gate on cookie presence only; the session itself is validated server-side via requireSession.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.includes(pathname) || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt).*)',
  ],
};
