import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/dates";
import { statementText } from "@/lib/payouts";
import { rowToLine } from "@/lib/payouts/repo";

export const dynamic = "force-dynamic";

export default async function StatementsPage({ params }: { params: Promise<{ runId: string }> }) {
  await requireRole("owner", "finance");
  const { runId } = await params;
  const db = await createClient();
  const { data: run } = await db.from("payout_run").select("*").eq("id", runId).maybeSingle();
  if (!run) notFound();
  if (run.status !== "approved" && run.status !== "paid") notFound();
  const { data } = await db.from("payout_line").select("*").eq("run_id", runId).order("name");
  const label = periodLabel(run.period_start, run.period_end);
  return (
    <>
      <h1>Payout statements</h1>
      <p className="sub">{label} · one per contractor. Emailing them is not wired up yet; copy from here.</p>
      <div className="grid">
        {(data ?? []).map((row) => {
          const line = rowToLine(row);
          return (
            <div className="card" key={line.contractorId}>
              <pre className="statement">{statementText(line, label)}</pre>
            </div>
          );
        })}
      </div>
    </>
  );
}
