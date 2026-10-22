import { createHash, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_HEADER = "x-systemsflow-secret";

/** Constant-time comparison of the shared secret GHL workflow webhooks send as a custom header. */
export function verifySharedSecret(received: string | null, expected: string): boolean {
  if (!expected || !received) return false;
  const a = createHash("sha256").update(received).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface NormalizedEvent {
  dedupeKey: string;
  eventType: string | null;
  locationId: string | null;
}

/** Pull the fields we index on. Payload shapes differ by trigger, so everything else stays raw. */
export function normalizeEvent(payload: Record<string, unknown>, rawBody: string): NormalizedEvent {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const location = payload.location as { id?: string } | undefined;
  const eventType = str(payload.type) ?? str(payload.event) ?? str(payload.workflow_trigger) ?? null;
  const locationId = str(payload.locationId) ?? str(location?.id) ?? str(payload.location_id) ?? null;
  const id = str(payload.webhookId) ?? str(payload.id) ?? str(payload.eventId);
  const dedupeKey = id ? `id:${id}` : `sha256:${createHash("sha256").update(rawBody).digest("hex")}`;
  return { dedupeKey, eventType, locationId };
}
