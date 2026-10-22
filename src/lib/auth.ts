import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "owner" | "finance" | "closer" | "content_operator" | "team_lead" | "viewer";

export interface SessionUser {
  id: string;
  email: string | null;
  roles: AppRole[];
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  return { id: user.id, email: user.email ?? null, roles: (data ?? []).map((r) => r.role as AppRole) };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export function hasRole(user: SessionUser, ...roles: AppRole[]) {
  return roles.some((r) => user.roles.includes(r));
}

export const isPayoutAdmin = (user: SessionUser) => hasRole(user, "owner", "finance");
export const canEnterAttendance = (user: SessionUser) => hasRole(user, "owner", "team_lead");

export async function requireRole(...roles: AppRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user, ...roles)) redirect("/?denied=1");
  return user;
}
