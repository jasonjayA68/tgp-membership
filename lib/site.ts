import "server-only";

import { headers } from "next/headers";

/**
 * Resolves the public origin (protocol + host) of the deployment.
 *
 * Prefers an explicit `NEXT_PUBLIC_SITE_URL`, then the live request headers
 * (works on Vercel and locally), and finally a localhost fallback. Used to
 * build absolute NFC verification URLs and QR codes.
 */
export async function getBaseUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (host) {
    const proto =
      h.get("x-forwarded-proto") ??
      (host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https");
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

export function verificationUrl(
  baseUrl: string,
  tenantSlug: string,
  cardSlug: string,
): string {
  return `${baseUrl.replace(/\/$/, "")}/t/${tenantSlug}/id/${cardSlug}`;
}
