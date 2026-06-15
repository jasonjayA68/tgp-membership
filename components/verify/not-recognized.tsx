import { ShieldX } from "lucide-react";

export function NotRecognizedCard({ slug }: { slug: string }) {
  return (
    <div className="rounded-xl border border-destructive/40 bg-card p-8 text-center">
      <ShieldX className="mx-auto size-10 text-destructive" />
      <h1 className="tgp-display mt-4 text-xl font-bold">Card Not Recognized</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This verification code does not match any record.
      </p>
      <p className="tgp-mono mt-4 text-xs break-all text-muted-foreground/70">{slug}</p>
    </div>
  );
}

export function PageShellRedirect({ slug }: { slug: string }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <NotRecognizedCard slug={slug} />
      </div>
    </main>
  );
}
