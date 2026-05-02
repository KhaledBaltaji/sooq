import type { Metadata } from "next";
import { ForceLightTheme } from "./force-light-theme";

export const metadata: Metadata = {
  title: "شو رأيك؟ | sooq",
  description: "شارك رأيك بأحداث لبنان — وشوف شو رأي الناس",
  openGraph: {
    title: "شو رأيك؟ — sooq",
    description: "توقع أحداث لبنان مع آلاف اللبنانيين",
  },
};

export default function PrelaunchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-bg overflow-hidden overscroll-none">
      <ForceLightTheme />
      <main id="main" className="h-full">
        {children}
      </main>
    </div>
  );
}
