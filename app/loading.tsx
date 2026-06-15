import { Brandmark } from "@/components/brand/brandmark";
import { PLATFORM } from "@/lib/constants";

export default function Loading() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      <Brandmark
        name={PLATFORM.name}
        logoUrl={null}
        className="size-20 animate-pulse text-2xl opacity-80"
      />
    </main>
  );
}
