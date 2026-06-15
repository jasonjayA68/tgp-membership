"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, CircleAlert, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { saveHomepage, type HomepageState } from "@/lib/actions/homepage";
import {
  BLOCK_LABELS,
  BLOCK_TYPES,
  newBlock,
  type Block,
  type BlockType,
} from "@/lib/cms/blocks";

const initialState: HomepageState = {};

export function HomepageEditor({
  initialBlocks,
  homeUrl,
}: {
  initialBlocks: Block[];
  homeUrl: string;
}) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [addType, setAddType] = useState<BlockType>("hero");
  const [state, formAction] = useActionState(saveHomepage, initialState);

  function patch(i: number, props: Record<string, unknown>) {
    setBlocks((bs) => bs.map((b, j) => (j === i ? ({ ...b, props: { ...b.props, ...props } } as Block) : b)));
  }
  function move(i: number, dir: -1 | 1) {
    setBlocks((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = [...bs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function remove(i: number) {
    setBlocks((bs) => bs.filter((_, j) => j !== i));
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="danger">
          <CircleAlert />
          <span>{state.error}</span>
        </Alert>
      )}
      {state.notice && (
        <Alert variant="success">
          <CheckCircle2 />
          <span>{state.notice}</span>
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48">
          <Label htmlFor="addType">Add block</Label>
          <Select id="addType" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, newBlock(addType)])}>
          <Plus />
          Add
        </Button>
        <Button asChild variant="ghost" className="ml-auto">
          <Link href={homeUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            View homepage
          </Link>
        </Button>
      </div>

      {blocks.map((block, i) => (
        <Card key={block.id} className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="tgp-eyebrow text-[11px] text-gold/80">{BLOCK_LABELS[block.type]}</span>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} aria-label="Move down">
                <ArrowDown />
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label="Delete">
                <Trash2 />
              </Button>
            </div>
          </div>
          <BlockFields block={block} onChange={(props) => patch(i, props)} />
        </Card>
      ))}

      <input type="hidden" name="content" value={JSON.stringify({ blocks })} />
      <SubmitButton pendingText="Saving…">Save homepage</SubmitButton>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function BlockFields({ block, onChange }: { block: Block; onChange: (props: Record<string, unknown>) => void }) {
  switch (block.type) {
    case "hero":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Subheading"><Input value={block.props.subheading} onChange={(e) => onChange({ subheading: e.target.value })} /></Field>
          <Field label="Button label"><Input value={block.props.ctaLabel} onChange={(e) => onChange({ ctaLabel: e.target.value })} /></Field>
          <Field label="Button link (blank = sign in)"><Input value={block.props.ctaHref ?? ""} onChange={(e) => onChange({ ctaHref: e.target.value })} placeholder="/t/slug/dashboard or https://…" /></Field>
        </>
      );
    case "text":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Body"><Textarea rows={5} value={block.props.body} onChange={(e) => onChange({ body: e.target.value })} /></Field>
        </>
      );
    case "banner":
      return (
        <>
          <Field label="Tone">
            <Select value={block.props.tone} onChange={(e) => onChange({ tone: e.target.value })}>
              <option value="info">Info</option>
              <option value="gold">Gold</option>
              <option value="warn">Warning</option>
            </Select>
          </Field>
          <Field label="Message"><Input value={block.props.message} onChange={(e) => onChange({ message: e.target.value })} /></Field>
          <Field label="Link label"><Input value={block.props.linkLabel} onChange={(e) => onChange({ linkLabel: e.target.value })} /></Field>
          <Field label="Link URL"><Input value={block.props.linkHref ?? ""} onChange={(e) => onChange({ linkHref: e.target.value })} /></Field>
        </>
      );
    case "cta":
      return (
        <>
          <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>
          <Field label="Button label"><Input value={block.props.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
          <Field label="Button link"><Input value={block.props.href ?? ""} onChange={(e) => onChange({ href: e.target.value })} /></Field>
        </>
      );
    case "members":
      return <Field label="Heading"><Input value={block.props.heading} onChange={(e) => onChange({ heading: e.target.value })} /></Field>;
  }
}
