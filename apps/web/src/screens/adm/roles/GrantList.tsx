import { useTranslation } from '../../../i18n';
import { scopeLabel, statusLabel, windowLabel } from './labels';
import type { GrantView } from './types';

export interface GrantListProps {
  grants: readonly GrantView[];
  /** Whether revoking is offered (iam.role.grant); the server still decides. */
  canRevoke: boolean;
  onRevoke(grant: GrantView): void;
}

const STATUS_PILL: Readonly<Record<GrantView['status'], string>> = { Active: 'pill', Revoked: 'pill gray', Expired: 'pill warn' };

/** The grants of the caller's scope as the prototype's table: role, scope, grantor, reason, validity, status. */
export function GrantList({ grants, canRevoke, onRevoke }: GrantListProps) {
  const { t } = useTranslation();
  if (grants.length === 0) return <p className="muted">{t('adm.roles.grants.empty')}</p>;
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>{t('adm.roles.grants.col.role')}</th>
            <th>{t('adm.roles.grants.col.member')}</th>
            <th>{t('adm.roles.grants.col.scope')}</th>
            <th>{t('adm.roles.grants.col.grantedBy')}</th>
            <th>{t('adm.roles.grants.col.reason')}</th>
            <th>{t('adm.roles.grants.col.window')}</th>
            <th>{t('adm.roles.grants.col.status')}</th>
            {canRevoke ? <th>{t('adm.roles.grants.col.actions')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr key={grant.id}>
              <td>
                <b>{grant.role_code}</b>
              </td>
              <td>
                <code>{grant.membership_id}</code>
              </td>
              <td>
                {scopeLabel(t, grant.scope_kind)}
                {grant.scope_ref_ids.map((id) => (
                  <div key={id}>
                    <code>{id}</code>
                  </div>
                ))}
              </td>
              <td>{grant.granted_by}</td>
              <td>{grant.grant_reason}</td>
              <td>{windowLabel(t, grant)}</td>
              <td>
                <span className={STATUS_PILL[grant.status]}>{statusLabel(t, grant.status)}</span>
              </td>
              {canRevoke ? (
                <td>
                  {grant.status === 'Active' ? (
                    <button type="button" className="danger" onClick={() => onRevoke(grant)}>
                      {t('adm.roles.grants.revoke.action')}
                    </button>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
