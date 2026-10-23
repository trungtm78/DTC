import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from '../../../i18n';
import type { ScreenProps } from '../../../routes/types';
import { useSession } from '../../../session/SessionContext';
import { StateBoundary } from '../../../states/StateBoundary';
import { useScreenState } from '../../../states/useScreenState';
import { useTenantList } from '../tenants/hooks';
import type { TenantSummary } from '../tenants/types';
import { draftKey, useMyPublishedTheme, useSaveDraft, useThemeDraft, useThemeVersions, useUploadLogo, versionsKey } from './hooks';
import { describeProblem, problemMessage } from './labels';
import { PreviewFrame } from './PreviewFrame';
import type { PreviewMode } from './preview';
import { ReviewDialog } from './ReviewDialog';
import type { ReviewTarget } from './ReviewDialog';
import { applyPreset, clampText, colourOrKeep, sameTheme, themeIssues } from './rules';
import { ThemeForm } from './ThemeForm';
import { LOGO_MAX_BYTES, LOGO_TYPES, MANAGE_THEME_PERMISSION } from './types';
import type { ThemeConfig, ThemeDraft, ThemeVersion } from './types';
import './theme.css';

const FIRST_VERSION = 1;

type StatusKey = 'saved' | 'discarded' | 'preset' | 'logoRemoved' | 'logoAdded' | 'published' | 'restored';

function PreviewPanel({ config, mode, onMode, label, note }: { config: ThemeConfig; mode: PreviewMode; onMode(mode: PreviewMode): void; label: string; note: string }) {
  const { t } = useTranslation();
  return (
    <section className="theme-preview-panel">
      <div className="theme-preview-tools">
        <div>
          <strong>{t('sas.theme.preview.title')}</strong>
          <div className="theme-preview-label">{label}</div>
        </div>
        <select aria-label={t('sas.theme.preview.platform.label')} value={mode} onChange={(event) => onMode(event.target.value === 'phone' ? 'phone' : 'web')}>
          <option value="web">{t('sas.theme.preview.platform.web')}</option>
          <option value="phone">{t('sas.theme.preview.platform.phone')}</option>
        </select>
      </div>
      <div className={`theme-preview-canvas${mode === 'phone' ? ' phone' : ''}`}>
        <PreviewFrame id="tenant-theme-preview" config={config} mode={mode} title={t('sas.theme.preview.frame.title')} />
      </div>
      <p className="theme-preview-note">{note}</p>
    </section>
  );
}

/** The tenant the editor works on: the registry as a list, as SAS-25 offers it. */
function TenantPicker({ options, chosen, onChoose, more }: { options: readonly Pick<TenantSummary, 'id' | 'name' | 'code'>[]; chosen: string | undefined; onChoose(id: string): void; more: MoreTenants }) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="theme-tenant">{t('sas.theme.tenant.label')}</label>
      <select id="theme-tenant" value={chosen ?? ''} onChange={(event) => onChoose(event.target.value)}>
        {options.map((tenant) => (
          <option key={tenant.id} value={tenant.id}>
            {tenant.code === '' ? tenant.name : `${tenant.name} (${tenant.code})`}
          </option>
        ))}
      </select>
      {more === undefined ? null : (
        <button type="button" disabled={more.pending} onClick={more.load}>
          {t('sas.theme.tenant.more.action')}
        </button>
      )}
    </>
  );
}
interface MoreTenantsPage {
  pending: boolean;
  load(): void;
}
type MoreTenants = MoreTenantsPage | undefined;

interface EditorProps {
  tenantId: string;
  tenantName: string;
  draft: ThemeDraft;
  versions: readonly ThemeVersion[];
  hasMoreVersions: boolean;
  loadMoreVersions(): void;
  loadingMoreVersions: boolean;
  picker: ReactNode;
  /** The editor tells the screen whether it holds changes that are not saved (the tenant picker asks before it leaves them). */
  dirtyRef: MutableRefObject<boolean>;
  locked: boolean;
  onStale(): void;
}

