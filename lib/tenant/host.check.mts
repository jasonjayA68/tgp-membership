import { normalizeHost, isCanonicalHost } from "./host.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// normalizeHost
assert(normalizeHost("Acme.ORG") === "acme.org", "lowercases");
assert(normalizeHost("acme.org:3000") === "acme.org", "strips port");
assert(normalizeHost("acme.org.") === "acme.org", "strips trailing dot");
assert(normalizeHost("  acme.org  ") === "acme.org", "trims whitespace");
assert(normalizeHost("evil@acme.org") === "acme.org", "strips userinfo");
assert(normalizeHost("acme.org, other.org") === "acme.org", "takes first of a list");
assert(normalizeHost("") === null, "empty → null");
assert(normalizeHost(null) === null, "null → null");
assert(normalizeHost(undefined) === null, "undefined → null");

// isCanonicalHost
assert(isCanonicalHost("localhost", null) === true, "localhost is canonical");
assert(isCanonicalHost("127.0.0.1", null) === true, "loopback is canonical");
// *.vercel.app is NO LONGER blanket-canonical (a tenant may use one as its domain);
// the app's own vercel host is excluded in middleware via VERCEL_* envs instead.
assert(isCanonicalHost("tgp.vercel.app", null) === false, "*.vercel.app is not blanket-canonical");
assert(isCanonicalHost("council.vercel.app", "tgp.example.com") === false, "other vercel.app is not canonical");
assert(isCanonicalHost("tgp.vercel.app", "tgp.vercel.app") === true, "appHost (even a vercel.app) is canonical");
assert(isCanonicalHost("tgp.example.com", "tgp.example.com") === true, "configured appHost is canonical");
assert(isCanonicalHost("members.acme.org", null) === false, "custom domain is not canonical");
assert(isCanonicalHost("members.acme.org", "tgp.example.com") === false, "other host is not canonical");

console.log("OK: host checks pass");
