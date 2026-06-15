/**
 * Prefixes an in-app path with the active tenant's base path.
 *   tenantHref("/t/tgp", "/admin") === "/t/tgp/admin"
 *   tenantHref("",       "/admin") === "/admin"   // custom-domain case (later)
 * `path` must be a root-relative path beginning with "/".
 */
export function tenantHref(basePath: string, path: string): string {
  if (!basePath) return path;
  return path === "/" ? basePath : `${basePath}${path}`;
}
