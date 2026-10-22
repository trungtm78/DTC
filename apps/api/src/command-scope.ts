import type { AuditEntry, OutboxEventInput, TenantTx } from '@machvon/db';
import type { TenantContext } from '@machvon/kernel';

/** What a @Command handler may use: the tenant transaction, the audit trail and the outbox. */
export interface CommandScope {
  tx: TenantTx;
  tenant: TenantContext;
  requestId: string;
  correlationId: string;
  /** Parsed `If-Match` for `versioned` commands, otherwise null. */
  expectedVersion: number | null;
  /** Writes the SUCCESS audit row in the command transaction; returns its id. */
  audit(entry: Omit<AuditEntry, 'correlationId' | 'requestId'>): Promise<string>;
  /** Writes an outbox event in the command transaction. */
  emit(event: Omit<OutboxEventInput, 'correlationId'>): Promise<{ id: string; duplicate: boolean }>;
}
