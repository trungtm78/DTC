import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { useDefineDocType, useOpenRegister, useRegisters, useUnitOptions } from './registers/hooks';
import { directionLabel, fieldProblemMessage, modeLabel, problemMessage, symbolKindLabel } from './registers/labels';
import { describeProblem } from './registers/problems';
import { EMPTY_REGISTER_VALUES, EMPTY_TYPE_VALUES, registerBody, typeBody, validateRegisterForm, validateTypeForm } from './registers/rules';
import type { RegisterErrors, RegisterField, RegisterValues, TypeErrors, TypeField, TypeValues } from './registers/rules';
import { DIRECTIONS, MANAGE_REGISTERS_PERMISSION, MANAGE_TYPES_PERMISSION, REGISTER_MODES, SYMBOL_KINDS } from './registers/types';
import './registers/doc.css';

const NEVER_EMPTY = (): boolean => false;
const NO_FILTER = { year: '', direction: '' } as const;

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

/** DOC-21: defines the document types with the symbol pattern of their register and opens the number registers. */
export default function DocumentTypesScreen({ route }: ScreenProps) {
  const tenantId = useSession().tenant?.id;
  // Both drafts and the results of their mutations belong to one tenant: a switch starts the screen over, so a draft written
  // for tenant A can never be sent to tenant B.
  return <DocumentTypesContent key={tenantId ?? 'none'} route={route} />;
}

