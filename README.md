# SystemsFlow Console

Optogrow's internal console (spec v0.3). This first slice ships:

- **M4 Contractor Payouts**: pay bands, semi-monthly runs (15th / last day), attendance entry by the Team Lead,
  receipted reimbursements, advances and deductions, anomaly flags, Owner approval, payout register,
  statements, and bank details kept in Supabase Vault.
- **Console skeleton**: email sign-in, roles, Today page, setup checklist.
- **GHL connection**: API v2 client, connection check page, and an inbound webhook endpoint.

AI never moves money: the app produces the bulk file; the founder uploads and releases it in the UnionBank portal.

## Payout math

```
base              = monthly fee / 2
daily rate        = monthly fee / 22
absence deduction = days absent × monthly fee / 22   (0.5-day steps, rounded once to the centavo)
net               = base − absence deduction + receipted reimbursements − advances − deductions ± owner adjustments
```

All amounts are integer centavos. No tax withholding (owner decision); `tax_config.enabled = false`.

## Not done yet

| Item | Waiting on |
|---|---|
| UnionBank bulk-upload file | The real template from the UnionBank RM / business portal. The download returns 501 until a formatter for it is added in `src/lib/payouts/exports.ts`. |
| Emailing statements | Choice of sender (GHL email or a mail provider). Statements can be copied from the Statements page. |
| Receipt uploads | Receipts are links for now; Supabase Storage upload comes next. |
| M1–M3 and the rest of M5 | PH client offers, Canva Brand Kit export. |

## Setup

1. **Supabase project**: create one, then apply `supabase/migrations/*.sql` in order (Supabase CLI `supabase db push`,
   or paste into the SQL editor).
2. **Vault key for bank fingerprints** (SQL editor, once):
   `select vault.create_secret('<long random string>', 'bank_fingerprint_key');`
3. **Users and roles**: invite each person under Authentication → Users (the login page never creates accounts), then:
   ```sql
   insert into public.user_roles (user_id, role) values ('<owner uuid>', 'owner'), ('<diego uuid>', 'team_lead');
   ```
   Link Diego's contractor record to his login so he can't enter his own attendance:
   `update public.contractor set user_id = '<diego uuid>' where name = 'Diego';`
4. **GHL private integration** in the *Optogrow Operations Management Solutions* sub-account with scopes
   `locations.readonly`, `contacts.readonly`, `contacts.write`, `opportunities.readonly`, `opportunities.write`.
5. **Environment variables** (see `.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GHL_PRIVATE_TOKEN`, `GHL_LOCATION_ID`, `GHL_WEBHOOK_SECRET`.
   `/setup` shows which are missing.
6. **GHL webhooks**: in a GHL workflow, add a Webhook action to `https://<console host>/api/ghl/webhook` with
   header `x-systemsflow-secret: <GHL_WEBHOOK_SECRET>`.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # payout engine + GHL client unit tests
npm run typecheck
PGHOST=... PGPORT=... PGUSER=postgres npm run test:db   # migrations + RLS checks on plain Postgres
```

`npm run test:db` uses `supabase/tests/local_auth_stub.sql` to stand in for Supabase's auth and vault schemas.
Never run that stub against a real project.

## Roles

| Role | Can |
|---|---|
| Owner | Everything; approves runs, exports the bank file, marks paid, band overrides |
| Finance | Contractors, bank details, reimbursements, deductions, sends runs to review |
| Team Lead | Attendance only (names, no fees or bank data); cannot enter their own |
| Closer, Content Operator, Viewer | Reserved for M1–M3; no payout access |
