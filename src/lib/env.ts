// Server-side configuration. Missing values are reported, never replaced with fakes.

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, anonKey, configured: Boolean(url && anonKey) };
}

export function ghlConfig() {
  const token = process.env.GHL_PRIVATE_TOKEN || "";
  const locationId = process.env.GHL_LOCATION_ID || "";
  const webhookSecret = process.env.GHL_WEBHOOK_SECRET || "";
  return { token, locationId, webhookSecret, configured: Boolean(token && locationId) };
}
