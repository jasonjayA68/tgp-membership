export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[640px] bg-[radial-gradient(ellipse_82%_55%_at_50%_0%,color-mix(in_oklab,var(--gold)_18%,transparent),color-mix(in_oklab,var(--gold)_6%,transparent)_40%,transparent_72%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-[520px] bg-gradient-to-b from-transparent to-background [mask-image:linear-gradient(to_bottom,transparent,black_88%)]"
      />
      {children}
    </main>
  );
}
