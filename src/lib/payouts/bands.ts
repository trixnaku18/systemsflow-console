import { pesos } from "./money";
import type { PayBand, PayRole } from "./types";

// Seed bands from spec v0.3 §6.4. The database copy is the source of truth once loaded.
export const SEED_PAY_BANDS: PayBand[] = [
  { role: "it_tier_1", label: "IT Tier 1", minMonthly: pesos(18000), maxMonthly: pesos(18000), effectiveFrom: "2026-10-01" },
  { role: "it_tier_2", label: "IT Tier 2", minMonthly: pesos(20000), maxMonthly: pesos(25000), effectiveFrom: "2026-10-01" },
  { role: "it_tier_3", label: "IT Tier 3", minMonthly: pesos(26000), maxMonthly: pesos(30000), effectiveFrom: "2026-10-01" },
  { role: "csm", label: "CSM", minMonthly: pesos(30000), maxMonthly: pesos(35000), effectiveFrom: "2026-10-01" },
  { role: "tech_lead", label: "Tech Lead", minMonthly: pesos(37000), maxMonthly: pesos(40000), effectiveFrom: "2026-10-01" },
  { role: "tech_manager", label: "Tech Manager", minMonthly: pesos(45000), maxMonthly: pesos(45000), effectiveFrom: "2026-10-01" },
];

/** The band in force for a role on a date: the latest effectiveFrom on or before it. */
export function bandFor(bands: PayBand[], role: PayRole, onDate: string): PayBand | null {
  let found: PayBand | null = null;
  for (const band of bands) {
    if (band.role !== role || band.effectiveFrom > onDate) continue;
    if (!found || band.effectiveFrom > found.effectiveFrom) found = band;
  }
  return found;
}
