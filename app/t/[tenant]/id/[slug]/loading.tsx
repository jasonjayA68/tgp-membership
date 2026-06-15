export default function VerifyLoading() {
  return (
    <main className="flex min-h-svh flex-col items-center px-4 py-10">
      <div className="w-full max-w-sm animate-pulse overflow-hidden rounded-2xl border border-gold/20 bg-card">
        <div className="h-14 bg-gold/10" />
        <div className="h-12 border-t border-gold/10 bg-secondary/30" />
        <div className="flex items-start gap-4 px-5 py-5">
          <div className="size-[104px] rounded-lg bg-secondary" />
          <div className="flex-1 space-y-3 pt-1">
            <div className="h-5 w-40 rounded bg-secondary" />
            <div className="h-6 w-24 rounded bg-secondary" />
          </div>
        </div>
        <div className="space-y-3 border-t border-gold/10 px-5 py-4">
          <div className="h-4 w-full rounded bg-secondary" />
          <div className="h-4 w-2/3 rounded bg-secondary" />
        </div>
      </div>
    </main>
  );
}
