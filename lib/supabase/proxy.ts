import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Paths reachable without authentication. Everything else requires a session.
 * `/id` is the public NFC verification surface; `/auth` handles email links.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/register",
  "/auth",
  "/id",
  "/forbidden",
  "/unauthorized",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p === "/" ? "/?" : p + "/"),
  );
}

/** Build a redirect that carries over any refreshed auth cookies. */
function redirect(
  pathname: string,
  request: NextRequest,
  carry: NextResponse,
  withNext = false,
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (withNext && request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", request.nextUrl.pathname);
  }
  const response = NextResponse.redirect(url);
  for (const cookie of carry.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

/**
 * Refreshes the Supabase session on every request and performs an optimistic
 * (cookie-only) auth gate. Authoritative role checks still happen in Server
 * Components/Actions — this just keeps tokens fresh and blocks the obvious cases.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // v0.12 passes anti-cache headers that must ride along with Set-Cookie.
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        }
      },
    },
  });

  // IMPORTANT: do not run logic between createServerClient and getUser.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && !isPublic(path)) {
    return redirect("/login", request, response, true);
  }

  if (user && (path === "/login" || path === "/register")) {
    return redirect("/dashboard", request, response);
  }

  return response;
}
