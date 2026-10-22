import { ghlConfig, supabaseConfig } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const sb = supabaseConfig();
  const ghl = ghlConfig();
  const rows: [string, boolean, string][] = [
    ["SUPABASE_URL", Boolean(sb.url), "Supabase → Project Settings → API → Project URL"],
    ["SUPABASE_ANON_KEY", Boolean(sb.anonKey), "Supabase → Project Settings → API → anon public key"],
    ["SUPABASE_SERVICE_ROLE_KEY", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), "Same page → service_role key (server only)"],
    ["GHL_PRIVATE_TOKEN", Boolean(ghl.token), "GHL sub-account → Settings → Private Integrations"],
    ["GHL_LOCATION_ID", Boolean(ghl.locationId), "GHL sub-account → Settings → Business Profile → Location ID"],
    ["GHL_WEBHOOK_SECRET", Boolean(ghl.webhookSecret), "Any long random string; also set as a header in GHL webhooks"],
  ];
  return (
    <>
      <h1>Setup</h1>
      <p className="sub">The console needs these settings before anyone can sign in.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Setting</th><th>Status</th><th>Where to find it</th></tr>
          </thead>
          <tbody>
            {rows.map(([name, ok, where]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td><span className={`badge ${ok ? "ok" : "block"}`}>{ok ? "Set" : "Missing"}</span></td>
                <td>{where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
