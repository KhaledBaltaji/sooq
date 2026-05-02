import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: _id } = await params;
  return {
    title: "Demo Market | Sooq",
    robots: { index: false, follow: false },
  };
}

export default function DemoMarketLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
