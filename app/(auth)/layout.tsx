export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-svh flex-col items-center bg-background px-4 py-12">
      {children}
    </main>
  );
}
