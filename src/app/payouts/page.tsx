import Link from "next/link";
import { requireRole, isPayoutAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/dates";
import { openCurrentRun } from "./actions";

export const dynamic = "force-dynamic";

export default async function PayoutsPage() {
  const user = await requireRole("owner", "finance", "team_lead");
  const db = await createClient();
  const { data: runs, error } = await db
    .from("payout_run")
    .select("id, period_start, period_end, status")
    .order("period_start", { ascending: false })
    .limit(24);
  const admin = isPayoutAdmin(user);

  return (
    <>
      <h1>Payouts</h1>
      <p className="sub">Semi-monthly runs, cut-off on the 15th and the last day of the month.</p>
      {error && <div className="notice block">{error.message}</div>}
      {admin && (
        <form action={openCurrentRun} className="actions">
          <button className="btn primary" type="submit">Open current period</button>
        </form>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Period</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r.id}>
                <td>{periodLabel(r.period_start, r.period_end)}</td>
                <td><span className={`badge ${r.status === "paid" ? "ok" : ""}`}>{r.status.replace("_", " ")}</span></td>
                <td className="num">
                  {admin && <Link href={`/payouts/${r.id}`}>Open</Link>}
                  {!admin && r.status === "draft" && <Link href={`/payouts/${r.id}/attendance`}>Enter attendance</Link>}
                </td>
              </tr>
            ))}
            {runs?.length === 0 && (
              <tr><td colSpan={3}>No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
