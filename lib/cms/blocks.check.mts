import { HomeContentSchema, safeHref, newBlock } from "./blocks.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// A valid document parses.
assert(HomeContentSchema.safeParse({ blocks: [newBlock("hero"), newBlock("banner")] }).success, "valid doc parses");

// Over the 50-block cap is rejected.
assert(!HomeContentSchema.safeParse({ blocks: Array.from({ length: 51 }, () => newBlock("text")) }).success, "51 blocks reject");

// safeHref allows internal paths + http(s), rejects everything else.
assert(safeHref("/t/x/dashboard") === "/t/x/dashboard", "internal path allowed");
assert(safeHref("https://example.com") === "https://example.com", "https allowed");
assert(safeHref("javascript:alert(1)") === null, "javascript: rejected");
assert(safeHref("//evil.com") === null, "protocol-relative rejected");
assert(safeHref("") === null, "empty rejected");

// A bad href inside a block is coerced to null by the schema (not a parse error).
const parsed = HomeContentSchema.safeParse({
  blocks: [{ id: "x", type: "cta", props: { heading: "h", label: "go", href: "javascript:bad" } }],
});
assert(parsed.success && parsed.data.blocks[0].props.href === null, "bad href in block → null");

console.log("OK: blocks validator checks pass");
