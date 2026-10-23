import { memo, useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from '../../../i18n';
import { errorMessage, offendingField } from './errors';
import { useAttemptedCommand, useRefreshRolesAndGrants } from './hooks';
import type { CommandExecutor } from './hooks';
import { assignablePermissions, groupPermissions, permissionOf, togglePermission } from './permission-groups';
import type { PermissionGroup } from './permission-groups';
import { StepUpPrompt } from './StepUpPrompt';
import { MAX_RANK, MIN_REASON_LENGTH } from './types';
import type { RoleView } from './types';

const ROLE_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const MAX_NAME = 120;
const MAX_PERMISSIONS = 200;
const WILDCARD = '*';

export interface RoleFormProps {
  /** The role to edit or view; undefined means a new custom role. */
  role?: RoleView;
  /** The user holds iam.role.manage (or the permissions are unknown and the server decides). */
  canManage: boolean;
  onSaved(kind: 'created' | 'saved'): void;
  /** The user asked for the latest server version: the screen mounts the form again from the fresh data. */
  onReload?(): void;
}

type RoleCommand =
  | { kind: 'create'; body: { code: string; name: string; permissions: string[]; rank: number; guest_allowed: boolean } }
  | { kind: 'update'; roleId: string; version: number; body: { name: string; permissions: string[]; rank: number; reason: string } };

const saveRole: CommandExecutor<RoleCommand> = (client, input, attempt) =>
  input.kind === 'create'
    ? client.command('createCustomRole', { body: input.body, attempt })
    : client.command('updateCustomRole', { path: { roleId: input.roleId }, body: input.body, ifMatchVersion: input.version, attempt });

interface PermissionMatrixProps {
  groups: readonly PermissionGroup[];
  selected: readonly string[];
  disabled: boolean;
  invalid: boolean;
  onToggle(permission: string): void;
}

/**
 * The resource x action rows of the mockup's roles and permissions card. It is memoised: typing in a field of the form
 * must not re-render the several hundred checkboxes.
 */
const PermissionMatrix = memo(function PermissionMatrix({ groups, selected, disabled, invalid, onToggle }: PermissionMatrixProps) {
  const { t } = useTranslation();
  return (
    <div aria-invalid={invalid}>
      {groups.map(({ resource, actions }) => (
        <div className="item" key={resource}>
          <div className="row between">
            <div>
              <b>{resource}</b>
              <p className="sub">{t('adm.roles.matrix.hint')}</p>
            </div>
            <div className="row" role="group" aria-label={t('adm.roles.matrix.group.label', { resource })}>
              {actions.map((action) => {
                const permission = permissionOf(resource, action);
                return (
                  <label className="row roles-action" key={action}>
                    <input type="checkbox" aria-label={permission} checked={selected.includes(permission)} disabled={disabled} onChange={() => onToggle(permission)} />
                    <span>{action === WILDCARD ? t('adm.roles.matrix.wildcard.label') : action}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
});

/**
 * The role card of ADM-03: the resource x action matrix of a role (as the mockup's roles and permissions card lists its
 * rows) with the role fields above it. System roles and users without iam.role.manage see it read-only. Mount it with
 * `key={role?.id}` so a different role starts from its own values. The draft is based on the role as it was when the
 * form was mounted: the update carries that version as If-Match, so an edit by someone else in the meantime is answered
 * with VERSION_CONFLICT instead of being overwritten, and the form says the role changed on the server.
 */
export function RoleForm({ role, canManage, onSaved, onReload }: RoleFormProps) {
  const { t } = useTranslation();
  const refresh = useRefreshRolesAndGrants();
  const [base] = useState(role);
  const creating = role === undefined;
  const changedOnServer = role !== undefined && base !== undefined && role.version !== base.version;
  const editable = canManage && (creating || !role.is_system);
  const [code, setCode] = useState(role?.code ?? '');
  const [name, setName] = useState(role === undefined || role.is_system ? '' : role.name);
  const [rank, setRank] = useState(String(role?.rank ?? ''));
  const [guest, setGuest] = useState(role?.guest_allowed ?? false);
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [reason, setReason] = useState('');
  const [localInvalid, setLocalInvalid] = useState<readonly string[]>([]);
  const command = useAttemptedCommand<RoleCommand>(saveRole, async () => {
    await refresh();
    onSaved(creating ? 'created' : 'saved');
  });
  const groups = useMemo(() => groupPermissions([...assignablePermissions(), ...permissions]), [permissions]);
  const invalidField = offendingField(command.error);
  const isInvalid = (field: string): boolean => localInvalid.includes(field) || invalidField === field;
  const { resetAttempt } = command;
  const touched = (): void => resetAttempt();
  const togglePermissionOf = useCallback(
    (permission: string): void => {
      setPermissions((current) => togglePermission(current, permission));
      resetAttempt();
    },
    [resetAttempt],
  );

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!editable) return;
    const rankNumber = Number(rank);
    const invalid: string[] = [];
    if (creating && !ROLE_CODE.test(code)) invalid.push('code');
    if (creating && (name.trim() === '' || name.length > MAX_NAME)) invalid.push('name');
    if (!Number.isInteger(rankNumber) || rankNumber < 1 || rankNumber > MAX_RANK) invalid.push('rank');
    if (permissions.length === 0 || permissions.length > MAX_PERMISSIONS) invalid.push('permissions');
    if (!creating && reason.trim().length < MIN_REASON_LENGTH) invalid.push('reason');
    setLocalInvalid(invalid);
    if (invalid.length > 0) return;
    if (creating || base === undefined) {
      void command.run({ kind: 'create', body: { code, name: name.trim(), permissions, rank: rankNumber, guest_allowed: guest } });
    } else {
      void command.run({
        kind: 'update',
        roleId: base.id,
        version: base.version,
        body: { name: name.trim() === '' ? base.name : name.trim(), permissions, rank: rankNumber, reason: reason.trim() },
      });
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      {role?.is_system === true ? <div className="callout">{t('adm.roles.system.note')}</div> : null}
      {editable || role === undefined ? null : <div className="callout">{t('adm.roles.readonly.note')}</div>}
      {changedOnServer ? (
        <div className="callout warning" role="status">
          {t('adm.roles.changed.notice')}{' '}
          <button type="button" onClick={onReload}>
            {t('adm.roles.changed.reload')}
          </button>
        </div>
      ) : null}
      <div className="formgrid">
        <div className="field">
          <label htmlFor="role-code">{t('adm.roles.form.code.label')}</label>
          <input id="role-code" name="code" value={code} disabled={!creating || !editable} aria-invalid={isInvalid('code')} onChange={(event) => { setCode(event.target.value.toUpperCase()); touched(); }} />
        </div>
        <div className="field">
          <label htmlFor="role-name">{t('adm.roles.form.name.label')}</label>
          <input id="role-name" name="name" value={name} disabled={!editable} aria-invalid={isInvalid('name')} onChange={(event) => { setName(event.target.value); touched(); }} />
        </div>
        <div className="field">
          <label htmlFor="role-rank">{t('adm.roles.form.rank.label')}</label>
          <input id="role-rank" name="rank" inputMode="numeric" value={rank} disabled={!editable} aria-invalid={isInvalid('rank')} onChange={(event) => { setRank(event.target.value); touched(); }} />
          <small>{t('adm.roles.form.rank.help')}</small>
        </div>
        <div className="field roles-action">
          <label htmlFor="role-guest">{t('adm.roles.form.guest.label')}</label>
          <input id="role-guest" name="guest_allowed" type="checkbox" checked={guest} disabled={!creating || !editable} onChange={(event) => { setGuest(event.target.checked); touched(); }} />
        </div>
      </div>
      <PermissionMatrix groups={groups} selected={permissions} disabled={!editable} invalid={isInvalid('permissions')} onToggle={togglePermissionOf} />
      {creating || !editable ? null : (
        <div className="field">
          <label htmlFor="role-reason">{t('adm.roles.form.reason.label')}</label>
          <textarea id="role-reason" name="reason" value={reason} aria-invalid={isInvalid('reason')} onChange={(event) => { setReason(event.target.value); touched(); }} />
          <small>{t('adm.roles.form.reason.help')}</small>
        </div>
      )}
      {command.error === undefined ? null : (
        <div className="callout warning" role="alert">
          {errorMessage(t, command.error)}
        </div>
      )}
      {editable ? (
        <button type="submit" className="primary gap" disabled={command.pending}>
          {creating ? t('adm.roles.form.create.action') : t('adm.roles.form.save.action')}
        </button>
      ) : null}
      {command.stepUpOpen ? <StepUpPrompt onConfirm={() => void command.confirmStepUp()} onCancel={command.cancelStepUp} /> : null}
    </form>
  );
}
