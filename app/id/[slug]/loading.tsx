import { TgpSeal } from "@/components/brand/seal";

export default function VerifyLoading() {
  return (
    <main className="flex min-h-svh flex-col items-center px-4 py-10">
      <TgpSeal className="mb-6 size-16 animate-pulse rounded-full opacity-70" />
      <div className="w-full max-w-sm animate-pulse overflow-hidden rounded-xl border border-gold/20 bg-card">
        <div className="h-16 bg-gold/10" />
        <div className="flex flex-col items-center gap-4 border-t border-gold/10 px-5 py-6">
          <div className="size-32 rounded-lg bg-secondary" />
          <div className="h-5 w-40 rounded bg-secondary" />
          <div className="h-4 w-24 rounded bg-secondary" />
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-gold/10 bg-border">
          <div className="h-14 bg-card" />
          <div className="h-14 bg-card" />
          <div className="h-14 bg-card" />
          <div className="h-14 bg-card" />
        </div>
      </div>
    </main>
  );
}
