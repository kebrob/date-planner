import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/auth/cookie';
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
    // Exact public files only; a mere prefix would also let e.g. "/iconic" through unchecked.
    '/((?!_next/static/|_next/image|icons/|favicon\\.ico$|icon\\.svg$|apple-icon\\.png$|manifest\\.webmanifest$|robots\\.txt$).*)',
  ],
};
