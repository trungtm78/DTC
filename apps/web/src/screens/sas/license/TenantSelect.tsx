import { useMemo } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { useTranslation } from '../../../i18n';
import { useTenantDetail, useTenantList } from '../tenants/hooks';
import type { TenantSummary } from '../tenants/types';

interface TenantSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'> {
  value: string;
  onChange: (tenantId: string) => void;
  /** The text of the empty option. */
  chooseLabel: string;
  /** Keeps a tenant out of the list (for example one that cannot take a license); the tenant that is chosen already always stays. */
  accepts?: (tenant: TenantSummary) => boolean;
  /** An empty option that cannot be chosen again (the picker of SAS-13) instead of a plain one. */
  chooseDisabled?: boolean;
}

/**
 * The registry as a list to choose a tenant from. It never hides a tenant behind the first page: more are loaded on request,
 * and the tenant named by the address (or chosen before) stays an option even while its page is not loaded. A registry that
 * cannot be read says so and can be read again; it is never an empty list.
 */
export function TenantSelect({ value, onChange, chooseLabel, accepts, chooseDisabled = false, ...rest }: TenantSelectProps) {
  const { t } = useTranslation();
  const tenants = useTenantList();
  const all = useMemo(() => tenants.data?.pages.flatMap((page) => page.items) ?? [], [tenants.data]);
  const listed = all.some((tenant) => tenant.id === value);
  const options = useMemo(() => all.filter((tenant) => tenant.id === value || accepts === undefined || accepts(tenant)), [all, accepts, value]);
  // A tenant that the loaded pages do not hold is read by itself, for its name; until then its id stands in.
  const missing = useTenantDetail(value, value !== '' && !listed && !tenants.isLoading);
  const ownName = missing.data?.name ?? value;

  return (
    <>
      <select value={value} onChange={(event) => onChange(event.target.value)} {...rest}>
        <option value="" disabled={chooseDisabled}>
          {chooseLabel}
        </option>
        {value !== '' && !listed ? <option value={value}>{ownName}</option> : null}
        {options.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.name}
          </option>
        ))}
      </select>
      {tenants.isError ? (
        <p className="callout warning" role="alert">
          {t('sas.licenseTenants.error.notice')}{' '}
          <button type="button" disabled={tenants.isFetching} onClick={() => void tenants.refetch()}>
            {t('sas.licenseTenants.retry.action')}
          </button>
        </p>
      ) : null}
      {tenants.hasNextPage ? (
        <button type="button" disabled={tenants.isFetchingNextPage} onClick={() => void tenants.fetchNextPage()}>
          {t('sas.licenseTenants.more.action')}
        </button>
      ) : null}
    </>
  );
}
