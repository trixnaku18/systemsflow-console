import type { Centavos } from "./money";

export type PayRole =
  | "it_tier_1"
  | "it_tier_2"
  | "it_tier_3"
  | "csm"
  | "tech_lead"
  | "tech_manager";

export interface PayBand {
  role: PayRole;
  label: string;
  minMonthly: Centavos;
  maxMonthly: Centavos;
  effectiveFrom: string; // ISO date
}

export interface Contractor {
  id: string;
  name: string;
  payRole: PayRole;
  monthlyFee: Centavos;
  contractStart: string; // ISO date
  contractEnd: string | null;
  /** Opaque reference to the encrypted bank account; null if not on file. */
  bankRef: string | null;
  /** Fingerprint of the account number, used only to detect duplicates and changes. */
  bankFingerprint: string | null;
  feeChangeReason: string | null;
  bandOverrideReason: string | null;
}

export interface Period {
  start: string; // ISO date, inclusive
  end: string; // ISO date, inclusive
}

export interface Attendance {
  contractorId: string;
  /** Days absent in this period, in 0.5-day steps. */
  daysAbsent: number;
}

export type ReimbursementCategory = "transport" | "meal" | "device" | "meds" | "other";

export interface Reimbursement {
  id: string;
  contractorId: string;
  category: ReimbursementCategory;
  amount: Centavos;
  receiptUrl: string | null;
}

export type AdjustmentKind = "advance" | "deduction" | "owner_adjustment";

export interface Adjustment {
  id: string;
  contractorId: string;
  kind: AdjustmentKind;
  /** Positive for advance/deduction (subtracted). Signed for owner_adjustment. */
  amount: Centavos;
  reason: string;
}

/** What the previous paid run recorded for a contractor. */
export interface PriorLine {
  contractorId: string;
  monthlyFee: Centavos;
  net: Centavos;
  bankFingerprint: string | null;
}

export type FlagSeverity = "block" | "warn" | "info";

export type FlagCode =
  | "fee_outside_band"
  | "fee_changed_no_reason"
  | "net_change_over_10pct"
  | "bank_missing"
  | "bank_changed"
  | "contract_new"
  | "contract_ended"
  | "duplicate_payee"
  | "receipt_missing"
  | "negative_net"
  | "absences_exceed_period"
  | "attendance_missing"
  | "classification_risk";

export interface Flag {
  code: FlagCode;
  severity: FlagSeverity;
  message: string;
}

export interface PayoutLine {
  contractorId: string;
  name: string;
  monthlyFee: Centavos;
  base: Centavos;
  daysAbsent: number;
  dailyRate: Centavos;
  absenceDeduction: Centavos;
  reimbursements: Centavos;
  excludedReimbursements: Centavos;
  advances: Centavos;
  otherDeductions: Centavos;
  ownerAdjustments: Centavos;
  net: Centavos;
  flags: Flag[];
}

export interface RunResult {
  period: Period;
  lines: PayoutLine[];
  total: Centavos;
  /** Reasons the run cannot be approved yet. Empty = approvable. */
  blockers: string[];
}
