import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { businessToday } from './org-tree/business-date';
import { useOrgUnits, useUnitCommands } from './org-tree/hooks';
import { problemMessage } from './org-tree/labels';
import type { CreateUnitBody, UpdateUnitBody } from './org-tree/hooks';
import { MoveDialog } from './org-tree/MoveDialog';
import type { MoveValues } from './org-tree/MoveDialog';
import { describeProblem } from './org-tree/problems';
import type { ProblemView } from './org-tree/problems';
import { buildUnitTree, expandableIds } from './org-tree/tree-model';
import { MANAGE_UNITS_PERMISSION } from './org-tree/types';
import type { FormField, OrgUnit } from './org-tree/types';
import { changedFields, UnitForm } from './org-tree/UnitForm';
import type { FormValues } from './org-tree/UnitForm';
import { UnitTree } from './org-tree/UnitTree';
import './org-tree/org-tree.css';

type Mode = 'idle' | 'create' | 'edit';

// A refusal of a move names the create-form fields; the move dialog calls them by their own names.
const MOVE_FIELD: Readonly<Partial<Record<FormField, FormField>>> = { parent_id: 'new_parent_id', valid_from: 'effective_from' };

function createBody(values: FormValues): CreateUnitBody {
  return {
    code: values.code,
    name: values.name,
    parent_id: values.parent_id,
    unit_type: values.unit_type,
    valid_from: values.valid_from,
    ...(values.is_investor ? { is_investor: true } : {}),
    ...(values.administrative_code === '' ? {} : { administrative_code: values.administrative_code }),
    ...(values.legal_basis_ref === '' ? {} : { legal_basis_ref: values.legal_basis_ref }),
  };
}

