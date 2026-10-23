import { useTranslation } from '../i18n';
import type { SessionTenant } from '../session/SessionContext';

export interface TenantSwitcherProps {
  tenants: readonly SessionTenant[];
  current: SessionTenant | undefined;
  onSwitch(tenantId: string): void;
}

/**
 * Switches the selected tenant of the session. It only shows when the user holds more than one membership; the real
 * chooser is the IAM-04 screen, this control is the compact form of it for the sidebar.
 */
export function TenantSwitcher({ tenants, current, onSwitch }: TenantSwitcherProps) {
  const { t } = useTranslation();
  if (tenants.length < 2) return null;
  return (
    <select
      className="tenant-switcher"
      aria-label={t('shell.tenant.switch.label')}
      value={current?.id ?? ''}
      onChange={(event) => onSwitch(event.target.value)}
    >
      {tenants.map((tenant) => (
        <option key={tenant.id} value={tenant.id}>
          {tenant.name}
        </option>
      ))}
    </select>
  );
}
