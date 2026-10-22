import { formatPeso, toDecimal } from "./money";
import type { PayoutLine, RunResult } from "./types";

const REGISTER_COLUMNS = [
  "Contractor",
  "Monthly fee",
  "Base (half)",
  "Days absent",
  "Daily rate",
  "Absence deduction",
  "Reimbursements",
  "Advances",
  "Other deductions",
  "Owner adjustments",
  "Net",
  "Flags",
];

/** Payout register for the founder's records. Never includes bank account numbers. */
export function registerCsv(run: RunResult): string {
  const rows = run.lines.map((l) => [
    l.name,
    toDecimal(l.monthlyFee),
    toDecimal(l.base),
    String(l.daysAbsent),
    toDecimal(l.dailyRate),
    toDecimal(l.absenceDeduction),
    toDecimal(l.reimbursements),
    toDecimal(l.advances),
    toDecimal(l.otherDeductions),
    toDecimal(l.ownerAdjustments),
    toDecimal(l.net),
    l.flags.map((f) => f.code).join(" "),
  ]);
  const total = ["TOTAL", "", "", "", "", "", "", "", "", "", toDecimal(run.total), ""];
  return [REGISTER_COLUMNS, ...rows, total].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * UnionBank bulk-upload file. The exact layout comes from the UnionBank business
 * portal / RM and has not been provided yet, so this refuses rather than guess.
 */
export interface BankFileRow {
  accountNumber: string;
  accountName: string;
  amount: string;
  reference: string;
}

export type BankFileFormatter = (rows: BankFileRow[]) => string;

export function unionBankFile(rows: BankFileRow[], formatter?: BankFileFormatter): string {
  if (!formatter) {
    throw new Error(
      "UnionBank bulk-upload template not configured. Get the template from the UnionBank RM or business portal.",
    );
  }
  return formatter(rows);
}

export function statementText(line: PayoutLine, periodLabel: string): string {
  const out = [
    `Optogrow payout statement — ${periodLabel}`,
    `Contractor: ${line.name}`,
    "",
    `Base fee (half of ${formatPeso(line.monthlyFee)}/mo)   ${formatPeso(line.base)}`,
  ];
  if (line.absenceDeduction > 0) {
    out.push(`Less absences (${line.daysAbsent} × ${formatPeso(line.dailyRate)})   -${formatPeso(line.absenceDeduction)}`);
  }
  if (line.reimbursements > 0) out.push(`Reimbursements   ${formatPeso(line.reimbursements)}`);
  if (line.advances > 0) out.push(`Less cash advances   -${formatPeso(line.advances)}`);
  if (line.otherDeductions > 0) out.push(`Less other deductions   -${formatPeso(line.otherDeductions)}`);
  if (line.ownerAdjustments !== 0) out.push(`Adjustments   ${formatPeso(line.ownerAdjustments)}`);
  out.push("", `Net payout   ${formatPeso(line.net)}`);
  if (line.excludedReimbursements > 0) {
    out.push(
      "",
      `Note: ${formatPeso(line.excludedReimbursements)} in reimbursements will be paid once receipts are attached.`,
    );
  }
  return out.join("\n");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
