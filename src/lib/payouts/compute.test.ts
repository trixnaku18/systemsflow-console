import { describe, expect, it } from "vitest";
import {
  SEED_PAY_BANDS,
  absenceDeduction,
  computeRun,
  dailyRate,
  nextPeriod,
  periodContaining,
  pesos,
  registerCsv,
  statementText,
  unionBankFile,
  type Contractor,
  type RunInput,
} from "./index";

const OCT_1 = { start: "2026-10-01", end: "2026-10-15" };

function contractor(overrides: Partial<Contractor> = {}): Contractor {
  return {
    id: "c1",
    name: "Ana",
    payRole: "it_tier_1",
    monthlyFee: pesos(18000),
    contractStart: "2026-01-01",
    contractEnd: null,
    bankRef: "vault:1",
    bankFingerprint: "fp1",
    feeChangeReason: null,
    bandOverrideReason: null,
    ...overrides,
  };
}

function run(overrides: Partial<RunInput> = {}) {
  const contractors = overrides.contractors ?? [contractor()];
  return computeRun({
    period: OCT_1,
    contractors,
    bands: SEED_PAY_BANDS,
    attendance: contractors.map((c) => ({ contractorId: c.id, daysAbsent: 0 })),
    attendanceConfirmed: true,
    reimbursements: [],
    adjustments: [],
    prior: [],
    ...overrides,
  });
}

describe("money", () => {
  it("parses pesos into centavos", () => {
    expect(pesos("18,000")).toBe(1_800_000);
    expect(pesos("818.18")).toBe(81_818);
    expect(pesos(0.1)).toBe(10);
    expect(() => pesos("12.345")).toThrow();
  });
});

describe("daily rate and absences (monthly ÷ 22)", () => {
  it.each([
    [18000, 81_818],
    [20000, 90_909],
    [25000, 113_636],
    [26000, 118_182],
    [30000, 136_364],
    [35000, 159_091],
    [37000, 168_182],
    [40000, 181_818],
    [45000, 204_545],
  ])("₱%i/mo → spec daily rate", (monthly, expected) => {
    expect(dailyRate(pesos(monthly))).toBe(expected);
  });

  it("rounds the deduction once, not per day", () => {
    // 3 days × 18000/22 = 2454.5454… → 2454.55 (per-day rounding would give 2454.54)
    expect(absenceDeduction(pesos(18000), 3)).toBe(245_455);
    expect(absenceDeduction(pesos(18000), 0.5)).toBe(40_909);
  });

  it("rejects anything but half-day steps", () => {
    expect(() => absenceDeduction(pesos(18000), 0.25)).toThrow();
    expect(() => absenceDeduction(pesos(18000), -1)).toThrow();
  });
});

