import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Adjustment,
  Attendance,
  Contractor,
  PayBand,
  PayoutLine,
  Period,
  PriorLine,
  Reimbursement,
} from "./types";
import type { RunInput } from "./compute";

// Maps database rows (snake_case, bigint centavos) to engine types.

export interface RunRow {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "attendance_confirmed" | "review" | "approved" | "paid";
  return_comment: string | null;
  attendance_confirmed_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
}

export async function loadRunInput(db: SupabaseClient, run: RunRow): Promise<RunInput> {
  const period: Period = { start: run.period_start, end: run.period_end };
  const [contractors, banks, bands, attendance, reimbursements, adjustments, prior] = await Promise.all([
    db.from("contractor").select("*").order("name"),
    db.from("contractor_bank").select("contractor_id, bank_ref, fingerprint"),
    db.from("pay_band").select("*"),
    db.from("attendance").select("contractor_id, days_absent").eq("run_id", run.id),
    db.from("reimbursement").select("*").eq("run_id", run.id),
    db.from("adjustment").select("*").eq("run_id", run.id),
    loadPrior(db, run.period_start),
  ]);
  for (const res of [contractors, banks, bands, attendance, reimbursements, adjustments]) {
    if (res.error) throw new Error(res.error.message);
  }
  const bankBy = new Map((banks.data ?? []).map((b) => [b.contractor_id as string, b]));

  return {
    period,
    contractors: (contractors.data ?? []).map(
      (c): Contractor => ({
        id: c.id,
        name: c.name,
        payRole: c.pay_role,
        monthlyFee: Number(c.monthly_fee),
        contractStart: c.contract_start,
        contractEnd: c.contract_end,
        bankRef: bankBy.get(c.id)?.bank_ref ?? null,
        bankFingerprint: bankBy.get(c.id)?.fingerprint ?? null,
        feeChangeReason: c.fee_change_reason,
        bandOverrideReason: c.band_override_reason,
      }),
    ),
    bands: (bands.data ?? []).map(
      (b): PayBand => ({
        role: b.role,
        label: b.label,
        minMonthly: Number(b.min_monthly),
        maxMonthly: Number(b.max_monthly),
        effectiveFrom: b.effective_from,
      }),
    ),
    attendance: (attendance.data ?? []).map(
      (a): Attendance => ({ contractorId: a.contractor_id, daysAbsent: Number(a.days_absent) }),
    ),
    attendanceConfirmed: run.status !== "draft",
    reimbursements: (reimbursements.data ?? []).map(
      (r): Reimbursement => ({
        id: r.id,
        contractorId: r.contractor_id,
        category: r.category,
        amount: Number(r.amount),
        receiptUrl: r.receipt_path,
      }),
    ),
    adjustments: (adjustments.data ?? []).map(
      (a): Adjustment => ({
        id: a.id,
        contractorId: a.contractor_id,
        kind: a.kind,
        amount: Number(a.amount),
        reason: a.reason,
      }),
    ),
    prior,
  };
}

/** Lines from the most recent paid run before this period. */
async function loadPrior(db: SupabaseClient, periodStart: string): Promise<PriorLine[]> {
  const { data: prev } = await db
    .from("payout_run")
    .select("id")
    .eq("status", "paid")
    .lt("period_start", periodStart)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prev) return [];
  const { data } = await db
    .from("payout_line")
    .select("contractor_id, monthly_fee, net, bank_fingerprint")
    .eq("run_id", prev.id);
  return (data ?? []).map((l) => ({
    contractorId: l.contractor_id,
    monthlyFee: Number(l.monthly_fee),
    net: Number(l.net),
    bankFingerprint: l.bank_fingerprint,
  }));
}

export function lineToRow(runId: string, line: PayoutLine, bankFingerprint: string | null) {
  return {
    run_id: runId,
    contractor_id: line.contractorId,
    name: line.name,
    monthly_fee: line.monthlyFee,
    base: line.base,
    days_absent: line.daysAbsent,
    daily_rate: line.dailyRate,
    absence_deduction: line.absenceDeduction,
    reimbursements: line.reimbursements,
    excluded_reimbursements: line.excludedReimbursements,
    advances: line.advances,
    other_deductions: line.otherDeductions,
    owner_adjustments: line.ownerAdjustments,
    net: line.net,
    bank_fingerprint: bankFingerprint,
    flags: line.flags,
  };
}

export function rowToLine(r: Record<string, unknown>): PayoutLine {
  const n = (k: string) => Number(r[k]);
  return {
    contractorId: r.contractor_id as string,
    name: r.name as string,
    monthlyFee: n("monthly_fee"),
    base: n("base"),
    daysAbsent: n("days_absent"),
    dailyRate: n("daily_rate"),
    absenceDeduction: n("absence_deduction"),
    reimbursements: n("reimbursements"),
    excludedReimbursements: n("excluded_reimbursements"),
    advances: n("advances"),
    otherDeductions: n("other_deductions"),
    ownerAdjustments: n("owner_adjustments"),
    net: n("net"),
    flags: (r.flags as PayoutLine["flags"]) ?? [],
  };
}
