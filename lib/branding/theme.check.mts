import { buildTenantTheme, contrastRatio } from "./theme.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// Both null → empty (default :root theme).
assert(Object.keys(buildTenantTheme(null, null)).length === 0, "null/null must be empty");

// Foreground clears the 4.5:1 floor on a worst-case MID-GRAY surface.
const mid = buildTenantTheme("#2563eb", "#777777");
assert(contrastRatio(mid["--foreground"], "#777777") >= 4.5, "fg floor on mid-gray (got " + contrastRatio(mid["--foreground"], "#777777") + ")");

// Foreground clears the floor on a dark surface (and on a light one).
assert(contrastRatio(buildTenantTheme(null, "#101010")["--foreground"], "#101010") >= 4.5, "fg floor on dark");
assert(contrastRatio(buildTenantTheme(null, "#f5f5f5")["--foreground"], "#f5f5f5") >= 4.5, "fg floor on light");

// Accent used as TEXT (--gold) is corrected to be legible on a LIGHT surface.
const lite = buildTenantTheme("#e9b82e", "#f5f5f5");
assert(contrastRatio(lite["--gold"], "#f5f5f5") >= 4.5, "gold legible on light (got " + contrastRatio(lite["--gold"], "#f5f5f5") + ")");

// Muted text also clears the floor.
assert(contrastRatio(mid["--muted-foreground"], "#777777") >= 4.5, "muted fg floor on mid-gray");

// 3-digit hex is accepted and expanded.
const short = buildTenantTheme("#fff", "#000");
assert(short["--background"] === "#000000", "3-digit hex expands (#000→#000000), got " + short["--background"]);

console.log("OK: theme generator checks pass");
