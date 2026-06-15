import { buildTenantTheme } from "./theme.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// Both colors null → empty map → default :root theme applies.
assert(Object.keys(buildTenantTheme(null, null)).length === 0, "null/null must be empty");

// A LIGHT surface must get a DARK foreground (the near-black constant).
const light = buildTenantTheme("#2563eb", "#f5f5f5");
assert(light["--background"] === "#f5f5f5", "background = secondary");
assert(light["--foreground"] === "#0a0a08", "light surface → near-black fg (got " + light["--foreground"] + ")");

// A DARK surface must get a LIGHT foreground (the near-white constant).
const dark = buildTenantTheme("#2563eb", "#101010");
assert(dark["--foreground"] === "#f5f1e6", "dark surface → near-white fg (got " + dark["--foreground"] + ")");

// Accent maps from primary; a full token set is produced.
assert(light["--gold"] === "#2563eb", "--gold = primary accent");
assert(typeof light["--gold-bright"] === "string" && light["--gold-bright"] !== light["--gold"], "derived bright shade");

// Only-primary or only-secondary still produces a themed map (not empty).
assert(Object.keys(buildTenantTheme("#2563eb", null)).length > 0, "primary-only themes");

console.log("OK: theme generator checks pass");
