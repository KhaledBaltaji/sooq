import { redirect } from "next/navigation";
import { PrelaunchGame } from "./prelaunch-game";

export default function ShuRayakPage() {
  if (process.env.NEXT_PUBLIC_PRELAUNCH === "false") {
    redirect("/");
  }
  return <PrelaunchGame />;
}
