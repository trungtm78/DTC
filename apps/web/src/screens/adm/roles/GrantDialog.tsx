import { useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from '../../../i18n';
import { NavigationDialog } from '../../../shell/NavigationDialog';
import { errorMessage, offendingField } from './errors';
import { StepUpPrompt } from './StepUpPrompt';
import { useAttemptedCommand, useRefreshRolesAndGrants } from './hooks';
import type { CommandExecutor } from './hooks';
import { scopeLabel } from './labels';
import { MIN_REASON_LENGTH, SCOPE_KINDS } from './types';
import type { RoleView, ScopeKind } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCOPE_REFS = 200;

type RecipientType = 'staff' | 'guest';

/** How the read of the grantable roles stands: the picker is only usable once they are `ready`. */
export interface GrantableRolesStatus {
  state: 'loading' | 'error' | 'ready';
  error?: unknown;
  onRetry(): void;
}

export interface GrantDialogProps {
  /** The roles the user can hand out (`get_resources_role_definition?grantable=true`); nothing else is offered. */
  roles: readonly RoleView[];
  /** Absent means the roles are ready. */
  rolesStatus?: GrantableRolesStatus;
  onClose(): void;
  onGranted(): void;
}

interface GrantBody {
  membership_id: string;
  role_id: string;
  scope_kind: ScopeKind;
  scope_ref_ids?: string[];
  effective_from?: string;
  effective_until?: string;
  reason: string;
}

const grant: CommandExecutor<GrantBody> = (client, body, attempt) => client.command('grantRole', { body, attempt });

function refsOf(text: string): string[] {
  return text
    .split(/\s+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function isoOf(local: string): string | undefined {
  if (local === '') return undefined;
  const time = Date.parse(local);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** The scope kinds the recipient may hold: a guest contractor only gets CONTRACT scopes (BR-IAM-08). */
export function scopeKindsFor(recipient: RecipientType): readonly ScopeKind[] {
  return recipient === 'guest' ? ['CONTRACT'] : SCOPE_KINDS;
}

/** The roles offered to the recipient: for a guest contractor only the roles marked `guest_allowed`. */
export function rolesFor(roles: readonly RoleView[], recipient: RecipientType): RoleView[] {
  return roles.filter((role) => recipient === 'staff' || role.guest_allowed);
}

/**
 * The grant dialog (grantRole, step-up aal2). The role picker lists only roles the server would accept, the scope
 * picker only the kinds the recipient may hold; everything else the server still decides and answers with a coded
 * problem that the dialog shows without closing.
 */
export function GrantDialog({ roles, rolesStatus, onClose, onGranted }: GrantDialogProps) {
  const { t } = useTranslation();
  const rolesState = rolesStatus?.state ?? 'ready';
  const refresh = useRefreshRolesAndGrants();
  const titleId = useId();
  const [membershipId, setMembershipId] = useState('');
  const [recipient, setRecipient] = useState<RecipientType>('staff');
  const [roleId, setRoleId] = useState('');
  const [scopeKind, setScopeKind] = useState<ScopeKind>('UNIT_SUBTREE');
  const [refs, setRefs] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const [localInvalid, setLocalInvalid] = useState<readonly string[]>([]);

  const command = useAttemptedCommand<GrantBody>(grant, async () => {
    await refresh();
    onGranted();
  });
  const offered = useMemo(() => rolesFor(roles, recipient), [roles, recipient]);
  const kinds = scopeKindsFor(recipient);
  const invalidField = offendingField(command.error);
  const isInvalid = (field: string): boolean => localInvalid.includes(field) || invalidField === field;
  const edit = <V,>(set: (value: V) => void) => (value: V): void => {
    set(value);
    command.resetAttempt();
  };

  // Targets typed for another scope kind are dropped when the scope becomes tenant-wide: the box is hidden then, and
  // what it held must neither come back later nor make the hidden field fail validation.
  const changeScopeKind = (next: ScopeKind): void => {
    setScopeKind(next);
    if (next === 'TENANT') setRefs('');
    command.resetAttempt();
  };

  const changeRecipient = (next: RecipientType): void => {
    setRecipient(next);
    if (!rolesFor(roles, next).some((role) => role.id === roleId)) setRoleId('');
    if (!scopeKindsFor(next).includes(scopeKind)) setScopeKind('CONTRACT');
    command.resetAttempt();
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const ids = refsOf(refs);
    const invalid: string[] = [];
    if (!UUID.test(membershipId.trim())) invalid.push('membership_id');
    if (!offered.some((role) => role.id === roleId)) invalid.push('role_id');
    if ((scopeKind === 'TENANT') !== (ids.length === 0) || ids.length > MAX_SCOPE_REFS || !ids.every((id) => UUID.test(id))) invalid.push('scope_ref_ids');
    const start = isoOf(from);
    const end = isoOf(until);
    if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) invalid.push('effective_until');
    if (reason.trim().length < MIN_REASON_LENGTH) invalid.push('reason');
    setLocalInvalid(invalid);
    if (invalid.length > 0) return;
    const body: GrantBody = { membership_id: membershipId.trim(), role_id: roleId, scope_kind: scopeKind, reason: reason.trim() };
    if (scopeKind !== 'TENANT') body.scope_ref_ids = ids;
    if (start !== undefined) body.effective_from = start;
    if (end !== undefined) body.effective_until = end;
    void command.run(body);
  };

  return (
    <>
      <NavigationDialog className="catalog command-mode" onClose={onClose}>
        <section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="command-titlebar">
            <strong id={titleId}>{t('adm.roles.grant.dialog.title')}</strong>
            <button type="button" className="icon-button" aria-label={t('adm.roles.dialog.close.label')} onClick={onClose}>
              ×
            </button>
          </div>
          <form className="roles-dialog-body" onSubmit={submit} noValidate>
            <div className="formgrid">
              <div className="field">
                <label htmlFor="grant-member">{t('adm.roles.grant.member.label')}</label>
                <input id="grant-member" name="membership_id" value={membershipId} aria-invalid={isInvalid('membership_id')} onChange={(event) => edit(setMembershipId)(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="grant-recipient">{t('adm.roles.grant.recipient.label')}</label>
                <select id="grant-recipient" value={recipient} onChange={(event) => changeRecipient(event.target.value as RecipientType)}>
                  <option value="staff">{t('adm.roles.grant.recipient.staff')}</option>
                  <option value="guest">{t('adm.roles.grant.recipient.guest')}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="grant-role">{t('adm.roles.grant.role.label')}</label>
                <select
                  id="grant-role"
                  name="role_id"
                  value={roleId}
                  disabled={rolesState !== 'ready'}
                  aria-invalid={isInvalid('role_id')}
                  onChange={(event) => edit(setRoleId)(event.target.value)}
                >
                  <option value="">{t('adm.roles.picker.placeholder')}</option>
                  {offered.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.code}
                    </option>
                  ))}
                </select>
                {rolesState === 'loading' ? <small role="status">{t('adm.roles.grant.roles.loading')}</small> : null}
                {rolesState === 'error' ? (
                  <div className="callout warning" role="alert">
                    {errorMessage(t, rolesStatus?.error)}{' '}
                    <button type="button" onClick={rolesStatus?.onRetry}>
                      {t('adm.roles.grant.roles.retry')}
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="grant-scope">{t('adm.roles.grant.scope.label')}</label>
                <select id="grant-scope" name="scope_kind" value={scopeKind} onChange={(event) => changeScopeKind(event.target.value as ScopeKind)}>
                  {kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {scopeLabel(t, kind)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {scopeKind === 'TENANT' ? null : (
              <div className="field">
                <label htmlFor="grant-refs">{t('adm.roles.grant.refs.label')}</label>
                <textarea id="grant-refs" name="scope_ref_ids" value={refs} aria-invalid={isInvalid('scope_ref_ids')} onChange={(event) => edit(setRefs)(event.target.value)} />
              </div>
            )}
            <div className="formgrid">
              <div className="field">
                <label htmlFor="grant-from">{t('adm.roles.grant.from.label')}</label>
                <input id="grant-from" name="effective_from" type="datetime-local" value={from} aria-invalid={isInvalid('effective_from')} onChange={(event) => edit(setFrom)(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="grant-until">{t('adm.roles.grant.until.label')}</label>
                <input id="grant-until" name="effective_until" type="datetime-local" value={until} aria-invalid={isInvalid('effective_until')} onChange={(event) => edit(setUntil)(event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="grant-reason">{t('adm.roles.form.reason.label')}</label>
              <textarea id="grant-reason" name="reason" value={reason} aria-invalid={isInvalid('reason')} onChange={(event) => edit(setReason)(event.target.value)} />
              <small>{t('adm.roles.form.reason.help')}</small>
            </div>
            {command.error === undefined ? null : (
              <div className="callout warning" role="alert">
                {errorMessage(t, command.error)}
              </div>
            )}
            <div className="formfooter">
              <button type="button" onClick={onClose}>
                {t('adm.roles.grant.cancel.action')}
              </button>
              <button type="submit" className="primary" disabled={command.pending || rolesState !== 'ready'}>
                {t('adm.roles.grant.submit.action')}
              </button>
            </div>
          </form>
        </section>
      </NavigationDialog>
      {command.stepUpOpen ? <StepUpPrompt onConfirm={() => void command.confirmStepUp()} onCancel={command.cancelStepUp} /> : null}
    </>
  );
}
