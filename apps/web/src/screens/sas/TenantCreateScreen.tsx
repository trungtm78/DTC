import { useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { routeById } from '../../routes/registry';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { useProvisionTenant } from './tenants/hooks';
import { fieldProblemMessage, governingBodyLabel, isolationLabel, problemMessage, regionLabel } from './tenants/labels';
import { describeProblem } from './tenants/problems';
import { EMPTY_PROVISION_VALUES, provisionBody, validateProvisionForm } from './tenants/rules';
import type { ProvisionErrors, ProvisionField, ProvisionValues } from './tenants/rules';
import { GOVERNING_BODY_TYPES, ISOLATION_MODES, MANAGE_TENANTS_PERMISSION, REGIONS } from './tenants/types';
import './tenants/sas.css';

const ARROW = '←';

interface FieldProps {
  field: ProvisionField;
  label: string;
  error: string | undefined;
  children: ReactNode;
}

function Field({ field, label, error, children }: FieldProps) {
  return (
    <div className="field" data-field={field}>
      <label htmlFor={`tenant-${field}`}>{label}</label>
      {children}
      {error === undefined ? null : (
        <small role="alert" className="field-error" id={`tenant-${field}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

/** SAS-02: asks the control plane to provision a tenant; the 202 answer names the run that the saga now works on. */
export default function TenantCreateScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions } = useSession();
  const canManage = permissions === undefined || permissions.includes(MANAGE_TENANTS_PERMISSION);
  const provision = useProvisionTenant();
  // The typed values live in a ref-backed state object: a re-render for any reason never resets the form.
  const [values, setValues] = useState<ProvisionValues>(EMPTY_PROVISION_VALUES);
  const [refused, setRefused] = useState<ProvisionErrors>({});
  const lastSent = useRef<string | undefined>(undefined);
  const list = routeById('SAS-01');

  const set = (field: ProvisionField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setRefused((current) => ({ ...current, [field]: undefined }));
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (provision.isPending || !canManage) return;
    const errors = validateProvisionForm(values);
    setRefused(errors);
    if (Object.keys(errors).length > 0) return;
    lastSent.current = JSON.stringify(values);
    // A request that was accepted is done: the form empties, so a second click cannot send a second tenant.
    provision.mutate(provisionBody(values), { onSuccess: () => setValues(EMPTY_PROVISION_VALUES) });
  };

  const problem = provision.isError ? describeProblem(provision.error) : undefined;
  const serverFieldError = (field: ProvisionField): string | undefined => (problem?.field === field ? problemMessage(t, problem) : undefined);
  const errorOf = (field: ProvisionField): string | undefined => {
    const own = refused[field];
    return own === undefined ? serverFieldError(field) : fieldProblemMessage(t, own);
  };
  const text = (field: ProvisionField, label: string, type = 'text') => (
    <Field field={field} label={label} error={errorOf(field)}>
      <input id={`tenant-${field}`} type={type} value={values[field]} aria-invalid={errorOf(field) !== undefined} aria-describedby={errorOf(field) === undefined ? undefined : `tenant-${field}-error`} onChange={(event) => set(field, event.target.value)} />
    </Field>
  );

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      {list === undefined ? null : (
        <p className="sas-back-link">
          <Link to={list.path}>
            <span aria-hidden="true">{ARROW} </span>
            {t('sas.tenantCreate.back.link')}
          </Link>
        </p>
      )}
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('sas.tenantCreate.page.title')}</h1>
          <p>{t('sas.tenantCreate.page.subtitle')}</p>
        </div>
      </div>
      <div className="card">
        {!canManage ? (
          <p className="callout warning" role="status">
            {t('sas.tenantCreate.readOnly.notice')}
          </p>
        ) : null}
        {provision.isSuccess ? (
          <p className="callout" role="status">
            {t('sas.tenantCreate.accepted.notice', { status: provision.data.status, run: provision.data.provisioning_run_id ?? '' })}{' '}
            {list === undefined ? null : <Link to={list.path}>{t('sas.tenantCreate.accepted.link')}</Link>}
          </p>
        ) : null}
        {problem !== undefined && problem.field === undefined ? (
          <p className="callout warning" role="alert">
            {problemMessage(t, problem)}
          </p>
        ) : null}
        <form onSubmit={submit} noValidate>
          <div className="formgrid">
            {text('name', t('sas.tenantCreate.name.label'))}
            {text('initial_owner_email', t('sas.tenantCreate.owner.label'), 'email')}
            <Field field="region" label={t('sas.tenantCreate.region.label')} error={errorOf('region')}>
              <select id="tenant-region" value={values.region} onChange={(event) => set('region', event.target.value)}>
                {REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {regionLabel(t, region)}
                  </option>
                ))}
              </select>
            </Field>
            <Field field="isolation_mode" label={t('sas.tenantCreate.isolation.label')} error={errorOf('isolation_mode')}>
              <select id="tenant-isolation_mode" value={values.isolation_mode} onChange={(event) => set('isolation_mode', event.target.value)}>
                {ISOLATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {isolationLabel(t, mode)}
                  </option>
                ))}
              </select>
            </Field>
            {text('plan_version_id', t('sas.tenantCreate.plan.label'))}
            {text('code', t('sas.tenantCreate.code.label'))}
            <Field field="governing_body_type" label={t('sas.tenantCreate.governingBody.label')} error={errorOf('governing_body_type')}>
              <select id="tenant-governing_body_type" value={values.governing_body_type} onChange={(event) => set('governing_body_type', event.target.value)}>
                {GOVERNING_BODY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {governingBodyLabel(t, type)}
                  </option>
                ))}
              </select>
            </Field>
            {text('administrative_code', t('sas.tenantCreate.administrativeCode.label'))}
            {text('root_unit_name', t('sas.tenantCreate.rootUnit.label'))}
            {text('platform_subdomain', t('sas.tenantCreate.subdomain.label'))}
            {text('procurement_contract_ref', t('sas.tenantCreate.contractRef.label'))}
          </div>
          <div className="formfooter">
            <span className="sub">{t('sas.tenantCreate.hint')}</span>
            {canManage ? (
              <button type="submit" className="primary" disabled={provision.isPending}>
                {t('sas.tenantCreate.submit.action')}
              </button>
            ) : null}
          </div>
        </form>
      </div>
      <p className="prototype-note">{t('sas.tenantCreate.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
