import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { useCreatePolicyDraft, usePolicies, usePublishPolicy, useRoleCodes } from './security/hooks';
import { policyFieldMessage, policyProblemMessage, policyStatusLabel } from './security/labels';
import {
  APPROVE_POLICY_PERMISSION,
  DRAFT_POLICY_PERMISSION,
  EMPTY_POLICY_VALUES,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  describeProblem,
  policyBody,
  validatePolicy,
  valuesOfPolicy,
} from './security/model';
import type { PolicyErrors, PolicyField, PolicyValues, PolicyView } from './security/model';
import './security/security.css';

const NEVER_EMPTY = (): boolean => false;

interface FieldProps {
  id: string;
  label: string;
  error: string | undefined;
  hint?: string;
  children: ReactNode;
}

function Field({ id, label, error, hint, children }: FieldProps) {
  return (
    <div className="field" data-field={id}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint === undefined ? null : <small className="sub">{hint}</small>}
      {error === undefined ? null : (
        <small role="alert" className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

/** ADM-14: the versioned tenant security policy (ST-ADM-009): a draft by one administrator, published by another. */
export default function SecurityPolicyScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions, tenant } = useSession();
  const canDraft = permissions === undefined || permissions.includes(DRAFT_POLICY_PERMISSION);
  const canApprove = permissions === undefined || permissions.includes(APPROVE_POLICY_PERMISSION);
  const list = usePolicies();
  const roles = useRoleCodes();
  const create = useCreatePolicyDraft();
  const publish = usePublishPolicy();
  const [values, setValues] = useState<PolicyValues>(EMPTY_POLICY_VALUES);
  const [errors, setErrors] = useState<PolicyErrors>({});
  const [publishing, setPublishing] = useState<string | undefined>(undefined);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const policies = useMemo(() => list.data ?? [], [list.data]);
  const inForce = policies.find((policy) => policy.status === 'Published');
  const state = useScreenState({ isLoading: list.isLoading, error: list.error, data: list.data, isEmpty: NEVER_EMPTY });
  const createProblem = create.isError ? describeProblem(create.error) : undefined;
  const publishProblem = publish.isError ? describeProblem(publish.error) : undefined;

  const setField = (field: PolicyField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const toggleRole = (code: string): void =>
    setValues((current) => ({
      ...current,
      mfaRequiredRoles: current.mfaRequiredRoles.includes(code) ? current.mfaRequiredRoles.filter((role) => role !== code) : [...current.mfaRequiredRoles, code],
    }));
  const fieldError = (field: PolicyField): string | undefined => {
    const own = errors[field];
    return own === undefined ? undefined : policyFieldMessage(t, own);
  };

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (create.isPending || !canDraft) return;
    const found = validatePolicy(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    // An accepted draft is done: a second click cannot create a second revision of the same text.
    create.mutate(policyBody(values));
  };

  const confirmPublish = (event: FormEvent, policy: PolicyView): void => {
    event.preventDefault();
    if (publish.isPending) return;
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN_LENGTH || trimmed.length > REASON_MAX_LENGTH) {
      setReasonError(true);
      return;
    }
    publish.mutate({ id: policy.id, version: policy.version, reason: trimmed }, { onSuccess: () => setPublishing(undefined) });
  };

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('adm.securityPolicy.page.title')}</h1>
          <p>{t('adm.securityPolicy.page.subtitle')}</p>
        </div>
      </div>
      <StateBoundary state={state} onRetry={() => void list.refetch()}>
        <div className="adm-security">
          <div className="card">
            <h2>{t('adm.securityPolicy.form.title')}</h2>
            {!canDraft ? (
              <p className="callout warning" role="status">
                {t('adm.securityPolicy.readOnly.notice')}
              </p>
            ) : null}
            {create.isSuccess ? (
              <p className="callout" role="status">
                {t('adm.securityPolicy.draft.accepted.notice')}
              </p>
            ) : null}
            {createProblem === undefined ? null : (
              <p className="callout warning" role="alert">
                {policyProblemMessage(t, createProblem)}
              </p>
            )}
            <form onSubmit={submit} noValidate aria-label={t('adm.securityPolicy.form.title')}>
              <fieldset className="scope-types">
                <legend>{t('adm.securityPolicy.mfa.legend')}</legend>
                {(roles.data ?? []).map((code) => (
                  <label key={code} className="check">
                    <input type="checkbox" checked={values.mfaRequiredRoles.includes(code)} onChange={() => toggleRole(code)} />
                    {code}
                  </label>
                ))}
                <small className="sub">{t('adm.securityPolicy.mfa.hint')}</small>
              </fieldset>
              <div className="formgrid">
                <Field id="policy-sessionIdleMinutes" label={t('adm.securityPolicy.idle.label')} error={fieldError('sessionIdleMinutes')}>
                  <input id="policy-sessionIdleMinutes" inputMode="numeric" value={values.sessionIdleMinutes} aria-invalid={fieldError('sessionIdleMinutes') !== undefined} onChange={(event) => setField('sessionIdleMinutes', event.target.value)} />
                </Field>
                <Field id="policy-sessionMaxHours" label={t('adm.securityPolicy.hours.label')} error={fieldError('sessionMaxHours')}>
                  <input id="policy-sessionMaxHours" inputMode="numeric" value={values.sessionMaxHours} aria-invalid={fieldError('sessionMaxHours') !== undefined} onChange={(event) => setField('sessionMaxHours', event.target.value)} />
                </Field>
                <Field id="policy-downloadTtlMinutes" label={t('adm.securityPolicy.ttl.label')} error={fieldError('downloadTtlMinutes')}>
                  <input id="policy-downloadTtlMinutes" inputMode="numeric" value={values.downloadTtlMinutes} aria-invalid={fieldError('downloadTtlMinutes') !== undefined} onChange={(event) => setField('downloadTtlMinutes', event.target.value)} />
                </Field>
              </div>
              <Field id="policy-ipAllowlist" label={t('adm.securityPolicy.ip.label')} error={fieldError('ipAllowlist')} hint={t('adm.securityPolicy.ip.hint')}>
                <textarea id="policy-ipAllowlist" rows={4} spellCheck={false} value={values.ipAllowlist} aria-invalid={fieldError('ipAllowlist') !== undefined} onChange={(event) => setField('ipAllowlist', event.target.value)} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={values.exportWatermark} onChange={(event) => setValues((current) => ({ ...current, exportWatermark: event.target.checked }))} />
                {t('adm.securityPolicy.watermark.label')}
              </label>
              <div className="formfooter">
                <span className="sub">{t('adm.securityPolicy.form.hint')}</span>
                {inForce === undefined ? null : (
                  <button type="button" onClick={() => setValues(valuesOfPolicy(inForce))}>
                    {t('adm.securityPolicy.copy.action')}
                  </button>
                )}
                {canDraft ? (
                  <button type="submit" className="primary" disabled={create.isPending}>
                    {t('adm.securityPolicy.draft.submit.action')}
                  </button>
                ) : null}
              </div>
            </form>
            <h2>{t('adm.securityPolicy.history.title')}</h2>
            {policies.length === 0 ? <p className="muted">{t('adm.securityPolicy.history.empty')}</p> : null}
            {publish.isSuccess ? (
              <p className="callout" role="status">
                {t('adm.securityPolicy.publish.accepted.notice')}
              </p>
            ) : null}
            {publishProblem === undefined ? null : (
              <p className="callout warning" role="alert">
                {policyProblemMessage(t, publishProblem)}
              </p>
            )}
            {policies.length === 0 ? null : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('adm.securityPolicy.col.revision')}</th>
                    <th>{t('adm.securityPolicy.col.status')}</th>
                    <th>{t('adm.securityPolicy.col.roles')}</th>
                    <th>{t('adm.securityPolicy.col.session')}</th>
                    <th>
                      <span className="sr-only">{t('adm.securityPolicy.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((policy) => {
                    const ownDraft = policy.createdBy === tenant?.membershipId;
                    return (
                      <tr key={policy.id} data-policy-id={policy.id} data-status={policy.status}>
                        <td>#{policy.revision}</td>
                        <td>{policyStatusLabel(t, policy.status)}</td>
                        <td>{policy.mfaRequiredRoles.join(', ')}</td>
                        <td>{t('adm.securityPolicy.session.summary', { idle: policy.sessionIdleMinutes, hours: policy.sessionMaxHours })}</td>
                        <td className="row-actions">
                          {policy.status === 'Draft' && canApprove && publishing !== policy.id ? (
                            <button type="button" disabled={ownDraft} title={ownDraft ? t('adm.securityPolicy.publish.selfApproval.hint') : undefined} onClick={() => { setPublishing(policy.id); setReason(''); setReasonError(false); }}>
                              {t('adm.securityPolicy.publish.action')}
                            </button>
                          ) : null}
                          {publishing === policy.id ? (
                            <form onSubmit={(event) => confirmPublish(event, policy)} noValidate aria-label={t('adm.securityPolicy.publish.action')}>
                              <Field id={`publish-reason-${policy.id}`} label={t('adm.securityPolicy.publish.reason.label')} error={reasonError ? t('adm.securityPolicy.field.required') : undefined}>
                                <input id={`publish-reason-${policy.id}`} value={reason} aria-invalid={reasonError} onChange={(event) => { setReason(event.target.value); setReasonError(false); }} />
                              </Field>
                              <button type="submit" className="primary" disabled={publish.isPending}>
                                {t('adm.securityPolicy.publish.confirm.action')}
                              </button>
                              <button type="button" onClick={() => setPublishing(undefined)}>
                                {t('adm.securityPolicy.publish.cancel.action')}
                              </button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <aside className="card" aria-label={t('adm.securityPolicy.current.title')}>
            <h2>{t('adm.securityPolicy.current.title')}</h2>
            {inForce === undefined ? (
              <p className="muted" data-testid="no-policy">{t('adm.securityPolicy.current.none')}</p>
            ) : (
              <dl data-testid="policy-in-force">
                <dt>{t('adm.securityPolicy.col.revision')}</dt>
                <dd>#{inForce.revision}</dd>
                <dt>{t('adm.securityPolicy.col.roles')}</dt>
                <dd>{inForce.mfaRequiredRoles.length === 0 ? t('adm.securityPolicy.current.noRoles') : inForce.mfaRequiredRoles.join(', ')}</dd>
                <dt>{t('adm.securityPolicy.col.session')}</dt>
                <dd>{t('adm.securityPolicy.session.summary', { idle: inForce.sessionIdleMinutes, hours: inForce.sessionMaxHours })}</dd>
              </dl>
            )}
            <p className="callout" role="note">
              {t('adm.securityPolicy.enforcement.note')}
            </p>
          </aside>
        </div>
      </StateBoundary>
      <p className="prototype-note">{t('adm.securityPolicy.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
