import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPeso, toDecimal } from "@/lib/payouts";
import { addContractor, setBank, updateContractor } from "./actions";

export const dynamic = "force-dynamic";

const ROLES = [
  ["it_tier_1", "IT Tier 1"],
  ["it_tier_2", "IT Tier 2"],
  ["it_tier_3", "IT Tier 3"],
  ["csm", "CSM"],
  ["tech_lead", "Tech Lead"],
  ["tech_manager", "Tech Manager"],
] as const;

export default async function ContractorsPage() {
  await requireRole("owner", "finance");
  const db = await createClient();
  const [{ data: contractors, error }, { data: banks }, { data: bands }] = await Promise.all([
    db.from("contractor").select("*").order("name"),
    db.from("contractor_bank").select("contractor_id, account_name, account_last4"),
    db.from("pay_band").select("*").order("min_monthly"),
  ]);
  const bankBy = new Map((banks ?? []).map((b) => [b.contractor_id, b]));

  return (
    <>
      <h1>Contractors</h1>
      <p className="sub">Monthly fee must sit inside the role's pay band. Bank numbers are stored in the vault; only the last 4 digits show here.</p>
      {error && <div className="notice block">{error.message}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Role & fee</th><th>Contract</th><th>Bank (UnionBank)</th></tr>
          </thead>
          <tbody>
            {(contractors ?? []).map((c) => {
              const bank = bankBy.get(c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="sub" style={{ margin: 0, fontSize: 12 }}>{c.email}</div>
                  </td>
                  <td>
                    <form action={updateContractor.bind(null, c.id)} style={{ display: "grid", gap: 6 }}>
                      <select name="pay_role" defaultValue={c.pay_role}>
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input name="monthly_fee" defaultValue={toDecimal(Number(c.monthly_fee))} inputMode="decimal" />
                      <input name="fee_change_reason" placeholder="Reason if fee changed" />
                      <input name="band_override_reason" placeholder="Owner: band override reason" defaultValue={c.band_override_reason ?? ""} />
                      <input name="contract_end" type="date" defaultValue={c.contract_end ?? ""} title="Contract end" />
                      <button className="btn" type="submit">Save</button>
                    </form>
                  </td>
                  <td>{c.contract_start} → {c.contract_end ?? "open"}</td>
                  <td>
                    {bank ? <div>{bank.account_name} · ••••{bank.account_last4}</div> : <span className="badge block">Missing</span>}
                    <form action={setBank.bind(null, c.id)} style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      <input name="account_name" placeholder="Account name" defaultValue={bank?.account_name ?? c.name} required />
                      <input name="account_number" placeholder="Account number" inputMode="numeric" autoComplete="off" required />
                      <button className="btn" type="submit">{bank ? "Replace" : "Save"} bank details</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {contractors?.length === 0 && <tr><td colSpan={4}>No contractors yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Add contractor</h2>
      <form action={addContractor} className="form card">
        <label>Name<input name="name" required /></label>
        <label>Email (for statements)<input name="email" type="email" /></label>
        <label>
          Pay role
          <select name="pay_role" required>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label>Monthly fee (₱)<input name="monthly_fee" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" /></label>
        <label>Contract start<input name="contract_start" type="date" required /></label>
        <label>Contract end<input name="contract_end" type="date" /></label>
        <button className="btn primary" type="submit">Add</button>
      </form>

      <h2>Pay bands</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Role</th><th className="num">Min / mo</th><th className="num">Max / mo</th><th>Effective</th></tr></thead>
          <tbody>
            {(bands ?? []).map((b) => (
              <tr key={b.id}>
                <td>{b.label}</td>
                <td className="num">{formatPeso(Number(b.min_monthly))}</td>
                <td className="num">{formatPeso(Number(b.max_monthly))}</td>
                <td>{b.effective_from}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
