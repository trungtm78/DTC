import { createHash } from 'node:crypto';

export interface DedupeInput {
  tenantId: string;
  /** The outbox event the notification answers. */
  sourceEventId: string;
  recipientId: string;
  purpose: string;
}

/**
 * BR-NOT-01: `n1:` + hex(sha256(tenant_id | source_event_id | recipient_id | purpose)). The key leaves out the
 * template, the workflow version and the channel, so a replay after any of them changed still hits the same row.
 */
export function dedupeKeyOf(input: DedupeInput): string {
  const text = [input.tenantId, input.sourceEventId, input.recipientId, input.purpose].map((part) => part.toLowerCase()).join('|');
  return `n1:${createHash('sha256').update(text).digest('hex')}`;
}
