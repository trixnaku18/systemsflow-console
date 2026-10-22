// All amounts are integer centavos. Never do payout math in floating-point pesos.

export type Centavos = number;

export function pesos(amount: number | string): Centavos {
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.replace(/,/g, ""));
  if (!match) throw new Error(`Invalid peso amount: ${amount}`);
  const [, sign, whole, frac = ""] = match;
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign ? -value : value;
}

/** Divide two non-negative integers, rounding half up. */
export function roundDiv(numerator: number, denominator: number): number {
  if (numerator < 0 || denominator <= 0) {
    throw new Error("roundDiv expects a non-negative numerator and positive denominator");
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

export function formatPeso(value: Centavos): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100).toLocaleString("en-PH");
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}₱${whole}.${frac}`;
}

/** Plain decimal string for files, e.g. 9000.00 */
export function toDecimal(value: Centavos): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
