import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole, hasRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { periodLabel } from "@/lib/dates";
import { computeRun, formatPeso, type PayoutLine } from "@/lib/payouts";
import { loadRunInput, rowToLine, type RunRow } from "@/lib/payouts/repo";
import {
  addAdjustment,
  addReimbursement,
  approveRun,
  markPaid,
  returnRun,
  sendToReview,
} from "../actions";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await requireRole("owner", "finance");
  const { runId } = await params;
  const db = await createClient();
  const { data: run } = await db.from("payout_run").select("*").eq("id", runId).maybeSingle<RunRow>();
  if (!run) notFound();

  const frozen = run.status === "review" || run.status === "approved" || run.status === "paid";
  const input = await loadRunInput(db, run);
  let lines: PayoutLine[];
  let blockers: string[];
  if (frozen) {
    const { data } = await db.from("payout_line").select("*").eq("run_id", runId).order("name");
    lines = (data ?? []).map(rowToLine);
    blockers = lines.flatMap((l) => l.flags.filter((f) => f.severity === "block").map((f) => `${l.name}: ${f.message}`));
  } else {
    const preview = computeRun(input);
    lines = preview.lines;
    blockers = preview.blockers;
  }
  const total = lines.reduce((s, l) => s + l.net, 0);
  const isOwner = hasRole(user, "owner");
  const contractors = input.contractors;

  return (
    <>
      <h1>Payout run · {periodLabel(run.period_start, run.period_end)}</h1>
      <p className="sub">
        Status: <span className="badge">{run.status.replace("_", " ")}</span>
        {frozen ? " · figures frozen when sent to review" : " · live preview, not saved"}
      </p>

      {run.return_comment && run.status === "draft" && (
        <div className="notice block">Returned: {run.return_comment}</div>
      )}
      {blockers.length > 0 && (
        <div className="notice block">
          <strong>Can't approve yet</strong>
          <ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}

      <div className="actions">
        {run.status === "draft" && (
          <Link className="btn primary" href={`/payouts/${runId}/attendance`}>Attendance</Link>
        )}
        {(run.status === "attendance_confirmed" || run.status === "review") && (
          <form action={sendToReview.bind(null, runId)}>
            <button className="btn primary" type="submit">
              {run.status === "review" ? "Recompute" : "Send to Owner for approval"}
            </button>
          </form>
        )}
        {run.status === "review" && isOwner && (
          <form action={approveRun.bind(null, runId)}>
            <button className="btn primary" type="submit" disabled={blockers.length > 0}>Approve run</button>
          </form>
        )}
        {run.status === "approved" && isOwner && (
          <>
            <a className="btn primary" href={`/payouts/${runId}/bank-file`}>Download UnionBank file</a>
            <form action={markPaid.bind(null, runId)}>
              <button className="btn" type="submit">Mark paid (after release in UnionBank)</button>
            </form>
          </>
        )}
        <a className="btn" href={`/payouts/${runId}/register`}>Register (CSV)</a>
        {(run.status === "approved" || run.status === "paid") && (
          <Link className="btn" href={`/payouts/${runId}/statements`}>Statements</Link>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contractor</th>
              <th className="num">Base</th>
              <th className="num">Absences</th>
              <th className="num">Reimb.</th>
              <th className="num">Deductions</th>
              <th className="num">Adj.</th>
              <th className="num">Net</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.contractorId}>
                <td>
                  {l.name}
                  <div className="sub" style={{ margin: 0, fontSize: 12 }}>{formatPeso(l.monthlyFee)}/mo</div>
                </td>
                <td className="num">{formatPeso(l.base)}</td>
                <td className="num">
                  {l.daysAbsent > 0 ? `−${formatPeso(l.absenceDeduction)}` : "—"}
                  {l.daysAbsent > 0 && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>{l.daysAbsent} × {formatPeso(l.dailyRate)}</div>
                  )}
                </td>
                <td className="num">{l.reimbursements ? formatPeso(l.reimbursements) : "—"}</td>
                <td className="num">
                  {l.advances + l.otherDeductions ? `−${formatPeso(l.advances + l.otherDeductions)}` : "—"}
                </td>
                <td className="num">{l.ownerAdjustments ? formatPeso(l.ownerAdjustments) : "—"}</td>
                <td className="num"><strong>{formatPeso(l.net)}</strong></td>
                <td>
                  <div className="flags">
                    {l.flags.map((f) => (
                      <span key={f.code} className={`badge ${f.severity}`} title={f.message}>{f.message}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total ({lines.length})</td>
              <td colSpan={5}></td>
              <td className="num">{formatPeso(total)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {run.status === "review" && isOwner && (
        <>
          <h2>Return for changes</h2>
          <form action={returnRun.bind(null, runId)} className="form">
            <label>
              Reason
              <input name="comment" required placeholder="What needs fixing" />
            </label>
            <button className="btn danger" type="submit">Return to draft</button>
          </form>
        </>
      )}

      {run.status === "draft" && (
        <>
          <h2>Add reimbursement</h2>
          <form action={addReimbursement.bind(null, runId)} className="form">
            <ContractorSelect contractors={contractors} />
            <label>
              Category
              <select name="category" required>
                <option value="transport">Transport</option>
                <option value="meal">Meal</option>
                <option value="device">Work device</option>
                <option value="meds">Meds</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Amount (₱)<input name="amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" /></label>
            <label>Receipt link<input name="receipt" placeholder="Required to pay it" /></label>
            <label>Description<input name="description" /></label>
            <button className="btn" type="submit">Add</button>
          </form>

          <h2>Add advance, deduction or adjustment</h2>
          <form action={addAdjustment.bind(null, runId)} className="form">
            <ContractorSelect contractors={contractors} />
            <label>
              Type
              <select name="kind" required>
                <option value="advance">Cash advance (subtract)</option>
                <option value="deduction">Other deduction (subtract)</option>
                {isOwner && <option value="owner_adjustment">Owner adjustment (+/−)</option>}
              </select>
            </label>
            <label>Amount (₱)<input name="amount" required inputMode="decimal" pattern="-?\d+(\.\d{1,2})?" /></label>
            <label>Reason<input name="reason" required /></label>
            <button className="btn" type="submit">Add</button>
          </form>
        </>
      )}
    </>
  );
}

function ContractorSelect({ contractors }: { contractors: { id: string; name: string }[] }) {
  return (
    <label>
      Contractor
      <select name="contractor_id" required>
        {contractors.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}
