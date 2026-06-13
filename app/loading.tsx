import { TgpSeal } from "@/components/brand/seal";

export default function Loading() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <TgpSeal className="size-20 animate-pulse rounded-full opacity-80" />
    </main>
  );
}
