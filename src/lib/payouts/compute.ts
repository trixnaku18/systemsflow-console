import { bandFor } from "./bands";
import { formatPeso, roundDiv, type Centavos } from "./money";
import type {
  Adjustment,
  Attendance,
  Contractor,
  Flag,
  PayBand,
  PayoutLine,
  Period,
  PriorLine,
  Reimbursement,
  RunResult,
} from "./types";

/** Working days per month used for the daily rate (owner decision: Mon–Fri). */
export const WORKDAYS_PER_MONTH = 22;
/** A semi-monthly period never has more than this many working days. */
export const MAX_WORKDAYS_PER_PERIOD = 11;
export const NET_CHANGE_THRESHOLD = 0.1;

export interface RunInput {
  period: Period;
  contractors: Contractor[];
  bands: PayBand[];
  /** One entry per contractor once attendance is entered; missing = not entered. */
  attendance: Attendance[];
  attendanceConfirmed: boolean;
  reimbursements: Reimbursement[];
  adjustments: Adjustment[];
  prior: PriorLine[];
}

export function isActiveInPeriod(c: Contractor, period: Period): boolean {
  return c.contractStart <= period.end && (c.contractEnd === null || c.contractEnd >= period.start);
}

export function dailyRate(monthlyFee: Centavos): Centavos {
  return roundDiv(monthlyFee, WORKDAYS_PER_MONTH);
}

export function absenceDeduction(monthlyFee: Centavos, daysAbsent: number): Centavos {
  const halves = daysAbsent * 2;
  if (!Number.isInteger(halves) || halves < 0) {
    throw new Error(`Days absent must be a non-negative multiple of 0.5, got ${daysAbsent}`);
  }
  // days × fee / 22, computed exactly as halves × fee / 44 and rounded once.
  return roundDiv(halves * monthlyFee, WORKDAYS_PER_MONTH * 2);
}