/** The editor of one tenant: the form, the isolated preview, the review and the history of versions. */
function ThemeEditor({ tenantId, tenantName, draft, versions, hasMoreVersions, loadMoreVersions, loadingMoreVersions, picker, dirtyRef, locked, onStale }: EditorProps) {
  const { t, locale } = useTranslation();
  const save = useSaveDraft();
  const upload = useUploadLogo();
  const [form, setForm] = useState<ThemeConfig>(draft.config);
  const [saved, setSaved] = useState<ThemeConfig>(draft.config);
  const [revision, setRevision] = useState(draft.revision);
  const [mode, setMode] = useState<PreviewMode>('web');
  const [status, setStatus] = useState<StatusKey | undefined>(undefined);
  const [statusVersion, setStatusVersion] = useState<number | undefined>(undefined);
  const [logoName, setLogoName] = useState<string | undefined>(undefined);
  const [logoProblem, setLogoProblem] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<ReviewTarget | undefined>(undefined);
  const published = versions[0];

  const issues = useMemo(() => themeIssues(form), [form]);
  const dirty = !sameTheme(form, saved);
  dirtyRef.current = dirty;
  // Once this editor is gone (its tenant could not be read) nothing is left unsaved for the tenant picker to ask about.
  useEffect(
    () => () => {
      dirtyRef.current = false;
    },
    [dirtyRef],
  );
  // What the preview shows is the last theme that passed the checks: a rejected draft is never applied to it.
  const lastValid = useRef<ThemeConfig>(draft.config);
  if (issues.length === 0) lastValid.current = form;
  const failure = save.isError ? describeProblem(save.error) : undefined;
  // What the server found wrong that this form did not (it judges again), shown with the findings of the form.
  const serverIssues = (failure?.issues ?? []).filter((server) => !issues.some((local) => local.kind === server.kind && local.token === server.token));

  // A new value, or a change of the form as it is when the change lands (an upload ends while the person keeps typing).
  const change = (next: ThemeConfig | ((current: ThemeConfig) => ThemeConfig)): void => {
    setForm(next);
    setStatus(undefined);
    save.reset();
  };

  const saveDraft = async (): Promise<number | undefined> => {
    if (issues.length > 0 || locked) return undefined;
    try {
      const result = await save.mutateAsync({ tenantId, revision, config: form });
      setRevision(result.revision);
      setSaved(result.config);
      setStatus('saved');
      return result.revision;
    } catch {
      return undefined;
    }
  };

  const review = async (): Promise<void> => {
    const draftRevision = dirty ? await saveDraft() : revision;
    if (draftRevision === undefined || draftRevision < FIRST_VERSION) return;
    setTarget({ kind: 'draft', draftRevision });
  };

  const discard = (): void => {
    if (dirty && !window.confirm(t('sas.theme.discard.confirm'))) return;
    setForm(saved);
    setStatus('discarded');
    save.reset();
  };

  const chooseLogo = (file: File): void => {
    setLogoProblem(undefined);
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoProblem(problemMessage(t, 'fileType'));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoProblem(problemMessage(t, 'tooLarge'));
      return;
    }
    upload.mutate(
      { tenantId, file },
      {
        onSuccess: (asset) => {
          change((current) => ({ ...current, logoAssetId: asset.assetId }));
          setLogoName(file.name);
          setStatus('logoAdded');
        },
        onError: (error) => setLogoProblem(problemMessage(t, describeProblem(error).kind)),
      },
    );
  };

  const dateOf = (value: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value));
  const statusText = status === undefined ? '' : statusSentence(t, status, statusVersion);

  return (
    <div className="theme-editor">
      <section className="theme-settings">
        <h2>{t('sas.theme.scope.title')}</h2>
        {picker}
        <p className="theme-help">{published === undefined ? '' : t('sas.theme.tenant.version.text', { version: published.version })}</p>
        <ThemeForm
          config={form}
          readOnly={locked}
          issues={[...issues, ...serverIssues]}
          logoName={logoName}
          logoPending={upload.isPending}
          logoProblem={logoProblem}
          onText={(field, value) => change({ ...form, [field]: clampText(field, value) })}
          onColour={(key, value) => change({ ...form, [key]: colourOrKeep(value, form[key]) })}
          onPreset={(preset) => {
            change(applyPreset(form, preset));
            setStatus('preset');
          }}
          onLogo={chooseLogo}
          onRemoveLogo={() => {
            change({ ...form, logoAssetId: null });
            setLogoName(undefined);
            setStatus('logoRemoved');
          }}
          actions={
            <div className="theme-editor-actions">
              <button type="button" disabled={issues.length > 0 || !dirty || save.isPending} onClick={() => void saveDraft()}>
                {t('sas.theme.save.action')}
              </button>
              <button type="button" disabled={!dirty} onClick={discard}>
                {t('sas.theme.discard.action')}
              </button>
              <button type="button" className="primary" disabled={issues.length > 0 || save.isPending || published === undefined || (!dirty && revision < FIRST_VERSION)} onClick={() => void review()}>
                {t('sas.theme.review.action')}
              </button>
            </div>
          }
        />
        <div className="theme-status" role="status">
          {statusText}
        </div>
        {failure === undefined ? null : (
          <div className="callout warning" role="alert" data-problem={failure.kind}>
            <p>{problemMessage(t, failure.kind)}</p>
            {failure.kind === 'conflict' ? (
              <button type="button" onClick={onStale}>
                {t('sas.theme.error.reload.action')}
              </button>
            ) : null}
          </div>
        )}
        <h2>{t('sas.theme.history.title')}</h2>
        {versions.map((version, index) => (
          <article className="theme-version" key={version.version} data-version={version.version}>
            <strong>
              {t('sas.theme.history.version.label', { version: version.version })}
              {index === 0 ? ` · ${t('sas.theme.history.current.label')}` : ''}
            </strong>
            <p>
              {version.sourceVersion !== null
                ? t('sas.theme.history.restored.text', { version: version.sourceVersion })
                : version.version === FIRST_VERSION
                  ? t('sas.theme.history.initial.text')
                  : t('sas.theme.history.published.text')}{' '}
              · {dateOf(version.publishedAt)}
            </p>
            {index === 0 || locked ? null : (
              <button type="button" onClick={() => setTarget({ kind: 'restore', sourceVersion: version.version })}>
                {t('sas.theme.history.restore.action', { version: version.version })}
              </button>
            )}
          </article>
        ))}
        {hasMoreVersions ? (
          <button type="button" disabled={loadingMoreVersions} onClick={loadMoreVersions}>
            {t('sas.theme.history.more.action')}
          </button>
        ) : null}
      </section>
      <PreviewPanel config={lastValid.current} mode={mode} onMode={setMode} label={t('sas.theme.preview.draft.label')} note={t('sas.theme.preview.note.long')} />
      {target === undefined || published === undefined ? null : (
        <ReviewDialog
          tenantId={tenantId}
          tenantName={tenantName}
          baseVersion={published.version}
          target={target}
          onClose={() => setTarget(undefined)}
          onPublished={(version) => {
            setTarget(undefined);
            // Publishing the draft clears it on the server: the next draft starts again at revision 0. A restore leaves the draft alone.
            if (target.kind === 'draft') setRevision(0);
            setStatus(target.kind === 'restore' ? 'restored' : 'published');
            setStatusVersion(version.version);
          }}
          onStale={() => {
            setTarget(undefined);
            onStale();
          }}
        />
      )}
    </div>
  );
}

