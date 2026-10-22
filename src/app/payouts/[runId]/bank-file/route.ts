import { NextResponse } from "next/server";
import { getSessionUser, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toDecimal, unionBankFile } from "@/lib/payouts";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasRole(user, "owner")) return new NextResponse("Forbidden", { status: 403 });
  const { runId } = await params;
  const db = await createClient();
  const { data: run } = await db.from("payout_run").select("period_start").eq("id", runId).maybeSingle();
  if (!run) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await db.rpc("bank_rows_for_run", { p_run: runId });
  if (error) return new NextResponse(error.message, { status: 400 });
  const rows = (data ?? []).map((r: { account_number: string; account_name: string; net: number }) => ({
    accountNumber: r.account_number,
    accountName: r.account_name,
    amount: toDecimal(Number(r.net)),
    reference: `Optogrow payout ${run.period_start}`,
  }));
  try {
    const body = unionBankFile(rows);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="unionbank-bulk-${run.period_start}.csv"`,
      },
    });
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 501 });
  }
}