export function computeLine(
  contractor: Contractor,
  input: Omit<RunInput, "contractors" | "attendanceConfirmed">,
): PayoutLine {
  const { period, bands } = input;
  const fee = contractor.monthlyFee;
  const flags: Flag[] = [];

  const attendance = input.attendance.find((a) => a.contractorId === contractor.id);
  const daysAbsent = attendance?.daysAbsent ?? 0;
  if (!attendance) {
    flags.push({ code: "attendance_missing", severity: "block", message: "No attendance entered for this period." });
  }
  if (daysAbsent > MAX_WORKDAYS_PER_PERIOD) {
    flags.push({
      code: "absences_exceed_period",
      severity: "block",
      message: `${daysAbsent} days absent is more than the ${MAX_WORKDAYS_PER_PERIOD} working days in a period.`,
    });
  }

  const base = roundDiv(fee, 2);
  const absence = absenceDeduction(fee, daysAbsent);

  let reimbursements = 0;
  let excludedReimbursements = 0;
  for (const r of input.reimbursements) {
    if (r.contractorId !== contractor.id) continue;
    if (r.amount <= 0) throw new Error(`Reimbursement ${r.id} must be positive.`);
    if (!r.receiptUrl) {
      excludedReimbursements += r.amount;
      continue;
    }
    reimbursements += r.amount;
    if (r.category === "meds") {
      pushOnce(flags, {
        code: "classification_risk",
        severity: "info",
        message: "Meds reimbursement resembles an employee benefit.",
      });
    }
  }
  if (excludedReimbursements > 0) {
    flags.push({
      code: "receipt_missing",
      severity: "warn",
      message: `${formatPeso(excludedReimbursements)} in reimbursements excluded until receipts are attached.`,
    });
  }

  let advances = 0;
  let otherDeductions = 0;
  let ownerAdjustments = 0;
  for (const a of input.adjustments) {
    if (a.contractorId !== contractor.id) continue;
    if (!a.reason.trim()) throw new Error(`Adjustment ${a.id} needs a reason.`);
    if (a.kind === "owner_adjustment") {
      ownerAdjustments += a.amount;
      continue;
    }
    if (a.amount <= 0) throw new Error(`Adjustment ${a.id} must be positive.`);
    if (a.kind === "advance") advances += a.amount;
    else otherDeductions += a.amount;
  }

  if (absence > 0) {
    pushOnce(flags, {
      code: "classification_risk",
      severity: "info",
      message: "Absence-based deductions pay for time, not output.",
    });
  }

  const net = base - absence + reimbursements - advances - otherDeductions + ownerAdjustments;

  const band = bandFor(bands, contractor.payRole, period.start);
  if (!band) {
    flags.push({ code: "fee_outside_band", severity: "block", message: `No pay band defined for ${contractor.payRole}.` });
  } else if (fee < band.minMonthly || fee > band.maxMonthly) {
    flags.push({
      code: "fee_outside_band",
      severity: contractor.bandOverrideReason ? "warn" : "block",
      message:
        `${formatPeso(fee)}/mo is outside the ${band.label} band ` +
        `(${formatPeso(band.minMonthly)}–${formatPeso(band.maxMonthly)})` +
        (contractor.bandOverrideReason ? `. Owner override: ${contractor.bandOverrideReason}` : "."),
    });
  }

  const prior = input.prior.find((p) => p.contractorId === contractor.id);
  if (prior) {
    if (prior.monthlyFee !== fee && !contractor.feeChangeReason) {
      flags.push({
        code: "fee_changed_no_reason",
        severity: "block",
        message: `Fee changed from ${formatPeso(prior.monthlyFee)} to ${formatPeso(fee)} with no reason on record.`,
      });
    }
    if (prior.net > 0 && Math.abs(net - prior.net) > prior.net * NET_CHANGE_THRESHOLD) {
      flags.push({
        code: "net_change_over_10pct",
        severity: "warn",
        message: `Net ${formatPeso(net)} vs ${formatPeso(prior.net)} last run.`,
      });
    }
    if (prior.bankFingerprint && contractor.bankFingerprint && prior.bankFingerprint !== contractor.bankFingerprint) {
      flags.push({ code: "bank_changed", severity: "warn", message: "Bank account changed since the last run." });
    }
  }

  if (!contractor.bankRef) {
    flags.push({ code: "bank_missing", severity: "block", message: "No bank account on file." });
  }
  if (contractor.contractStart >= period.start && contractor.contractStart <= period.end) {
    flags.push({ code: "contract_new", severity: "info", message: `Contract starts ${contractor.contractStart} (no proration in v0.1).` });
  }
  if (contractor.contractEnd && contractor.contractEnd >= period.start && contractor.contractEnd <= period.end) {
    flags.push({ code: "contract_ended", severity: "info", message: `Contract ends ${contractor.contractEnd} (no proration in v0.1).` });
  }
  if (net < 0) {
    flags.push({ code: "negative_net", severity: "block", message: `Net is ${formatPeso(net)}.` });
  }

  return {
    contractorId: contractor.id,
    name: contractor.name,
    monthlyFee: fee,
    base,
    daysAbsent,
    dailyRate: dailyRate(fee),
    absenceDeduction: absence,
    reimbursements,
    excludedReimbursements,
    advances,
    otherDeductions,
    ownerAdjustments,
    net,
    flags,
  };
}

export function computeRun(input: RunInput): RunResult {
  const active = input.contractors.filter((c) => isActiveInPeriod(c, input.period));
  const lines = active.map((c) => computeLine(c, input));

  // Duplicate payee: two contractors paid to the same account.
  const byAccount = new Map<string, PayoutLine[]>();
  for (const c of active) {
    if (!c.bankFingerprint) continue;
    const line = lines.find((l) => l.contractorId === c.id)!;
    byAccount.set(c.bankFingerprint, [...(byAccount.get(c.bankFingerprint) ?? []), line]);
  }
  for (const group of byAccount.values()) {
    if (group.length < 2) continue;
    const names = group.map((l) => l.name).join(", ");
    for (const line of group) {
      line.flags.push({ code: "duplicate_payee", severity: "block", message: `Same bank account as: ${names}.` });
    }
  }

  const blockers: string[] = [];
  if (lines.length === 0) blockers.push("No active contractors in this period.");
  if (!input.attendanceConfirmed) blockers.push("Attendance not confirmed.");
  for (const line of lines) {
    for (const flag of line.flags) {
      if (flag.severity === "block") blockers.push(`${line.name}: ${flag.message}`);
    }
  }

  return {
    period: input.period,
    lines,
    total: lines.reduce((sum, l) => sum + l.net, 0),
    blockers,
  };
}

function pushOnce(flags: Flag[], flag: Flag) {
  const existing = flags.find((f) => f.code === flag.code);
  if (existing) existing.message += ` ${flag.message}`;
  else flags.push(flag);
}
