import { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { useEntitlements } from '../sas/tenants/hooks';
import { featureLabel, modeLabel, modeTone, toneClass } from '../sas/tenants/labels';
import { GrantCard } from './effective-access/GrantCard';
import { useEffectiveAccess } from './effective-access/hooks';
import { dayOf, scopeLabel, stateLabel, statePill } from './effective-access/labels';
import { NO_FILTER, filterGrants, groupGrants, isScopeKind, isStale, permissionRows, summaryOf } from './effective-access/model';
import type { GrantFilter } from './effective-access/model';
import { SCOPE_KINDS } from './effective-access/types';
import type { AccessGrant, EffectiveAccessView } from './effective-access/types';
import '../sas/tenants/sas.css';

function GrantSection({ title, grants, emptyText }: { title: string; grants: readonly AccessGrant[]; emptyText: string }) {
  return (
    <section aria-label={title} data-grant-section>
      <h3>
        {title} <span className="pill gray">{grants.length}</span>
      </h3>
      {grants.length === 0 ? <p className="muted tiny">{emptyText}</p> : grants.map((grant) => <GrantCard key={grant.id} grant={grant} />)}
    </section>
  );
}

/**
 * IAM-09: what the signed-in person may do, and where. Their own grants with the units, projects and contracts the scopes
 * name, the permissions those grants give and the role each comes from, the delegations they received, and what their plan
 * allows. Nothing of anyone else is on this page: the server answers for the caller only. The server still decides every
 * request; this is the explanation. When a newer reading shows another scope version a banner offers to reload, so the
 * person never works from an explanation that is out of date without knowing it.
 */
export default function EffectiveAccessScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const query = useEffectiveAccess();
  const plan = useEntitlements(undefined, true);
  const [shown, setShown] = useState<EffectiveAccessView | undefined>(undefined);
  const [filter, setFilter] = useState<GrantFilter>(NO_FILTER);
  // The first reading is the one on screen; a later one only replaces it when the person asks (the banner).
  useEffect(() => {
    if (shown === undefined && query.data !== undefined) setShown(query.data);
  }, [shown, query.data]);

  const access = shown ?? query.data;
  const state = useScreenState({
    isLoading: query.isLoading,
    error: query.error ?? undefined,
    data: access,
    isEmpty: (data) => (data as EffectiveAccessView).grants.length === 0 && (data as EffectiveAccessView).delegations.length === 0,
  });
  const stale = isStale(shown?.scopeVersion, query.data?.scopeVersion);
  const groups = groupGrants(filterGrants(access?.grants ?? [], filter));
  const summary = access === undefined ? undefined : summaryOf(access);
  const rows = access === undefined ? [] : permissionRows(access.grants, access.delegations);
  const features = plan.data?.features.filter((feature) => feature.allowed) ?? [];

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('iam.effectiveAccess.page.title')}</h1>
          <p>{t('iam.effectiveAccess.page.subtitle')}</p>
        </div>
      </div>
      {stale ? (
        <div className="callout warning" role="status" data-stale-banner>
          <span>{t('iam.effectiveAccess.stale.banner')}</span>{' '}
          <button type="button" onClick={() => setShown(query.data)}>
            {t('iam.effectiveAccess.stale.reload')}
          </button>
        </div>
      ) : null}
      <div className="two">
        <div className="card">
          <h2>{t('iam.effectiveAccess.card.title')}</h2>
          <StateBoundary state={state} onRetry={() => void query.refetch()}>
            {access === undefined || summary === undefined ? null : (
              <>
                <dl className="kv">
                  <div className="row between">
                    <dt>{t('iam.effectiveAccess.summary.role.label')}</dt>
                    <dd>{t('iam.effectiveAccess.summary.role.value', { count: summary.activeRoles })}</dd>
                  </div>
                  <div className="row between">
                    <dt>{t('iam.effectiveAccess.summary.scope.label')}</dt>
                    <dd>{t('iam.effectiveAccess.summary.scope.value', { count: summary.scopes })}</dd>
                  </div>
                  <div className="row between">
                    <dt>{t('iam.effectiveAccess.summary.validity.label')}</dt>
                    <dd>{summary.endedOrPending === 0 ? t('iam.effectiveAccess.summary.validity.none') : t('iam.effectiveAccess.summary.validity.value', { count: summary.endedOrPending })}</dd>
                  </div>
                  <div className="row between">
                    <dt>{t('iam.effectiveAccess.summary.delegations.label')}</dt>
                    <dd>{t('iam.effectiveAccess.summary.delegations.value', { count: summary.delegations })}</dd>
                  </div>
                  <div className="row between">
                    <dt>{t('iam.effectiveAccess.summary.plan.label')}</dt>
                    <dd>{plan.data === undefined ? t('iam.effectiveAccess.summary.plan.unavailable') : t('iam.effectiveAccess.summary.plan.value', { count: features.length })}</dd>
                  </div>
                </dl>

                <div className="filters">
                  <div>
                    <label htmlFor="access-filter-permission">{t('iam.effectiveAccess.filter.permission.label')}</label>
                    <input id="access-filter-permission" type="search" value={filter.permission} onChange={(event) => setFilter({ ...filter, permission: event.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="access-filter-scope">{t('iam.effectiveAccess.filter.scope.label')}</label>
                    <select
                      id="access-filter-scope"
                      value={filter.scope}
                      onChange={(event) => setFilter({ ...filter, scope: isScopeKind(event.target.value) ? event.target.value : 'ALL' })}
                    >
                      <option value="ALL">{t('iam.effectiveAccess.filter.scope.all')}</option>
                      {SCOPE_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {scopeLabel(t, kind)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <GrantSection title={t('iam.effectiveAccess.section.active')} grants={groups.active} emptyText={t('iam.effectiveAccess.section.empty')} />
                <GrantSection title={t('iam.effectiveAccess.section.future')} grants={groups.future} emptyText={t('iam.effectiveAccess.section.empty')} />
                <GrantSection title={t('iam.effectiveAccess.section.expired')} grants={groups.expired} emptyText={t('iam.effectiveAccess.section.empty')} />

                <section aria-label={t('iam.effectiveAccess.permissions.title')}>
                  <h3>{t('iam.effectiveAccess.permissions.title')}</h3>
                  {rows.length === 0 ? (
                    <p className="muted tiny">{t('iam.effectiveAccess.permissions.empty')}</p>
                  ) : (
                    <div className="tablewrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('iam.effectiveAccess.permissions.col.permission')}</th>
                            <th>{t('iam.effectiveAccess.permissions.col.source')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.permission} data-permission={row.permission}>
                              <td>
                                <code>{row.permission}</code>
                              </td>
                              <td>{[...row.roles, ...(row.delegated ? [t('iam.effectiveAccess.permissions.delegated')] : [])].join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section aria-label={t('iam.effectiveAccess.delegations.title')}>
                  <h3>{t('iam.effectiveAccess.delegations.title')}</h3>
                  {access.delegations.length === 0 ? (
                    <p className="muted tiny">{t('iam.effectiveAccess.delegations.empty')}</p>
                  ) : (
                    <div className="tablewrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t('iam.effectiveAccess.delegations.col.permissions')}</th>
                            <th>{t('iam.effectiveAccess.delegations.col.window')}</th>
                            <th>{t('iam.effectiveAccess.delegations.col.state')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {access.delegations.map((delegation) => (
                            <tr key={delegation.id} data-delegation-state={delegation.state}>
                              <td>
                                {delegation.permissions.map((permission) => (
                                  <code key={permission} className="chip">
                                    {permission}
                                  </code>
                                ))}
                              </td>
                              <td>
                                {dayOf(delegation.validFrom)} → {dayOf(delegation.validUntil)}
                              </td>
                              <td>
                                <span className={statePill(delegation.state)}>{stateLabel(t, delegation.state)}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </StateBoundary>
        </div>
        <div className="card" data-plan-card>
          <h2>{t('iam.effectiveAccess.plan.title')}</h2>
          {plan.isLoading ? (
            <p className="muted tiny" role="status">
              {t('iam.effectiveAccess.plan.loading')}
            </p>
          ) : plan.error !== null && plan.error !== undefined ? (
            <p className="callout warning" role="alert">
              {t('iam.effectiveAccess.plan.error')}{' '}
              <button type="button" onClick={() => void plan.refetch()}>
                {t('states.retry.action')}
              </button>
            </p>
          ) : features.length === 0 ? (
            <p className="muted tiny">{t('iam.effectiveAccess.plan.empty')}</p>
          ) : (
            <ul className="plain">
              {features.map((feature) => (
                <li key={feature.featureCode} className="row between" data-feature={feature.featureCode}>
                  <span>{featureLabel(t, feature.featureCode)}</span>
                  <span className={toneClass(modeTone(feature.mode))}>{modeLabel(t, feature.mode)}</span>
                </li>
              ))}
            </ul>
          )}
          {access?.entitlementHash === undefined ? null : (
            <p className="tiny muted">
              {t('iam.effectiveAccess.plan.hash')}: <code>{access.entitlementHash}</code>
            </p>
          )}
        </div>
      </div>
      <p className="prototype-note">{t('iam.effectiveAccess.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
