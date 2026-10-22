import { NextResponse } from "next/server";
import { getSessionUser, isPayoutAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeRun, registerCsv } from "@/lib/payouts";
import { loadRunInput, rowToLine, type RunRow } from "@/lib/payouts/repo";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser();
  if (!user || !isPayoutAdmin(user)) return new NextResponse("Forbidden", { status: 403 });
  const { runId } = await params;
  const db = await createClient();
  const { data: run } = await db.from("payout_run").select("*").eq("id", runId).maybeSingle<RunRow>();
  if (!run) return new NextResponse("Not found", { status: 404 });

  let result;
  if (run.status === "draft" || run.status === "attendance_confirmed") {
    result = computeRun(await loadRunInput(db, run));
  } else {
    const { data } = await db.from("payout_line").select("*").eq("run_id", runId).order("name");
    const lines = (data ?? []).map(rowToLine);
    result = {
      period: { start: run.period_start, end: run.period_end },
      lines,
      total: lines.reduce((s, l) => s + l.net, 0),
      blockers: [],
    };
  }
  return new NextResponse(registerCsv(result), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payout-register-${run.period_start}-${run.status}.csv"`,
    },
  });
}
