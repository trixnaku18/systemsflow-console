import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/dates";
import { confirmAttendance, saveAttendance } from "../../actions";

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ confirmed?: string }>;
}) {
  const user = await requireRole("owner", "team_lead");
  const { runId } = await params;
  const { confirmed } = await searchParams;
  const db = await createClient();
  const { data: run } = await db.from("payout_run").select("*").eq("id", runId).maybeSingle();
  if (!run) notFound();
  const { data: roster, error } = await db
    .from("attendance_roster")
    .select("contractor_id, name, is_self, days_absent, note")
    .eq("run_id", runId)
    .order("name");

  const editable = run.status === "draft";
  const isOwner = hasRole(user, "owner");
  const missing = (roster ?? []).filter((r) => r.days_absent === null).length;

  return (
    <>
      <h1>Attendance</h1>
      <p className="sub">
        {periodLabel(run.period_start, run.period_end)} · days absent in 0.5 steps · enter 0 when someone had no absences
      </p>
      {error && <div className="notice block">{error.message}</div>}
      {confirmed && <div className="notice">Attendance confirmed. The run is with the Owner now.</div>}
      {run.return_comment && editable && <div className="notice block">Returned by Owner: {run.return_comment}</div>}
      {!editable && !confirmed && <div className="notice">Attendance for this run is locked.</div>}

      <form action={saveAttendance.bind(null, runId)}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Contractor</th><th className="num">Days absent</th><th>Note</th></tr>
            </thead>
            <tbody>
              {(roster ?? []).map((r) => {
                const locked = !editable || (r.is_self && !isOwner);
                return (
                  <tr key={r.contractor_id}>
                    <td>
                      {r.name}
                      {r.is_self && !isOwner && <div className="badge">Entered by the Owner</div>}
                    </td>
                    <td className="num">
                      {locked ? (
                        r.days_absent ?? "—"
                      ) : (
                        <input
                          name={`days:${r.contractor_id}`}
                          type="number"
                          min={0}
                          max={11}
                          step={0.5}
                          defaultValue={r.days_absent ?? ""}
                          placeholder="0"
                          style={{ width: 80, textAlign: "right" }}
                        />
                      )}
                    </td>
                    <td>
                      {locked ? (
                        r.note
                      ) : (
                        <input name={`note:${r.contractor_id}`} defaultValue={r.note ?? ""} placeholder="Optional" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="actions">
            <button className="btn" type="submit">Save</button>
          </div>
        )}
      </form>
      {editable && (
        <form action={confirmAttendance.bind(null, runId)} className="actions">
          <button className="btn primary" type="submit" disabled={missing > 0}>
            Confirm attendance
          </button>
          {missing > 0 && <span className="sub" style={{ margin: 0 }}>{missing} without an entry yet</span>}
        </form>
      )}
      {hasRole(user, "owner", "finance") && <Link href={`/payouts/${runId}`}>Back to run</Link>}
    </>
  );
}
