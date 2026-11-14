// Next.js 16 Proxy (formerly middleware; Node.js runtime).
// - Unauthenticated page requests -> redirect to /signin; unauthenticated /api/* -> 401 JSON
//   (except /api/auth/* and /api/health).
// - Through the Auth.js wrapper, every request re-issues the session cookie, which gives the 12 h idle timeout.
// - Security headers, including a per-request nonce CSP that Next.js applies to its own scripts.
//   Pages must be dynamically rendered for the nonce to reach them (see dev/README.md).
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth } from "./auth";

const PUBLIC_PAGES = new Set(["/signin"]);

function isPublicApi(pathname: string) {
  return pathname === "/api/health" || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    // Next.js puts the nonce on its framework scripts; 'strict-dynamic' lets those load their chunks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind/Next inject <style> and React style={} attributes; the email preview (iframe srcdoc,
    // which inherits this policy) uses inline style attributes as well.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // The preview is <iframe sandbox srcdoc>: about:srcdoc is not fetched, so 'self' is enough.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Auth.js redirects a sign-in form POST on to Google.
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

function securityHeaders(res: Response, csp: string) {
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return res;
}

const handler = (req: NextAuthRequest) => {
  const { pathname, search } = req.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");
  const signedIn = Boolean(req.auth?.user?.email);
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  if (!signedIn && isApi && !isPublicApi(pathname)) {
    return securityHeaders(
      NextResponse.json({ status: 401, error: "You are not signed in." }, { status: 401, headers: { "Cache-Control": "no-store" } }),
      csp,
    );
  }
  if (!signedIn && !isApi && !PUBLIC_PAGES.has(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("callbackUrl", pathname + search);
    return securityHeaders(NextResponse.redirect(url), csp);
  }
  if (signedIn && pathname === "/signin") {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return securityHeaders(NextResponse.redirect(url), csp);
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return securityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), csp);
};

type Wrapped = (req: NextRequest, ev: NextFetchEvent) => Promise<Response>;
// With a lazy (function) config, auth(handler) resolves to the wrapped handler asynchronously.
const wrapped = Promise.resolve(auth(handler as never) as unknown as Wrapped | Promise<Wrapped>);

export async function proxy(req: NextRequest, ev: NextFetchEvent) {
  return (await wrapped)(req, ev);
}

export const config = {
  matcher: [
    // Everything except static assets.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)",
  ],
};
