// Brand rules enforced by software (spec v0.3 §3): banned words, emoji rule per channel,
// unfilled [confirm] placeholders, numeric claims with no cleared Proof Bank entry, length.

export type Channel = "linkedin_cody" | "ph_social" | "client_comms";

export interface ChannelRules {
  label: string;
  emojisAllowed: boolean;
  maxChars: number;
}

export const CHANNEL_RULES: Record<Channel, ChannelRules> = {
  linkedin_cody: { label: "LinkedIn (Cody)", emojisAllowed: false, maxChars: 3000 },
  ph_social: { label: "PH Facebook / Instagram", emojisAllowed: true, maxChars: 2200 },
  client_comms: { label: "Client email", emojisAllowed: false, maxChars: 5000 },
};

/** Spec avoid list. Each entry matches its spaced, hyphenated and joined spellings. */
export const BANNED_TERMS = [
  "guru",
  "game-changer",
  "hustle",
  "grind",
  "passive income",
  "life-changing",
  "synergy",
  "best practices",
];

/** Facts about Optogrow's own offers that may appear without a Proof Bank citation. */
export const BRAND_FACTS = ["30-minute", "30 minute", "24/7", "7fa"];

export type Clearance = "public" | "anonymized" | "needs_signoff";

export interface ProofEntry {
  id: string;
  niche: string;
  situation: string;
  /** The figure exactly as it may be quoted, e.g. "38%" or "11 hours a week". */
  number: string;
  result: string;
  clearance: Clearance;
}

export type IssueCode =
  | "banned_word"
  | "emoji_not_allowed"
  | "placeholder"
  | "uncited_claim"
  | "proof_not_cleared"
  | "too_long"
  | "empty";

export interface LintIssue {
  code: IssueCode;
  severity: "block" | "warn";
  message: string;
  match?: string;
}

export interface LintResult {
  ok: boolean;
  issues: LintIssue[];
}

export interface LintInput {
  channel: Channel;
  copy: string;
  /** Proof Bank entries this item cites. */
  proof: ProofEntry[];
}

const EMOJI = /\p{Extended_Pictographic}/u;
const PLACEHOLDER = /\[confirm[^\]]*\]/gi;
// A figure that reads as a result: percentages, multipliers, money, or a count of a business unit.
const CLAIM =
  /(?:[₱$]\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?|\b(?:PHP|USD)\s?\d[\d,]*(?:\.\d+)?\s?[kKmM]?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent\b|x\b|×)|\b\d[\d,]*(?:\.\d+)?\s?(?:hours?|hrs?|days?|weeks?|months?|leads?|clients?|calls?|bookings?|sales|customers?|appointments?)\b)/gi;

function bannedPattern(term: string): RegExp {
  // A plural term also matches its singular ("best practice").
  const stem = term.endsWith("s") && term.includes(" ") ? term.slice(0, -1) : term;
  const parts = stem.split(/[\s-]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const tail = stem === term ? "" : "s?";
  return new RegExp(`\\b${parts.join("[\\s-]?")}${tail}\\b`, "gi");
}

const normalize = (s: string) => s.toLowerCase().replace(/[\s,]/g, "").replace(/percent/g, "%").replace(/×/g, "x");

export function findClaims(copy: string): string[] {
  const out: string[] = [];
  for (const m of copy.matchAll(CLAIM)) {
    const claim = m[0].trim();
    const at = m.index ?? 0;
    const around = copy.slice(Math.max(0, at - 1), at + claim.length + 8).toLowerCase();
    if (BRAND_FACTS.some((f) => around.includes(f))) continue;
    out.push(claim);
  }
  return out;
}

export function lintContent({ channel, copy, proof }: LintInput): LintResult {
  const rules = CHANNEL_RULES[channel];
  const issues: LintIssue[] = [];

  if (!copy.trim()) issues.push({ code: "empty", severity: "block", message: "Copy is empty." });

  for (const term of BANNED_TERMS) {
    for (const m of copy.matchAll(bannedPattern(term))) {
      issues.push({ code: "banned_word", severity: "block", message: `"${m[0]}" is on the avoid list.`, match: m[0] });
    }
  }

  if (!rules.emojisAllowed) {
    const m = copy.match(EMOJI);
    if (m) issues.push({ code: "emoji_not_allowed", severity: "block", message: `${rules.label} posts use zero emojis.`, match: m[0] });
  }

  for (const m of copy.matchAll(PLACEHOLDER)) {
    issues.push({ code: "placeholder", severity: "block", message: `Unfilled placeholder ${m[0]}.`, match: m[0] });
  }

  const cleared = proof.filter((p) => p.clearance !== "needs_signoff");
  for (const p of proof) {
    if (p.clearance === "needs_signoff") {
      issues.push({
        code: "proof_not_cleared",
        severity: "block",
        message: `Proof "${p.situation}" still needs client sign-off.`,
      });
    }
  }
  // A figure is backed when it is the entry's number or appears in its quotable result.
  const citedFigures = cleared.map((p) => normalize(p.number));
  const citedResults = cleared.map((p) => normalize(p.result));
  for (const claim of findClaims(copy)) {
    const n = normalize(claim);
    const backed = citedFigures.some((f) => f.includes(n) || n.includes(f)) || citedResults.some((r) => r.includes(n));
    if (!backed) {
      issues.push({
        code: "uncited_claim",
        severity: "block",
        message: `"${claim}" isn't backed by a cleared Proof Bank entry on this post.`,
        match: claim,
      });
    }
  }

  if (copy.length > rules.maxChars) {
    issues.push({
      code: "too_long",
      severity: "block",
      message: `${copy.length} characters; ${rules.label} allows ${rules.maxChars}.`,
    });
  }

  return { ok: !issues.some((i) => i.severity === "block"), issues };
}
