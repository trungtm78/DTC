import type { NotificationRef, TenantTx } from '@machvon/db';
import { asUuid } from '@machvon/kernel';
import type { ResolverDefinition } from './definition';

/** What the event says about who should know: `payload.notification.recipients` (explicit) or its resource (roles in scope). */
export interface EventRecipients {
  recipients?: unknown;
  resource?: NotificationRef['resource'];
}

const ACTIVE_MEMBERSHIP = `m.status = 'Active' and (m.valid_from is null or m.valid_from <= now()) and (m.valid_until is null or m.valid_until > now())`;

const EXPLICIT_SQL = `select m.id from machvon.membership m where m.id = any($1::uuid[]) and ${ACTIVE_MEMBERSHIP} order by m.id`;

// Memberships holding an effective grant of one of the roles whose scope contains the resource. Unit paths end with a
// slash, so the prefix test compares whole segments (/a/12/ is not below /a/1/).
const ROLE_IN_SCOPE_SQL = `
  select distinct m.id
    from machvon.role_grant g
    join machvon.role_definition r on r.tenant_id = g.tenant_id and r.id = g.role_id
    join machvon.membership m on m.tenant_id = g.tenant_id and m.id = g.membership_id
   where r.code = any($1::text[])
     and g.status = 'Active' and g.effective_from <= now() and (g.effective_until is null or g.effective_until > now())
     and ${ACTIVE_MEMBERSHIP}
     and (
       g.scope_kind = 'TENANT'
       or (g.scope_kind = 'UNIT_ONLY' and $2::uuid = any(g.scope_ref_ids))
       or (g.scope_kind = 'UNIT_SUBTREE' and exists (
            select 1 from machvon.organization_unit scope_unit, machvon.organization_unit target
             where scope_unit.id = any(g.scope_ref_ids) and target.id = $2::uuid and starts_with(target.path, scope_unit.path)))
       or (g.scope_kind = 'PROJECT' and $3::uuid = any(g.scope_ref_ids))
       or (g.scope_kind = 'CONTRACT' and $4::uuid = any(g.scope_ref_ids)))
   order by m.id`;

function uuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.map((entry) => asUuid(entry)).filter((entry): entry is string => entry !== undefined);
  return [...new Set(ids)];
}

/**
 * The memberships an event is for, in the tenant of the transaction and only those that are Active now. Read access to
 * the resource is the next filter, made by the consumer: a resolver never widens beyond the tenant, and a membership
 * of another tenant named in an event is simply not found.
 */
export class RecipientResolver {
  async resolve(tx: TenantTx, event: EventRecipients, definition: ResolverDefinition): Promise<string[]> {
    if (definition.kind === 'explicit') {
      const ids = uuidList(event.recipients);
      if (ids.length === 0) return [];
      return (await tx.query<{ id: string }>(EXPLICIT_SQL, [ids])).map((row) => row.id);
    }
    const resource = event.resource;
    // Without an owner unit, project or contract there is no scope to test the grants against: nobody is notified.
    if (resource === undefined || (resource.ownerUnitId === undefined && resource.projectId === undefined && resource.contractId === undefined)) return [];
    const rows = await tx.query<{ id: string }>(ROLE_IN_SCOPE_SQL, [
      definition.roles,
      asUuid(resource.ownerUnitId) ?? null,
      asUuid(resource.projectId) ?? null,
      asUuid(resource.contractId) ?? null,
    ]);
    return rows.map((row) => row.id);
  }
}
