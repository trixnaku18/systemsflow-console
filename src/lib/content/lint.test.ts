import { describe, expect, it } from "vitest";
import { findClaims, lintContent, type ProofEntry } from "./lint";

const proof: ProofEntry = {
  id: "p1",
  niche: "HVAC",
  situation: "Missed-call text-back for a 6-truck HVAC shop",
  number: "38%",
  result: "38% more booked jobs in 60 days",
  clearance: "anonymized",
};

const codes = (r: ReturnType<typeof lintContent>) => r.issues.map((i) => i.code);

describe("lintContent", () => {
  it("passes clean copy", () => {
    const r = lintContent({
      channel: "linkedin_cody",
      copy: "Most agencies automate a mess. Fix the operation first, then the tools.",
      proof: [],
    });
    expect(r).toEqual({ ok: true, issues: [] });
  });

  it("blocks avoid-list words in any spelling", () => {
    for (const copy of ["A real game changer.", "Gamechanger.", "Follow best practice.", "SYNERGY", "Grind every day"]) {
      expect(codes(lintContent({ channel: "ph_social", copy, proof: [] }))).toContain("banned_word");
    }
    expect(codes(lintContent({ channel: "ph_social", copy: "Grinding coffee", proof: [] }))).not.toContain("banned_word");
  });

  it("enforces the LinkedIn zero-emoji rule but allows emojis on PH social", () => {
    expect(codes(lintContent({ channel: "linkedin_cody", copy: "Systems first 🚀", proof: [] }))).toContain(
      "emoji_not_allowed",
    );
    expect(lintContent({ channel: "ph_social", copy: "Systems muna 🚀", proof: [] }).ok).toBe(true);
  });

  it("blocks unfilled [confirm] placeholders", () => {
    const r = lintContent({ channel: "ph_social", copy: "Results for [confirm client name].", proof: [] });
    expect(r.ok).toBe(false);
    expect(r.issues[0].match).toBe("[confirm client name]");
  });

  it("requires a cleared Proof Bank entry for every figure", () => {
    const copy = "One HVAC shop booked 38% more jobs after fixing missed calls.";
    expect(codes(lintContent({ channel: "linkedin_cody", copy, proof: [] }))).toEqual(["uncited_claim"]);
    expect(lintContent({ channel: "linkedin_cody", copy, proof: [proof] }).ok).toBe(true);
    expect(codes(lintContent({ channel: "linkedin_cody", copy, proof: [{ ...proof, clearance: "needs_signoff" }] }))).toEqual(
      expect.arrayContaining(["proof_not_cleared", "uncited_claim"]),
    );
  });

  it("accepts any figure that appears in the cited result", () => {
    const copy = "One HVAC shop booked 38% more jobs in 60 days.";
    expect(lintContent({ channel: "linkedin_cody", copy, proof: [proof] }).ok).toBe(true);
    expect(codes(lintContent({ channel: "linkedin_cody", copy: "38% more jobs in 90 days.", proof: [proof] }))).toEqual([
      "uncited_claim",
    ]);
  });

  it("finds money, multipliers and unit counts but not the offer's own facts", () => {
    expect(findClaims("Saved ₱45,000 and 12 hours a week, 3x faster, 40 leads.")).toEqual([
      "₱45,000",
      "12 hours",
      "3x",
      "40 leads",
    ]);
    expect(findClaims("Book a free 30-minute Systems Flow Diagnostic. Leads answered 24/7.")).toEqual([]);
    expect(findClaims("We opened in 2026.")).toEqual([]);
  });

  it("checks length per channel", () => {
    expect(codes(lintContent({ channel: "ph_social", copy: "a".repeat(2201), proof: [] }))).toContain("too_long");
  });
});
