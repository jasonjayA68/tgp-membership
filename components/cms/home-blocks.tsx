import Link from "next/link";
import { Megaphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Block } from "@/lib/cms/blocks";
import { cn } from "@/lib/utils";

export type BlockContext = { slug: string; memberCount: number };

function paragraphs(body: string) {
  return body.split(/\n{2,}/).map((p, i) => (
    <p key={i} className="text-muted-foreground [&:not(:first-child)]:mt-3">
      {p}
    </p>
  ));
}

/** Renders one block. All text is escaped React children — no HTML/markdown. */
export function BlockRenderer({ block, ctx }: { block: Block; ctx: BlockContext }) {
  switch (block.type) {
    case "hero": {
      const href = block.props.ctaHref ?? `/t/${ctx.slug}/login`;
      return (
        <section className="py-12 text-center">
          <h1 className="tgp-display tgp-gild text-3xl font-black tracking-tight sm:text-5xl">
            {block.props.heading}
          </h1>
          {block.props.subheading && (
            <p className="mx-auto mt-4 max-w-xl text-balance text-muted-foreground">
              {block.props.subheading}
            </p>
          )}
          {block.props.ctaLabel && (
            <Button asChild size="lg" className="mt-6">
              <Link href={href}>{block.props.ctaLabel}</Link>
            </Button>
          )}
        </section>
      );
    }
    case "text":
      return (
        <section className="py-6">
          {block.props.heading && (
            <h2 className="tgp-display text-xl font-semibold tracking-wide">{block.props.heading}</h2>
          )}
          <div className="mt-2">{paragraphs(block.props.body)}</div>
        </section>
      );
    case "banner":
      return (
        <aside
          className={cn(
            "my-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3",
            block.props.tone === "gold" && "border-gold/40 bg-gold/10 text-gold-bright",
            block.props.tone === "warn" && "border-amber-500/40 bg-amber-500/10 text-amber-300",
            block.props.tone === "info" && "border-border bg-card text-foreground",
          )}
        >
          <Megaphone className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">{block.props.message}</span>
          {block.props.linkLabel && block.props.linkHref && (
            <Link href={block.props.linkHref} className="text-sm font-medium underline-offset-4 hover:underline">
              {block.props.linkLabel}
            </Link>
          )}
        </aside>
      );
    case "cta":
      return (
        <section className="my-6 rounded-xl border border-gold/30 bg-card p-8 text-center tgp-frame">
          <h2 className="tgp-display text-2xl font-bold">{block.props.heading}</h2>
          <Button asChild size="lg" className="mt-4">
            <Link href={block.props.href ?? `/t/${ctx.slug}/register`}>{block.props.label}</Link>
          </Button>
        </section>
      );
    case "members":
      return (
        <section className="py-8 text-center">
          {block.props.heading && (
            <p className="tgp-eyebrow text-[11px] text-gold/80">{block.props.heading}</p>
          )}
          <div className="tgp-display tgp-gild mt-2 text-5xl font-black">{ctx.memberCount}</div>
          <p className="text-xs tracking-widest text-muted-foreground uppercase">Active members</p>
        </section>
      );
  }
}
