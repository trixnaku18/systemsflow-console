import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser, hasRole, isPayoutAdmin } from "@/lib/auth";
import { supabaseConfig } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = { title: "SystemsFlow Console", description: "Optogrow operations console" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = supabaseConfig().configured ? await getSessionUser() : null;
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              Systems<span>Flow</span>
            </div>
            {user && (
              <nav>
                <Link href="/">Today</Link>
                {(isPayoutAdmin(user) || hasRole(user, "team_lead")) && <Link href="/payouts">Payouts</Link>}
                {isPayoutAdmin(user) && <Link href="/contractors">Contractors</Link>}
                {hasRole(user, "owner") && <Link href="/ghl">GHL</Link>}
              </nav>
            )}
            {user && <div className="who">{user.email}</div>}
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
