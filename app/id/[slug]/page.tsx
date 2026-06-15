import { redirect } from "next/navigation";

import { PageShellRedirect } from "@/components/verify/not-recognized";
import { createClient } from "@/lib/supabase/server";
import type { MemberCard } from "@/lib/types";

/**
 * Legacy flat verification URL. Resolves the card's tenant (pure read, no scan)
 * and 307-redirects to the canonical /t/[tenant]/id/[slug]. Unknown slug → the
 * shared "not recognized" view. Already-printed NFC cards keep working.
 */
export default async function LegacyVerifyRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_member_card", { card_slug: slug });
  if (error) throw new Error(`Verification lookup failed: ${error.message}`);
  const card = (data?.[0] as MemberCard | undefined) ?? null;

  if (!card) return <PageShellRedirect slug={slug} />;

  redirect(`/t/${card.tenant_slug}/id/${slug}`);
}
