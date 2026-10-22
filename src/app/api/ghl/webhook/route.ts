import { NextResponse } from "next/server";
import { ghlConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEvent, verifySharedSecret, WEBHOOK_SECRET_HEADER } from "@/lib/ghl/webhook";

export async function POST(request: Request) {
  const { webhookSecret, locationId } = ghlConfig();
  if (!webhookSecret) return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  if (!verifySharedSecret(request.headers.get(WEBHOOK_SECRET_HEADER), webhookSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const event = normalizeEvent(payload, raw);
  if (event.locationId && locationId && event.locationId !== locationId) {
    return NextResponse.json({ error: "Wrong sub-account" }, { status: 403 });
  }

  const db = createAdminClient();
  const { error } = await db.from("ghl_event").upsert(
    { dedupe_key: event.dedupeKey, event_type: event.eventType, location_id: event.locationId, payload },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (error) return NextResponse.json({ error: "Could not store event" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
