import { z } from "zod";

export const BLOCK_TYPES = ["hero", "text", "banner", "cta", "members"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: "Hero",
  text: "Text",
  banner: "Announcement",
  cta: "Call to action",
  members: "Member count",
};

/** Allow https/http URLs and internal absolute paths; reject everything else. */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const v = href.trim();
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return null;
}

const short = z.string().trim().max(200);
const long = z.string().trim().max(4000);
const href = z
  .string()
  .trim()
  .max(2048)
  .optional()
  .nullable()
  .transform((v) => safeHref(v ?? null));

const heroProps = z.object({
  heading: short,
  subheading: short.optional().default(""),
  ctaLabel: short.optional().default(""),
  ctaHref: href,
});
const textProps = z.object({ heading: short.optional().default(""), body: long });
const bannerProps = z.object({
  tone: z.enum(["info", "gold", "warn"]).default("info"),
  message: short,
  linkLabel: short.optional().default(""),
  linkHref: href,
});
const ctaProps = z.object({ heading: short, label: short, href });
const membersProps = z.object({ heading: short.optional().default("") });

const blockSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("hero"), props: heroProps }),
  z.object({ id: z.string(), type: z.literal("text"), props: textProps }),
  z.object({ id: z.string(), type: z.literal("banner"), props: bannerProps }),
  z.object({ id: z.string(), type: z.literal("cta"), props: ctaProps }),
  z.object({ id: z.string(), type: z.literal("members"), props: membersProps }),
]);

export type Block = z.infer<typeof blockSchema>;
export const HomeContentSchema = z.object({ blocks: z.array(blockSchema).max(50) });
export type HomeContent = z.infer<typeof HomeContentSchema>;

export const DEFAULT_HOME: HomeContent = {
  blocks: [
    {
      id: "default-about",
      type: "text",
      props: {
        heading: "About",
        body: "Welcome to the official membership registry. Every member carries a tamper-resistant digital ID, verifiable in real time via NFC. Sign in to access your member portal, or apply for membership to get started.",
      },
    },
    {
      id: "default-members",
      type: "members",
      props: { heading: "Our community" },
    },
    {
      id: "default-cta",
      type: "cta",
      props: { heading: "Ready to join?", label: "Apply for membership", href: null },
    },
  ],
};

export function newBlock(type: BlockType): Block {
  const id = `b-${Math.random().toString(36).slice(2, 10)}`;
  switch (type) {
    case "hero":
      return { id, type, props: { heading: "Heading", subheading: "", ctaLabel: "", ctaHref: null } };
    case "text":
      return { id, type, props: { heading: "", body: "" } };
    case "banner":
      return { id, type, props: { tone: "info", message: "Announcement", linkLabel: "", linkHref: null } };
    case "cta":
      return { id, type, props: { heading: "Ready to join?", label: "Get started", href: null } };
    case "members":
      return { id, type, props: { heading: "Our members" } };
  }
}