describe("computeRun", () => {
  it("pays half the monthly fee with no absences", () => {
    const r = run();
    expect(r.lines[0].net).toBe(pesos(9000));
    expect(r.blockers).toEqual([]);
  });

  it("applies the full formula", () => {
    const r = run({
      contractors: [contractor({ payRole: "tech_manager", monthlyFee: pesos(45000) })],
      attendance: [{ contractorId: "c1", daysAbsent: 1.5 }],
      reimbursements: [
        { id: "r1", contractorId: "c1", category: "transport", amount: pesos(1200), receiptUrl: "s3://r1" },
        { id: "r2", contractorId: "c1", category: "meal", amount: pesos(500), receiptUrl: null },
      ],
      adjustments: [
        { id: "a1", contractorId: "c1", kind: "advance", amount: pesos(2000), reason: "Cash advance Oct 3" },
        { id: "a2", contractorId: "c1", kind: "owner_adjustment", amount: pesos(100), reason: "Rounding fix" },
      ],
    });
    const line = r.lines[0];
    // 22500 − 1.5 × 45000/22 (3068.18) + 1200 − 2000 + 100
    expect(line.absenceDeduction).toBe(306_818);
    expect(line.net).toBe(pesos(22500) - 306_818 + pesos(1200) - pesos(2000) + pesos(100));
    expect(line.excludedReimbursements).toBe(pesos(500));
    expect(line.flags.map((f) => f.code)).toEqual(
      expect.arrayContaining(["receipt_missing", "classification_risk"]),
    );
    expect(r.blockers).toEqual([]);
  });

  it("blocks approval until attendance is confirmed", () => {
    expect(run({ attendanceConfirmed: false }).blockers).toContain("Attendance not confirmed.");
    expect(run({ attendance: [] }).blockers[0]).toMatch(/No attendance entered/);
  });

  it("blocks a fee outside the band unless the owner overrides it", () => {
    const outside = contractor({ payRole: "it_tier_2", monthlyFee: pesos(25500) });
    expect(run({ contractors: [outside] }).blockers[0]).toMatch(/outside the IT Tier 2 band/);

    const overridden = { ...outside, bandOverrideReason: "Approved retention raise" };
    const r = run({ contractors: [overridden] });
    expect(r.blockers).toEqual([]);
    expect(r.lines[0].flags[0]).toMatchObject({ code: "fee_outside_band", severity: "warn" });
  });

  it("allows the CSM / Tier 3 overlap at ₱30k", () => {
    expect(run({ contractors: [contractor({ payRole: "csm", monthlyFee: pesos(30000) })] }).blockers).toEqual([]);
    expect(run({ contractors: [contractor({ payRole: "it_tier_3", monthlyFee: pesos(30000) })] }).blockers).toEqual([]);
  });

  it("blocks a fee change with no reason and warns on a >10% net swing", () => {
    const c = contractor({ payRole: "it_tier_2", monthlyFee: pesos(25000) });
    const prior = [{ contractorId: "c1", monthlyFee: pesos(20000), net: pesos(10000), bankFingerprint: "fp1" }];
    const r = run({ contractors: [c], prior });
    const codes = r.lines[0].flags.map((f) => f.code);
    expect(codes).toContain("fee_changed_no_reason");
    expect(codes).toContain("net_change_over_10pct");

    const withReason = run({ contractors: [{ ...c, feeChangeReason: "Promoted Nov 2026" }], prior });
    expect(withReason.blockers).toEqual([]);
  });

  it("flags bank problems", () => {
    expect(run({ contractors: [contractor({ bankRef: null, bankFingerprint: null })] }).blockers[0]).toMatch(
      /No bank account/,
    );

    const prior = [{ contractorId: "c1", monthlyFee: pesos(18000), net: pesos(9000), bankFingerprint: "old" }];
    expect(run({ prior }).lines[0].flags.map((f) => f.code)).toContain("bank_changed");

    const dup = run({ contractors: [contractor(), contractor({ id: "c2", name: "Ben" })] });
    expect(dup.blockers.filter((b) => b.includes("Same bank account"))).toHaveLength(2);
  });

  it("blocks negative net and impossible absences", () => {
    const r = run({
      adjustments: [{ id: "a1", contractorId: "c1", kind: "deduction", amount: pesos(9500), reason: "Device loss" }],
    });
    expect(r.blockers.some((b) => b.includes("Net is"))).toBe(true);
    expect(run({ attendance: [{ contractorId: "c1", daysAbsent: 12 }] }).blockers.some((b) => b.includes("12 days"))).toBe(
      true,
    );
  });

  it("includes contracts active in the period, without proration", () => {
    const r = run({
      contractors: [
        contractor({ id: "new", name: "New", contractStart: "2026-10-10", bankFingerprint: "a" }),
        contractor({ id: "gone", name: "Gone", contractEnd: "2026-09-30", bankFingerprint: "b" }),
        contractor({ id: "ending", name: "Ending", contractEnd: "2026-10-05", bankFingerprint: "c" }),
      ],
    });
    expect(r.lines.map((l) => l.name)).toEqual(["New", "Ending"]);
    expect(r.lines[0].net).toBe(pesos(9000));
    expect(r.lines[0].flags.map((f) => f.code)).toContain("contract_new");
    expect(r.lines[1].flags.map((f) => f.code)).toContain("contract_ended");
  });

  it("requires a reason on every adjustment", () => {
    expect(() =>
      run({ adjustments: [{ id: "a1", contractorId: "c1", kind: "advance", amount: pesos(100), reason: " " }] }),
    ).toThrow(/reason/);
  });
});

describe("periods", () => {
  it("uses 15th and last-day cut-offs", () => {
    expect(periodContaining("2026-10-15")).toEqual({ start: "2026-10-01", end: "2026-10-15" });
    expect(periodContaining("2027-02-20")).toEqual({ start: "2027-02-16", end: "2027-02-28" });
    expect(periodContaining("2028-02-20").end).toBe("2028-02-29");
    expect(nextPeriod({ start: "2026-12-16", end: "2026-12-31" })).toEqual({ start: "2027-01-01", end: "2027-01-15" });
  });
});

describe("exports", () => {
  it("writes a register with a total and no bank numbers", () => {
    const csv = registerCsv(run({ contractors: [contractor(), contractor({ id: "c2", name: "Ben, Jr.", bankFingerprint: "fp2" })] }));
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/^"Ben, Jr\.",18000\.00,9000\.00/);
    expect(lines[3]).toMatch(/^TOTAL,.*,18000\.00,$/);
    expect(csv).not.toContain("vault:");
  });

  it("refuses to produce a UnionBank file without the real template", () => {
    expect(() => unionBankFile([])).toThrow(/template not configured/);
  });

  it("writes a readable statement", () => {
    const r = run({ attendance: [{ contractorId: "c1", daysAbsent: 1 }] });
    const text = statementText(r.lines[0], "Oct 1–15, 2026");
    expect(text).toContain("Less absences (1 × ₱818.18)   -₱818.18");
    expect(text).toContain("Net payout   ₱8,181.82");
  });
});
