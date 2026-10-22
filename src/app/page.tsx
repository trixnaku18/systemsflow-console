import Link from "next/link";
import { requireUser, hasRole, isPayoutAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayManila, periodLabel } from "@/lib/dates";
import { periodContaining } from "@/lib/payouts";
import { ghlConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "Waiting for attendance",
  attendance_confirmed: "Attendance confirmed",
  review: "Waiting for Owner approval",
  approved: "Approved — upload to UnionBank",
  paid: "Paid",
};

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const db = await createClient();
  const today = todayManila();
  const period = periodContaining(today);
  const showPayouts = isPayoutAdmin(user) || hasRole(user, "team_lead");

  const { data: run } = showPayouts
    ? await db.from("payout_run").select("id, status").eq("period_start", period.start).maybeSingle()
    : { data: null };
  const { count: approvals } = hasRole(user, "owner")
    ? await db.from("approval").select("id", { count: "exact", head: true }).is("decision", null)
    : { count: null };

  return (
    <>
      <h1>Today</h1>
      <p className="sub">{new Date(`${today}T00:00:00Z`).toDateString()} · Manila</p>
      {denied && <div className="notice block">You don't have access to that page.</div>}
      {user.roles.length === 0 && (
        <div className="notice block">Your account has no role yet. Ask the Owner to assign one.</div>
      )}
      <div className="grid">
        {showPayouts && (
          <div className="card stat">
            <div className="label">Payout cut-off</div>
            <div className="value">{period.end}</div>
            <div className="label" style={{ marginTop: 8 }}>
              {periodLabel(period.start, period.end)} · {run ? STATUS_LABEL[run.status] : "Run not opened"}
            </div>
            <div className="actions">
              {run ? (
                <Link className="btn" href={hasRole(user, "team_lead") && !isPayoutAdmin(user) ? `/payouts/${run.id}/attendance` : `/payouts/${run.id}`}>
                  Open run
                </Link>
              ) : (
                <Link className="btn" href="/payouts">Payouts</Link>
              )}
            </div>
          </div>
        )}
        {approvals !== null && (
          <div className="card stat">
            <div className="label">Approvals waiting</div>
            <div className="value">{approvals}</div>
          </div>
        )}
        {hasRole(user, "owner") && (
          <div className="card stat">
            <div className="label">GHL connection</div>
            <div className="value">{ghlConfig().configured ? "Configured" : "Not set up"}</div>
            <div className="actions"><Link className="btn" href="/ghl">Check</Link></div>
          </div>
        )}
      </div>
    </>
  );
}
