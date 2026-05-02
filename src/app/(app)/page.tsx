// W2 strip placeholder — the real speed-first home page is designed in W4.
// LMSR home (markets list, AMM previews) was deleted in W2 strip pass 1.

import Link from "next/link";

export const revalidate = 60;

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Sooq Speed</h1>
      <p className="text-muted-foreground text-center max-w-md">
        BTC fast-cycle markets — coming soon.
      </p>
      <Link
        href="/speed"
        className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
      >
        Browse speed markets
      </Link>
    </main>
  );
}
