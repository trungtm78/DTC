# Runbook: audit chain broken and the tamper drill

Stories: ST-ADM-002, ST-KERNEL-023. Rule: BR-PLT-01 (immutable audit).

## What the alert means

`AUDIT_CHAIN_BROKEN` (P1) comes from `AuditSealJob.verify`. The metric `audit_seal_failures_total{tenant_id}` is incremented with it. The context names the tenant and the failing seal window (`sealId`, `fromSeq`, `toSeq`) and one reason:

| Reason | Meaning |
|---|---|
| `ROOT_MISMATCH` | A row inside the window was changed, deleted or planted, or the stored Merkle root was rewritten. |
| `SEAL_HASH_MISMATCH` | `seal_hash` no longer equals `sha256(prev_seal_hash || merkle_root || to_seq)`. |
| `CHAIN_LINK_MISMATCH` | `prev_seal_hash` is not the `seal_hash` of the previous seal. |
| `UNSEALED_ROW_IN_GAP` | A row exists between two seals, which sealing never leaves. |

The verifier reports the first failing window, not the single row: the design stores no per-row hash.

## Who is paged

The platform on-call engineer through the operations channel, which is independent of the notification module. The security officer is informed for every occurrence.

## Triage

1. Do not edit or delete anything. Only `machvon_owner` can change the audit tables, and every use of that role is itself a finding.
2. Read the failing window as the owner role, with the tenant bound:
   ```sql
   select set_config('app.tenant_id', '<tenant uuid>', false);
   select seq, id, actor_id, action, resource_type, resource_id, outcome, occurred_at
     from machvon.audit_event where seq between <fromSeq> and <toSeq> order by seq;
   select * from machvon.audit_seal where id = '<sealId>';
   ```
3. Compare with the last verified backup or WAL archive of the same window to see which rows differ.
4. Check who connected as `machvon_owner` or a superuser in the period (database connection log).
5. Open a security incident; keep the evidence (query output, backup comparison) with the ticket.

## Tamper drill (quarterly, on staging)

1. Seal a staging tenant (`AuditSealJob.seal`) and confirm `verify` returns `ok: true`.
2. As `machvon_owner` change one `audit_event` row inside a sealed window.
3. Run `verify`; the alert must be raised within one hour of the next scheduled verification, and the failing window must contain the row.
4. Restore the row, run `verify` again and confirm `ok: true`.
5. Record the result in the evidence template.

| date | operator | tampered row (tenant, seq) | detected by | time to alert | restored and re-verified |
|---|---|---|---|---|---|
| | | | | | |
