import { createClient } from "@/lib/supabase/server";
import { FeeConfigEditor } from "@/components/admin/fee-config-editor";

export default async function AdminFeesPage() {
  const supabase = await createClient();
  const { data: fees } = await supabase
    .from("fee_config")
    .select("*")
    .order("fee_type")
    .order("level")
    .order("depth");

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-4xl font-extrabold tracking-tight text-[#2a3439] font-[family-name:var(--font-manrope)]">
          Fee Configuration
        </h2>
        <p className="text-[#566166] mt-2">
          Platform fees, AMM settings, and agent commission rates. All rates are read from the database.
        </p>
      </div>

      {/* Fee Editor */}
      <FeeConfigEditor fees={(fees || []) as any} />
    </div>
  );
}
