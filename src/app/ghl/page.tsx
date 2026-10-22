import { requireRole } from "@/lib/auth";
import { ghlConfig } from "@/lib/env";
import { createGhlClient, GhlError } from "@/lib/ghl/client";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function check() {
  const cfg = ghlConfig();
  if (!cfg.configured) return { ok: false as const, message: "GHL_PRIVATE_TOKEN or GHL_LOCATION_ID is not set." };
  try {
    const ghl = createGhlClient();
    const { location } = await ghl.getLocation();
    const { pipelines } = await ghl.listPipelines();
    return { ok: true as const, location, pipelines };
  } catch (e) {
    const message = e instanceof GhlError && e.status === 401 ? "GHL rejected the token (401). Check the private integration and its scopes." : (e as Error).message;
    return { ok: false as const, message };
  }
}

export default async function GhlPage() {
  await requireRole("owner");
  const result = await check();
  const db = await createClient();
  const { data: events } = await db
    .from("ghl_event")
    .select("id, event_type, received_at")
    .order("received_at", { ascending: false })
    .limit(10);
  const webhookConfigured = Boolean(ghlConfig().webhookSecret);

  return (
    <>
      <h1>GHL connection</h1>
      <p className="sub">Sub-account: Optogrow Operations Management Solutions</p>
      {result.ok ? (
        <div className="notice">
          Connected to <strong>{result.location.name}</strong> ({result.location.id}).
        </div>
      ) : (
        <div className="notice block">Not connected: {result.message}</div>
      )}

      {result.ok && (
        <>
          <h2>Pipelines</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pipeline</th><th>Stages</th></tr></thead>
              <tbody>
                {result.pipelines.map((p) => (
                  <tr key={p.id}><td>{p.name}</td><td>{p.stages.map((s) => s.name).join(" → ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Inbound webhooks</h2>
      <p>
        In GHL workflows, add a Webhook action pointing at <code>/api/ghl/webhook</code> with the header{" "}
        <code>x-systemsflow-secret</code>.{" "}
        {webhookConfigured ? <span className="badge ok">Secret set</span> : <span className="badge block">GHL_WEBHOOK_SECRET missing</span>}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Received</th><th>Type</th></tr></thead>
          <tbody>
            {(events ?? []).map((e) => (
              <tr key={e.id}><td>{new Date(e.received_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td>{e.event_type ?? "—"}</td></tr>
            ))}
            {!events?.length && <tr><td colSpan={2}>No events received yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
