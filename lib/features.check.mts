import { isFeatureEnabled, FEATURES } from "./features.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

assert(FEATURES.length === 4, "four features");
assert(isFeatureEnabled({}, "homepage") === true, "missing key defaults true");
assert(isFeatureEnabled({ homepage: false }, "homepage") === false, "false override honored");
assert(isFeatureEnabled({ homepage: true }, "homepage") === true, "true stays true");
assert(isFeatureEnabled({ chapters: false }, "audit") === true, "unrelated key untouched");

console.log("OK: feature flag checks pass");
