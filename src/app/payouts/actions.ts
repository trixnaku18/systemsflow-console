"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { todayManila } from "@/lib/dates";
import { computeRun, periodContaining, pesos } from "@/lib/payouts";
import { lineToRow, loadRunInput, type RunRow } from "@/lib/payouts/repo";

function fail(message: string): never {
  throw new Error(message);
}

export async function openCurrentRun() {
  await requireRole("owner", "finance");
  const db = await createClient();
  const period = periodContaining(todayManila());
  const { data: existing } = await db.from("payout_run").select("id").eq("period_start", period.start).maybeSingle();
  if (existing) redirect(`/payouts/${existing.id}`);
  const { data, error } = await db
    .from("payout_run")
    .insert({ period_start: period.start, period_end: period.end })
    .select("id")
    .single();
  if (error) fail(error.message);
  redirect(`/payouts/${data.id}`);
}

export async function saveAttendance(runId: string, formData: FormData) {
  await requireRole("owner", "team_lead");
  const db = await createClient();
  const rows = [...formData.entries()]
    .filter(([k]) => k.startsWith("days:"))
    .map(([k, v]) => ({
      run_id: runId,
      contractor_id: k.slice(5),
      days_absent: Number(v || 0),
      note: (formData.get(`note:${k.slice(5)}`) as string) || null,
    }));
  if (rows.length) {
    const { error } = await db.from("attendance").upsert(rows, { onConflict: "run_id,contractor_id" });
    if (error) fail(error.message);
  }
  revalidatePath(`/payouts/${runId}`);
  revalidatePath(`/payouts/${runId}/attendance`);
}

export async function confirmAttendance(runId: string) {
  await requireRole("owner", "team_lead");
  const db = await createClient();
  const { error } = await db.rpc("confirm_attendance", { p_run: runId });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
  redirect(`/payouts/${runId}/attendance?confirmed=1`);
}

export async function addReimbursement(runId: string, formData: FormData) {
  await requireRole("owner", "finance");
  const db = await createClient();
  const { error } = await db.from("reimbursement").insert({
    run_id: runId,
    contractor_id: formData.get("contractor_id"),
    category: formData.get("category"),
    amount: pesos(String(formData.get("amount"))),
    receipt_path: (formData.get("receipt") as string) || null,
    description: (formData.get("description") as string) || null,
  });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
}

export async function addAdjustment(runId: string, formData: FormData) {
  await requireRole("owner", "finance");
  const kind = String(formData.get("kind"));
  if (kind === "owner_adjustment") await requireRole("owner");
  const db = await createClient();
  const { error } = await db.from("adjustment").insert({
    run_id: runId,
    contractor_id: formData.get("contractor_id"),
    kind,
    amount: pesos(String(formData.get("amount"))),
    reason: String(formData.get("reason") ?? ""),
  });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
}

/** Freeze the computed lines and put the run in the Owner's approval inbox. */
export async function sendToReview(runId: string) {
  await requireRole("owner", "finance");
  const db = await createClient();
  const { data: run, error } = await db.from("payout_run").select("*").eq("id", runId).single<RunRow>();
  if (error) fail(error.message);
  if (run.status !== "attendance_confirmed" && run.status !== "review") fail("Attendance must be confirmed first.");

  const input = await loadRunInput(db, run);
  const result = computeRun(input);
  const fingerprint = new Map(input.contractors.map((c) => [c.id, c.bankFingerprint]));

  await db.from("payout_line").delete().eq("run_id", runId);
  const { error: insertError } = await db
    .from("payout_line")
    .insert(result.lines.map((l) => lineToRow(runId, l, fingerprint.get(l.contractorId) ?? null)));
  if (insertError) fail(insertError.message);

  const { error: statusError } = await db.from("payout_run").update({ status: "review" }).eq("id", runId);
  if (statusError) fail(statusError.message);
  const { data: pending } = await db
    .from("approval")
    .select("id")
    .eq("type", "payout_run")
    .eq("ref_id", runId)
    .is("decision", null)
    .maybeSingle();
  if (!pending) await db.from("approval").insert({ type: "payout_run", ref_id: runId, approver_role: "owner" });
  revalidatePath(`/payouts/${runId}`);
}

export async function approveRun(runId: string) {
  await requireRole("owner");
  const db = await createClient();
  const { error } = await db.rpc("approve_run", { p_run: runId });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
}

export async function returnRun(runId: string, formData: FormData) {
  await requireRole("owner");
  const comment = String(formData.get("comment") ?? "").trim();
  if (!comment) fail("Say why the run is being returned.");
  const db = await createClient();
  const { error } = await db.rpc("return_run", { p_run: runId, p_comment: comment });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
}

export async function markPaid(runId: string) {
  await requireRole("owner");
  const db = await createClient();
  const { error } = await db.rpc("mark_run_paid", { p_run: runId });
  if (error) fail(error.message);
  revalidatePath(`/payouts/${runId}`);
}
