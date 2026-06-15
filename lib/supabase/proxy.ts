import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { resolveTenantForMiddleware } from "@/lib/tenant/resolve";

/** Bare workspace paths that are only valid under /t/[slug] in subpath mode. */
const WORKSPACE_PREFIXES = ["/dashboard", "/admin", "/profile"];

function matches(prefixes: string[], pathname: string): boolean {
  return prefixes.some(
    (p) => pathname === p || pathname.startsWith(p === "/" ? "/?" : p + "/"),
  );
}

/** Copy refreshed Supabase auth cookies from one response onto another. */
function carryCookies(from: NextResponse, to: NextResponse) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  return to;
}

function redirect(to: string, request: NextRequest, carry: NextResponse) {
  const url = request.nextUrl.clone();
  const [pathname, search = ""] = to.split("?");
  url.pathname = pathname;
  url.search = search;
  return carryCookies(carry, NextResponse.redirect(url));
}

function rewrite(
  to: string,
  request: NextRequest,
  carry: NextResponse,
  requestHeaders?: Headers,
) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = request.nextUrl.search;
  const res = NextResponse.rewrite(
    url,
    requestHeaders ? { request: { headers: requestHeaders } } : undefined,
  );
  return carryCookies(carry, res);
}

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

  // ---- Tenant-scoped routes: /t/[slug]/<rest> -------------------------------
  if (path === "/t" || path.startsWith("/t/")) {
    const segs = path.split("/").filter(Boolean); // ["t", slug, ...rest]
    const slug = segs[1];
    if (!slug) return redirect("/", request, response);
    const rest = "/" + segs.slice(2).join("/");

    const tenant = await resolveTenantForMiddleware(slug);
    if (!tenant) return rewrite("/workspace-not-found", request, response);
    if (tenant.status === "suspended")
      return rewrite("/workspace-suspended", request, response);

    // Logged-out → carry tenant + return path to the global login.
    if (!user) {
      return redirect(
        `/login?tenant=${encodeURIComponent(slug)}&next=${encodeURIComponent(path)}`,
        request,
        response,
      );
    }

    // Inject trusted tenant headers (after stripping any client-supplied ones).
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("x-tenant-id");
    requestHeaders.delete("x-tenant-slug");
    requestHeaders.delete("x-tenant-basepath");
    requestHeaders.set("x-tenant-id", tenant.id);
    requestHeaders.set("x-tenant-slug", tenant.slug);
    requestHeaders.set("x-tenant-basepath", `/t/${tenant.slug}`);

    return rewrite(
      rest === "/" ? "/dashboard" : rest,
      request,
      response,
      requestHeaders,
    );
  }

  // ---- Bare workspace path hit directly (no tenant) → workspace list --------
  if (matches(WORKSPACE_PREFIXES, path)) {
    return redirect("/", request, response);
  }

  // ---- Global routes --------------------------------------------------------
  if (user && (path === "/login" || path === "/register")) {
    return redirect("/", request, response);
  }
  // Strip any spoofed tenant headers on global routes too.
  if (
    request.headers.has("x-tenant-id") ||
    request.headers.has("x-tenant-slug") ||
    request.headers.has("x-tenant-basepath")
  ) {
    const clean = new Headers(request.headers);
    clean.delete("x-tenant-id");
    clean.delete("x-tenant-slug");
    clean.delete("x-tenant-basepath");
    const next = NextResponse.next({ request: { headers: clean } });
    return carryCookies(response, next);
  }

  return response;
}
