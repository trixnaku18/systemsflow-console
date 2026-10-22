import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function sendLink(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/");
  const origin = (await headers()).get("origin") ?? "";
  const db = await createClient();
  const { error } = await db.auth.signInWithOtp({
    email,
    // Accounts are created by the Owner in Supabase; the login page never creates users.
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  redirect(`/login?${error ? `error=${encodeURIComponent(error.message)}` : "sent=1"}`);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; next?: string }>;
}) {
  const { sent, error, next } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "48px auto" }}>
      <h1>Sign in</h1>
      <p className="sub">We'll email you a sign-in link.</p>
      {sent && <div className="notice">Check your inbox for the sign-in link.</div>}
      {error && <div className="notice block">{error}</div>}
      <form action={sendLink} style={{ display: "grid", gap: 12 }}>
        <input type="hidden" name="next" value={next ?? "/"} />
        <label>
          Work email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <button className="btn primary" type="submit">Email me a link</button>
      </form>
    </div>
  );
}