/** ADM-01: the organisation tree of the tenant with its unit form (create, edit, move) inside the mockup's page frame. */
export default function OrgTreeScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions } = useSession();
  const units = useOrgUnits();
  const { create, update, move, refresh } = useUnitCommands();
  const state = useScreenState({ isLoading: units.isLoading, error: units.error, data: units.data });
  const readOnly = permissions !== undefined && !permissions.includes(MANAGE_UNITS_PERMISSION);

  const [asOf, setAsOf] = useState(() => businessToday());
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string> | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('idle');
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<ProblemView | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [formEpoch, setFormEpoch] = useState(0);

  const all = units.data ?? [];
  const forest = buildUnitTree(all, asOf);
  const expanded = expandedIds ?? expandableIds(forest);
  const selected = all.find((unit) => unit.id === selectedId);
  const pending = create.isPending || update.isPending || move.isPending;

  const clearFeedback = (): void => {
    setProblem(undefined);
    setNotice(undefined);
  };

  const toggle = (unitId: string): void => {
    const next = new Set(expanded);
    if (next.has(unitId)) next.delete(unitId);
    else next.add(unitId);
    setExpandedIds(next);
  };

  const select = (unitId: string): void => {
    clearFeedback();
    setSelectedId(unitId);
    setMode('edit');
    setMoving(false);
  };

  const fail = (error: unknown): void => {
    const view = describeProblem(error);
    setProblem(view);
    if (view.kind === 'conflict') void refresh();
  };

  const succeed = (message: string): void => {
    setProblem(undefined);
    setNotice(message);
  };

  const submitCreate = (values: FormValues): void => {
    if (pending) return;
    clearFeedback();
    create.mutate(createBody(values), {
      onSuccess: (result) => {
        succeed(t('adm.orgUnit.saved.notice'));
        const created = (result as { resource_id?: string }).resource_id;
        if (created !== undefined) setSelectedId(created);
        setMode('edit');
        setFormEpoch((epoch) => epoch + 1);
      },
      onError: fail,
    });
  };

  const submitUpdate = (unit: OrgUnit, values: FormValues): void => {
    if (pending) return;
    clearFeedback();
    update.mutate({ unit, body: changedFields(unit, values) as UpdateUnitBody }, { onSuccess: () => succeed(t('adm.orgUnit.saved.notice')), onError: fail });
  };

  const submitMove = (unit: OrgUnit, values: MoveValues): void => {
    if (pending) return;
    clearFeedback();
    move.mutate(
      { unit, body: values },
      {
        onSuccess: () => {
          succeed(t('adm.orgUnit.moved.notice'));
          setMoving(false);
          setFormEpoch((epoch) => epoch + 1);
        },
        onError: fail,
      },
    );
  };

  const reload = (): void => {
    setProblem(undefined);
    setFormEpoch((epoch) => epoch + 1);
    void refresh();
  };

  const messageOf = (view: ProblemView | undefined): string | undefined =>
    view === undefined ? undefined : problemMessage(t, view);
  const fieldErrors = (view: ProblemView | undefined, forMove: boolean): Partial<Record<FormField, string>> => {
    if (view?.field === undefined) return {};
    const field = forMove ? (MOVE_FIELD[view.field] ?? view.field) : view.field;
    return { [field]: problemMessage(t, view) };
  };

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('adm.orgUnit.page.title')}</h1>
          <p>{t('adm.orgUnit.page.subtitle')}</p>
        </div>
        {readOnly || state !== 'default' ? null : (
          <div className="actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                clearFeedback();
                setMode('create');
                setMoving(false);
                setFormEpoch((epoch) => epoch + 1);
              }}
            >
              {t('adm.orgUnit.create.action')}
            </button>
          </div>
        )}
      </div>
      <StateBoundary state={state} onRetry={() => void units.refetch()}>
        <div className="two">
          <div className="card">
            <div className="row between">
              <h2>{t('adm.orgUnit.tree.title')}</h2>
              <div className="field">
                <label htmlFor="as-of">{t('adm.orgUnit.asOf.label')}</label>
                <input id="as-of" type="date" value={asOf} onChange={(event) => event.target.value !== '' && setAsOf(event.target.value)} />
              </div>
            </div>
            <p className="sub">{t('adm.orgUnit.asOf.hint')}</p>
            <UnitTree forest={forest} expanded={expanded} onToggle={toggle} selectedId={selectedId} onSelect={select} />
          </div>
          <div className="card">
            <h2>{mode === 'create' ? t('adm.orgUnit.form.new.title') : t('adm.orgUnit.form.edit.title')}</h2>
            {notice === undefined ? null : <p className="callout" role="status">{notice}</p>}
            {mode === 'idle' || (mode === 'edit' && selected === undefined) ? (
              <p className="muted">{t('adm.orgUnit.form.idle.hint')}</p>
            ) : (
              <>
                <UnitForm
                  key={`${mode}-${mode === 'edit' ? selected?.id : 'new'}-${formEpoch}`}
                  mode={mode === 'create' ? 'create' : 'edit'}
                  unit={mode === 'edit' ? selected : undefined}
                  units={all}
                  defaultParentId={selectedId}
                  readOnly={readOnly}
                  pending={pending}
                  errors={moving ? {} : fieldErrors(problem, false)}
                  message={moving || problem?.kind === 'field' ? undefined : messageOf(problem)}
                  onSubmit={(values) => (mode === 'edit' && selected !== undefined ? submitUpdate(selected, values) : submitCreate(values))}
                  onMove={() => {
                    clearFeedback();
                    setMoving(true);
                  }}
                />
                {problem?.kind === 'conflict' && !moving ? (
                  <button type="button" onClick={reload}>
                    {t('adm.orgUnit.conflict.reload')}
                  </button>
                ) : null}
                {moving && selected !== undefined ? (
                  <MoveDialog
                    key={`move-${selected.id}-${formEpoch}`}
                    unit={selected}
                    units={all}
                    pending={pending}
                    errors={fieldErrors(problem, true)}
                    message={problem?.kind === 'field' ? undefined : messageOf(problem)}
                    onSubmit={(values) => submitMove(selected, values)}
                    onCancel={() => {
                      clearFeedback();
                      setMoving(false);
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
      </StateBoundary>
      <p className="prototype-note">{t('adm.orgUnit.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
