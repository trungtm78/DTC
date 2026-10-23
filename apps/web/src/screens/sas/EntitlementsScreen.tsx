import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { useEntitlements, useTenantList } from './tenants/hooks';
import { featureLabel, licenseLabel, modeLabel, modeTone, sourceLabel, toneClass } from './tenants/labels';
import { READ_TENANTS_PERMISSION } from './tenants/types';
import './tenants/sas.css';

/**
 * SAS-25: what a tenant may do under its plan and licence, read-only. The control plane picks a tenant (the table of
 * that tenant comes from `getTenantEntitlements`); the tenant plane sees its own table (`getMyEntitlements`).
 */
export default function EntitlementsScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions } = useSession();
  const [params, setParams] = useSearchParams();
  const control = permissions?.includes(READ_TENANTS_PERMISSION) === true;
  const tenants = useTenantList(control);
  const options = useMemo(() => tenants.data?.pages.flatMap((page) => page.items) ?? [], [tenants.data]);
  const chosen = control ? (params.get('tenant') ?? options[0]?.id) : undefined;
  // The control plane has no table of its own: it waits until it knows which tenant to read.
  const table = useEntitlements(chosen, !control || chosen !== undefined);
  const waitingForTenants = control && chosen === undefined && tenants.isLoading;
  const state = useScreenState({
    isLoading: table.isLoading || waitingForTenants,
    error: control && chosen === undefined ? tenants.error : table.error,
    data: control && chosen === undefined ? undefined : table.data,
    isEmpty: (data) => (data as { features: unknown[] }).features.length === 0,
  });

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('sas.entitlements.page.title')}</h1>
          <p>{t('sas.entitlements.page.subtitle')}</p>
        </div>
      </div>
      <StateBoundary state={state} onRetry={() => void table.refetch()}>
        <div className="card">
          {control ? (
            <div className="filters">
              <div>
                <label htmlFor="entitlement-tenant">{t('sas.entitlements.tenant.label')}</label>
                <select id="entitlement-tenant" value={chosen ?? ''} onChange={(event) => setParams({ tenant: event.target.value })}>
                  {options.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          {table.data === undefined ? null : (
            <>
              <p className="row gap tiny muted" data-entitlements-version={table.data.versionNo}>
                <span>{t('sas.entitlements.version.text', { version: table.data.versionNo })}</span>
                <span>
                  {t('sas.entitlements.hash.label')}: <code data-entitlements-hash>{table.data.hash}</code>
                </span>
                <span>
                  {t('sas.entitlements.license.label')}: {licenseLabel(t, table.data.licenseStatus)}
                </span>
              </p>
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('sas.entitlements.col.feature')}</th>
                      <th>{t('sas.entitlements.col.source')}</th>
                      <th>{t('sas.entitlements.col.limit')}</th>
                      <th>{t('sas.entitlements.col.used')}</th>
                      <th>{t('sas.entitlements.col.mode')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.data.features.map((feature) => (
                      <tr key={feature.featureCode} data-feature={feature.featureCode}>
                        <td>
                          <b>{featureLabel(t, feature.featureCode)}</b>
                          <div className="sub">{feature.featureCode}</div>
                        </td>
                        <td>{sourceLabel(t, feature.source)}</td>
                        <td>{feature.limit ?? t('sas.entitlements.noLimit')}</td>
                        <td>{feature.used ?? t('sas.entitlements.noLimit')}</td>
                        <td>
                          <span className={toneClass(modeTone(feature.mode))}>{modeLabel(t, feature.mode)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </StateBoundary>
      <p className="prototype-note">{t('sas.entitlements.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