function DocumentTypesContent({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions, mode } = useSession();
  // A suspended tenant (READ_ONLY mode) is read-only for everyone, whatever the grants say.
  const frozen = mode === 'READ_ONLY';
  const canDefineTypes = (permissions === undefined || permissions.includes(MANAGE_TYPES_PERMISSION)) && !frozen;
  const canOpenRegisters = (permissions === undefined || permissions.includes(MANAGE_REGISTERS_PERMISSION)) && !frozen;
  const list = useRegisters(NO_FILTER);
  const units = useUnitOptions();
  const defineType = useDefineDocType();
  const openRegister = useOpenRegister();
  const [typeValues, setTypeValues] = useState<TypeValues>(EMPTY_TYPE_VALUES);
  const [typeErrors, setTypeErrors] = useState<TypeErrors>({});
  const [registerValues, setRegisterValues] = useState<RegisterValues>(EMPTY_REGISTER_VALUES);
  const [registerErrors, setRegisterErrors] = useState<RegisterErrors>({});
  const docTypes = useMemo(() => list.data?.pages[0]?.docTypes ?? [], [list.data]);
  const typeCodes = useMemo(() => [...new Set(docTypes.map((type) => type.code))], [docTypes]);
  const state = useScreenState({ isLoading: list.isLoading, error: list.error, data: list.data, isEmpty: NEVER_EMPTY });
  const typeProblem = defineType.isError ? describeProblem(defineType.error) : undefined;
  const registerProblem = openRegister.isError ? describeProblem(openRegister.error) : undefined;

  const setType = (field: TypeField, value: string): void => {
    setTypeValues((current) => ({ ...current, [field]: value }));
    setTypeErrors((current) => ({ ...current, [field]: undefined }));
  };
  const setRegister = (field: RegisterField, value: string): void => {
    setRegisterValues((current) => ({ ...current, [field]: value }));
    setRegisterErrors((current) => ({ ...current, [field]: undefined }));
  };
  const toggleScope = (code: string): void =>
    setRegisterValues((current) => ({
      ...current,
      scopeDocTypes: current.scopeDocTypes.includes(code) ? current.scopeDocTypes.filter((item) => item !== code) : [...current.scopeDocTypes, code],
    }));

  const submitType = (event: FormEvent): void => {
    event.preventDefault();
    if (defineType.isPending || !canDefineTypes) return;
    const errors = validateTypeForm(typeValues);
    setTypeErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // An accepted definition is done: the form empties, so a second click cannot send a second revision.
    defineType.mutate(typeBody(typeValues), { onSuccess: () => setTypeValues(EMPTY_TYPE_VALUES) });
  };

  const submitRegister = (event: FormEvent): void => {
    event.preventDefault();
    if (openRegister.isPending || !canOpenRegisters) return;
    const errors = validateRegisterForm(registerValues);
    setRegisterErrors(errors);
    if (Object.keys(errors).length > 0) return;
    openRegister.mutate(registerBody(registerValues), { onSuccess: () => setRegisterValues(EMPTY_REGISTER_VALUES) });
  };

  const typeError = (field: TypeField): string | undefined => {
    const own = typeErrors[field];
    return own === undefined ? undefined : fieldProblemMessage(t, own);
  };
  const registerError = (field: RegisterField): string | undefined => {
    const own = registerErrors[field];
    return own === undefined ? undefined : fieldProblemMessage(t, own);
  };
  const typeText = (field: Exclude<TypeField, 'symbolKind'>, label: string, type = 'text', hint?: string) => (
    <Field id={`type-${field}`} label={label} error={typeError(field)} hint={hint}>
      <input id={`type-${field}`} type={type} value={typeValues[field]} aria-invalid={typeError(field) !== undefined} onChange={(event) => setType(field, event.target.value)} />
    </Field>
  );

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('doc.types.page.title')}</h1>
          <p>{t('doc.types.page.subtitle')}</p>
        </div>
      </div>
      <StateBoundary state={state} onRetry={() => void list.refetch()}>
        <div className="doc-config">
          <div className="card">
            <h2>{t('doc.types.type.title')}</h2>
            {!canDefineTypes ? (
              <p className="callout warning" role="status">
                {frozen ? t('doc.types.frozen.notice') : t('doc.types.readOnly.notice')}
              </p>
            ) : null}
            {defineType.isSuccess ? (
              <p className="callout" role="status">
                {t('doc.types.type.accepted.notice')}
              </p>
            ) : null}
            {typeProblem === undefined ? null : (
              <p className="callout warning" role="alert">
                {problemMessage(t, typeProblem)}
              </p>
            )}
            <form onSubmit={submitType} noValidate aria-label={t('doc.types.type.title')}>
              <div className="formgrid">
                {typeText('code', t('doc.types.code.label'))}
                {typeText('name', t('doc.types.name.label'))}
                {typeText('abbreviation', t('doc.types.abbreviation.label'))}
                <Field id="type-symbolKind" label={t('doc.types.symbolKind.label')} error={undefined}>
                  <select id="type-symbolKind" value={typeValues.symbolKind} onChange={(event) => setType('symbolKind', event.target.value)}>
                    {SYMBOL_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {symbolKindLabel(t, kind)}
                      </option>
                    ))}
                  </select>
                </Field>
                {typeText('symbolPattern', t('doc.types.symbolPattern.label'), 'text', t('doc.types.symbolPattern.hint'))}
                {typeText('registerCode', t('doc.types.registerCode.label'))}
                {typeText('legalBasis', t('doc.types.legalBasis.label'))}
                {typeText('effectiveFrom', t('doc.types.effectiveFrom.label'), 'date')}
                {typeText('effectiveUntil', t('doc.types.effectiveUntil.label'), 'date')}
              </div>
              <div className="formfooter">
                <span className="sub">{t('doc.types.type.hint')}</span>
                {canDefineTypes ? (
                  <button type="submit" className="primary" disabled={defineType.isPending}>
                    {t('doc.types.type.submit.action')}
                  </button>
                ) : null}
              </div>
            </form>
            <h2>{t('doc.types.register.title')}</h2>
            {!canOpenRegisters ? (
              <p className="callout warning" role="status">
                {frozen ? t('doc.types.frozen.notice') : t('doc.types.registerReadOnly.notice')}
              </p>
            ) : null}
            {openRegister.isSuccess ? (
              <p className="callout" role="status">
                {t('doc.types.register.accepted.notice')}
              </p>
            ) : null}
            {registerProblem === undefined ? null : (
              <p className="callout warning" role="alert">
                {problemMessage(t, registerProblem)}
              </p>
            )}
            <form onSubmit={submitRegister} noValidate aria-label={t('doc.types.register.title')}>
              <div className="formgrid">
                <Field id="register-registerCode" label={t('doc.types.registerCode.label')} error={registerError('registerCode')}>
                  <input id="register-registerCode" value={registerValues.registerCode} aria-invalid={registerError('registerCode') !== undefined} onChange={(event) => setRegister('registerCode', event.target.value)} />
                </Field>
                <Field id="register-name" label={t('doc.types.registerName.label')} error={registerError('name')}>
                  <input id="register-name" value={registerValues.name} aria-invalid={registerError('name') !== undefined} onChange={(event) => setRegister('name', event.target.value)} />
                </Field>
                <Field id="register-direction" label={t('doc.types.direction.label')} error={undefined}>
                  <select id="register-direction" value={registerValues.direction} onChange={(event) => setRegister('direction', event.target.value)}>
                    {DIRECTIONS.map((direction) => (
                      <option key={direction} value={direction}>
                        {directionLabel(t, direction)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="register-organizationUnitId" label={t('doc.types.unit.label')} error={registerError('organizationUnitId')}>
                  <select id="register-organizationUnitId" value={registerValues.organizationUnitId} aria-invalid={registerError('organizationUnitId') !== undefined} onChange={(event) => setRegister('organizationUnitId', event.target.value)}>
                    <option value="">{units.isLoading ? t('doc.types.unit.loading') : t('doc.types.unit.placeholder')}</option>
                    {(units.data ?? []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} · {unit.name}
                      </option>
                    ))}
                  </select>
                  {units.isError ? (
                    <>
                      <small role="alert" className="field-error">
                        {t('doc.types.unit.failed')}
                      </small>
                      <button type="button" onClick={() => void units.refetch()} disabled={units.isFetching}>
                        {t('doc.types.unit.retry.action')}
                      </button>
                    </>
                  ) : null}
                </Field>
                <Field id="register-year" label={t('doc.types.year.label')} error={registerError('year')}>
                  <input id="register-year" inputMode="numeric" value={registerValues.year} aria-invalid={registerError('year') !== undefined} onChange={(event) => setRegister('year', event.target.value)} />
                </Field>
                <Field id="register-mode" label={t('doc.types.mode.label')} error={undefined}>
                  <select id="register-mode" value={registerValues.mode} onChange={(event) => setRegister('mode', event.target.value)}>
                    {REGISTER_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {modeLabel(t, mode)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <fieldset className="scope-types">
                <legend>{t('doc.types.scope.label')}</legend>
                {typeCodes.length === 0 ? <p className="sub">{t('doc.types.scope.empty')}</p> : null}
                {typeCodes.map((code) => (
                  <label key={code} className="check">
                    <input type="checkbox" checked={registerValues.scopeDocTypes.includes(code)} onChange={() => toggleScope(code)} />
                    {code}
                  </label>
                ))}
              </fieldset>
              <div className="formfooter">
                <span className="sub">{t('doc.types.register.hint')}</span>
                {canOpenRegisters ? (
                  <button type="submit" className="primary" disabled={openRegister.isPending}>
                    {t('doc.types.register.submit.action')}
                  </button>
                ) : null}
              </div>
            </form>
          </div>
          <aside className="card" aria-label={t('doc.types.context.title')}>
            <h2>{t('doc.types.context.title')}</h2>
            <p>{t('doc.types.rule.note')}</p>
            <h3>{t('doc.types.list.title')}</h3>
            {docTypes.length === 0 ? <p className="muted">{t('doc.types.list.empty')}</p> : null}
            <ul className="type-list">
              {docTypes.map((type) => (
                <li key={type.id} data-type-code={type.code}>
                  <strong>{type.code}</strong> · {type.name}
                  <div className="sub">
                    {type.symbolPattern} · {type.registerCode}
                  </div>
                  <div className="sub">{t('doc.types.list.period', { from: type.effectiveFrom, until: type.effectiveUntil ?? '' })}</div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </StateBoundary>
      <p className="prototype-note">{t('doc.types.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
