// /admin/withdrawals → /admin/money?tab=withdrawals
// The withdrawals queue moved into the unified Money page in 0026.
// Keeping this route as a permanent redirect so existing bookmarks +
// the sidebar `pending_finance` deep-link history land on the right tab.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminWithdrawalsRedirect() {
  redirect("/admin/money?tab=withdrawals");
}
