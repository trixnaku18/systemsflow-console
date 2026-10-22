import type { Period } from "./types";

/** Semi-monthly cut-offs: the 1st–15th and the 16th–last day of the month. */
export function periodContaining(isoDate: string): Period {
  const [y, m, d] = isoDate.split("-").map(Number);
  const month = `${y}-${String(m).padStart(2, "0")}`;
  if (d <= 15) return { start: `${month}-01`, end: `${month}-15` };
  return { start: `${month}-16`, end: `${month}-${String(lastDay(y, m)).padStart(2, "0")}` };
}

export function nextPeriod(period: Period): Period {
  const [y, m, d] = period.end.split("-").map(Number);
  if (d === 15) return periodContaining(`${y}-${String(m).padStart(2, "0")}-16`);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return periodContaining(`${ny}-${String(nm).padStart(2, "0")}-01`);
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