function statusSentence(t: ReturnType<typeof useTranslation>['t'], status: StatusKey, version: number | undefined): string {
  switch (status) {
    case 'saved':
      return t('sas.theme.status.saved.text');
    case 'discarded':
      return t('sas.theme.status.discarded.text');
    case 'preset':
      return t('sas.theme.status.preset.text');
    case 'logoRemoved':
      return t('sas.theme.status.logoRemoved.text');
    case 'logoAdded':
      return t('sas.theme.status.logoAdded.text');
    case 'published':
      return t('sas.theme.status.published.text', { version: version ?? 0 });
    case 'restored':
      return t('sas.theme.status.restored.text', { version: version ?? 0 });
  }
}

/** A System Admin edits the theme of the tenant they picked. */
function ManageTheme() {
  const { t } = useTranslation();
  const { mode: sessionMode, tenant: sessionTenant } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [reload, setReload] = useState(0);
  const tenants = useTenantList(true);
  const loaded = useMemo(() => tenants.data?.pages.flatMap((page) => page.items) ?? [], [tenants.data]);
  const chosen = params.get('tenant') ?? loaded[0]?.id;
  // A tenant named in the address may lie beyond the pages loaded so far: it still has an option, so the select shows what is read.
  const options = chosen !== undefined && !loaded.some((tenant) => tenant.id === chosen) ? [...loaded, { id: chosen, name: chosen, code: '' }] : loaded;
  const draft = useThemeDraft(chosen, chosen !== undefined);
  const versions = useThemeVersions(chosen, chosen !== undefined);
  const items = useMemo(() => versions.data?.pages.flatMap((page) => page.items) ?? [], [versions.data]);
  const waitingForTenants = chosen === undefined && tenants.isLoading;
  const failing = chosen === undefined ? tenants.error : (draft.error ?? versions.error);
  const state = useScreenState({
    isLoading: waitingForTenants || (chosen !== undefined && (draft.isLoading || versions.isLoading)),
    error: failing,
    data: chosen === undefined ? undefined : draft.data !== undefined && versions.data !== undefined ? draft.data : undefined,
    isEmpty: () => false,
  });
  const name = options.find((tenant) => tenant.id === chosen)?.name ?? chosen ?? '';
  const dirtyRef = useRef(false);
  const choose = (id: string): void => {
    if (dirtyRef.current && !window.confirm(t('sas.theme.tenant.switch.confirm'))) return;
    setParams({ tenant: id });
  };
  const more = tenants.hasNextPage ? { pending: tenants.isFetchingNextPage, load: () => void tenants.fetchNextPage() } : undefined;
  const picker = <TenantPicker options={options} chosen={chosen} onChoose={choose} more={more} />;

  // Both reads are fresh before the editor is rebuilt: it starts from the draft and the versions it is given and never follows them later.
  const stale = (): void => {
    if (chosen === undefined) return;
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: draftKey(sessionTenant?.id, chosen) }),
      queryClient.invalidateQueries({ queryKey: versionsKey(sessionTenant?.id, chosen) }),
    ]).then(() => setReload((count) => count + 1));
  };

  // The picker lives in the editor while the theme is shown. When the chosen tenant's theme cannot be shown, the picker stays on the
  // screen outside the boundary, so a tenant-specific failure never blocks the access to the other tenants.
  const pickerAlone = (state === 'error' || state === 'denied' || state === 'offline' || state === 'empty') && options.length > 0;

  return (
    <>
      {pickerAlone ? (
        <section className="theme-settings">
          <h2>{t('sas.theme.scope.title')}</h2>
          {picker}
        </section>
      ) : null}
      <StateBoundary
        state={state}
        onRetry={() => {
          void (chosen === undefined ? tenants.refetch() : Promise.all([draft.refetch(), versions.refetch()]));
        }}
      >
        {chosen === undefined || draft.data === undefined ? null : (
          <ThemeEditor
            key={`${chosen}:${reload}`}
            tenantId={chosen}
            tenantName={name}
            draft={draft.data}
            versions={items}
            hasMoreVersions={versions.hasNextPage}
            loadMoreVersions={() => void versions.fetchNextPage()}
            loadingMoreVersions={versions.isFetchingNextPage}
            picker={picker}
            dirtyRef={dirtyRef}
            locked={sessionMode === 'READ_ONLY'}
            onStale={stale}
          />
        )}
      </StateBoundary>
    </>
  );
}

