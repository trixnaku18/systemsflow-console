"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { pesos } from "@/lib/payouts";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function addContractor(formData: FormData) {
  await requireRole("owner", "finance");
  const db = await createClient();
  const { error } = await db.from("contractor").insert({
    name: text(formData, "name"),
    email: text(formData, "email") || null,
    pay_role: text(formData, "pay_role"),
    monthly_fee: pesos(text(formData, "monthly_fee")),
    contract_start: text(formData, "contract_start"),
    contract_end: text(formData, "contract_end") || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/contractors");
}

export async function updateContractor(id: string, formData: FormData) {
  await requireRole("owner", "finance");
  const db = await createClient();
  const { data: current } = await db.from("contractor").select("monthly_fee").eq("id", id).single();
  const fee = pesos(text(formData, "monthly_fee"));
  const reason = text(formData, "fee_change_reason");
  if (current && Number(current.monthly_fee) !== fee && !reason) {
    throw new Error("Give a reason for the fee change.");
  }
  const update: Record<string, unknown> = {
    pay_role: text(formData, "pay_role"),
    monthly_fee: fee,
    contract_end: text(formData, "contract_end") || null,
    updated_at: new Date().toISOString(),
  };
  if (reason) update.fee_change_reason = reason;
  const override = text(formData, "band_override_reason");
  if (override) {
    await requireRole("owner");
    update.band_override_reason = override;
  }
  const { error } = await db.from("contractor").update(update).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/contractors");
}

export async function setBank(id: string, formData: FormData) {
  await requireRole("owner", "finance");
  const db = await createClient();
  const { error } = await db.rpc("set_contractor_bank", {
    p_contractor: id,
    p_account_name: text(formData, "account_name"),
    p_account_number: text(formData, "account_number"),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/contractors");
}