/** Anyone else sees the published theme of their own tenant and nothing to change. */
function ReadTheme() {
  const { t } = useTranslation();
  const published = useMyPublishedTheme(true);
  const [mode, setMode] = useState<PreviewMode>('web');
  const state = useScreenState({ isLoading: published.isLoading, error: published.error, data: published.data, isEmpty: () => false });
  const noop = (): void => undefined;
  const config = published.data?.config;
  return (
    <StateBoundary state={state} onRetry={() => void published.refetch()}>
      {config === undefined ? null : (
        <div className="theme-editor">
          <section className="theme-settings">
            <h2>{t('sas.theme.scope.title')}</h2>
            <p className="theme-help">{t('sas.theme.tenant.version.text', { version: published.data?.version ?? 0 })}</p>
            <ThemeForm config={config} readOnly issues={[]} logoName={undefined} logoPending={false} logoProblem={undefined} onText={noop} onColour={noop} onPreset={noop} onLogo={noop} onRemoveLogo={noop} actions={null} />
          </section>
          <PreviewPanel config={config} mode={mode} onMode={setMode} label={t('sas.theme.preview.published.label')} note={t('sas.theme.preview.note.long')} />
        </div>
      )}
    </StateBoundary>
  );
}

/**
 * SAS-04: the theme and branding of a tenant. A System Admin edits a draft, sees it in a frame that cannot leak into the
 * application, reviews what changes against the published version and publishes it (or restores an older version, with
 * a reason); every other role sees the published theme of the own tenant, read-only (ST-SAS-005, SAS 3.12).
 */
export default function ThemeScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  const { permissions } = useSession();
  const canManage = permissions?.includes(MANAGE_THEME_PERMISSION) === true;
  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('sas.theme.page.title')}</h1>
          <p>{t('sas.theme.page.subtitle')}</p>
        </div>
      </div>
      <div className="callout" role="note">
        {canManage ? t('sas.theme.callout.manage.text') : t('sas.theme.callout.readOnly.text')}
      </div>
      {canManage ? <ManageTheme /> : <ReadTheme />}
      <p className="prototype-note">{t('sas.theme.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
