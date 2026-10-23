import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { queueItems, useCompleteSigning, useDownloadUrl, useOutgoingDocument, useOutgoingQueue, useStartLeaderSigning } from './outgoing/hooks';
import { adapterLabel, checkTitle, factText, problemMessage, stageLabel, stateLabel, statusLabel } from './outgoing/labels';
import { describeProblem } from './outgoing/problems';
import type { ProblemContext } from './outgoing/problems';
import { activeCertificates, canStartSigning, currentVersion, minutesLeft, openSessionOf, signerOf, signingChecks } from './outgoing/rules';
import type { CheckState } from './outgoing/rules';
import { SIGN_OUTGOING_PERMISSION } from './outgoing/types';
import './outgoing/outgoing.css';

const SHORT_CHECKSUM = 12;
const PILL_CLASS: Readonly<Record<CheckState, string>> = { pass: 'pill', review: 'pill warn', fail: 'pill red', none: 'pill gray' };
const ADAPTER_CHOICES = ['REMOTE_CA', 'LOCAL_AGENT'] as const;
type AdapterChoice = (typeof ADAPTER_CHOICES)[number] | '';

/** DOC-05: the leader signs the final PDF of a submitted document; the signing provider receives the hash only. */
export default function SigningSessionScreen({ route }: ScreenProps) {
  const tenantId = useSession().tenant?.id;
  // The certificate, the confirmation code and the file address belong to one tenant: a switch starts the screen over.
  return <SigningSessionContent key={tenantId ?? 'none'} route={route} />;
}

function SigningSessionContent({ route }: ScreenProps) {
  const { t, locale } = useTranslation();
  const { permissions, tenant, mode } = useSession();
  const [params, setParams] = useSearchParams();
  // A suspended tenant (READ_ONLY mode) is read-only for everyone, whatever the grants say.
  const frozen = mode === 'READ_ONLY';
  const canSign = (permissions === undefined || permissions.includes(SIGN_OUTGOING_PERMISSION)) && !frozen;
  const [certificateId, setCertificateId] = useState('');
  const [adapter, setAdapter] = useState<AdapterChoice>('');
  const [docmdp, setDocmdp] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [context, setContext] = useState<ProblemContext>('start');
  const [signedId, setSignedId] = useState<string | undefined>(undefined);
  // The address of a file belongs to the version it was asked for: it is shown next to that version only.
  const [file, setFile] = useState<{ versionId: string; url: string } | undefined>(undefined);
  const queue = useOutgoingQueue('SUBMITTED');
  const queued = useMemo(() => queueItems(queue.data), [queue.data]);
  const selectedId = params.get('doc') ?? queued[0]?.id;
  const detail = useOutgoingDocument(selectedId);
  const start = useStartLeaderSigning();
  const complete = useCompleteSigning();
  const download = useDownloadUrl();
  const now = new Date();
  const timeOf = (value: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value));
  const listState = useScreenState({ isLoading: queue.isLoading, error: queue.error, data: queue.data === undefined ? undefined : queued });
  const detailState = useScreenState({ isLoading: detail.isLoading, error: detail.error, data: detail.data });
  const state = selectedId === undefined ? listState : detailState;
  const doc = detail.data;
  const certificates = doc === undefined ? [] : activeCertificates(doc, 'PERSONAL');
  const chosen = certificates.find((certificate) => certificate.id === certificateId) ?? certificates[0];
  const checks = doc === undefined ? [] : signingChecks(doc, now, chosen);
  const open = doc === undefined ? undefined : openSessionOf(doc, 'LEADER', now);
  const failure = context === 'start' ? start.error : complete.error;
  const problem = (context === 'start' ? start.isError : complete.isError) ? describeProblem(failure, context) : undefined;
  const version = doc === undefined ? undefined : currentVersion(doc);
  const mine = doc !== undefined && doc.signerUserId === tenant?.membershipId;

  const choose = (id: string): void => {
    setParams({ doc: id });
    setSignedId(undefined);
    setFile(undefined);
    start.reset();
    complete.reset();
  };

  const submitStart = (event: FormEvent): void => {
    event.preventDefault();
    if (doc === undefined || start.isPending || !canSign) return;
    setContext('start');
    setSignedId(undefined);
    setParams({ doc: doc.id });
    start.mutate({ documentId: doc.id, version: doc.version, certificateId: chosen?.id, adapterCode: adapter === '' ? undefined : adapter, certifyDocmdp: docmdp });
  };

  const submitComplete = (event: FormEvent): void => {
    event.preventDefault();
    if (doc === undefined || open === undefined || complete.isPending || !canSign) return;
    setContext('complete');
    // The document leaves the SUBMITTED queue when it is signed: its id is kept in the address so the screen stays on it and
    // can show the outcome, instead of moving to whichever document comes first.
    setParams({ doc: doc.id });
    complete.mutate({ sessionId: open.id, version: open.version, confirmation: confirmation.trim() }, { onSuccess: () => setSignedId(doc.id) });
  };

  const openFile = (): void => {
    if (version === undefined) return;
    const asked = version.id;
    download.mutate(asked, { onSuccess: (url) => setFile({ versionId: asked, url }) });
  };

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('doc.signing.page.title')}</h1>
          <p>{t('doc.signing.page.subtitle')}</p>
        </div>
      </div>
      <div className="two">
        <div className="card">
          <h2>{t('doc.signing.store.title')}</h2>
          {queued.length === 0 ? null : (
            <div className="field">
              <label htmlFor="signing-document">{t('doc.signing.queue.label')}</label>
              <select id="signing-document" value={selectedId ?? ''} onChange={(event) => choose(event.target.value)}>
                {queued.map((row) => (
                  <option key={row.id} value={row.id}>
                    {t('doc.signing.queue.option.text', { title: row.title, signer: row.signerTitle ?? '' })}
                  </option>
                ))}
                {doc !== undefined && !queued.some((row) => row.id === doc.id) ? (
                  <option value={doc.id}>{t('doc.signing.queue.option.text', { title: doc.title, signer: doc.signerTitle ?? '' })}</option>
                ) : null}
              </select>
              {queue.hasNextPage ? (
                <button type="button" disabled={queue.isFetchingNextPage} onClick={() => void queue.fetchNextPage()}>
                  {t('doc.signing.queue.more.action')}
                </button>
              ) : null}
            </div>
          )}
          <StateBoundary state={state} onRetry={() => void (selectedId === undefined ? queue.refetch() : detail.refetch())}>
            {doc === undefined ? null : (
              <div data-document-id={doc.id} data-status={doc.status}>
                <p className="sub">
                  {doc.title} · <span className="pill gray">{statusLabel(t, doc.status)}</span>
                  {mine ? <span className="pill"> {t('doc.signing.queue.mine.badge')}</span> : null}
                </p>
                <div className="checklist">
                  {checks.map((check) => (
                    <div className="item row between" key={check.id} data-check={check.id} data-state={check.state}>
                      <div>
                        <div className="title">{checkTitle(t, check.id)}</div>
                        <div className="sub">{factText(t, check.fact, timeOf)}</div>
                      </div>
                      <span className={PILL_CLASS[check.state]}>{stateLabel(t, check.state)}</span>
                    </div>
                  ))}
                </div>
                {problem === undefined ? null : (
                  <p className="callout warning" role="alert">
                    {problemMessage(t, problem)}
                  </p>
                )}
                {signedId === doc.id || doc.leaderSignedAt !== null ? (
                  <div className="callout" role="status">
                    <p>{t('doc.signing.signed.notice')}</p>
                    <p className="row">
                      {version === undefined ? null : <Link to={`/doc/doc-07?version=${version.id}`}>{t('doc.signing.signed.verify.link')}</Link>}
                      <Link to={`/doc/doc-06?doc=${doc.id}`}>{t('doc.signing.signed.number.link')}</Link>
                    </p>
                  </div>
                ) : !canSign ? (
                  <p className="callout warning" role="status">
                    {frozen ? t('doc.signing.frozen.notice') : t('doc.signing.denied.notice')}
                  </p>
                ) : open !== undefined ? (
                  <form onSubmit={submitComplete} aria-label={t('doc.signing.complete.form')} noValidate>
                    <p className="sub">{t('doc.signing.complete.hint', { minutes: minutesLeft(open.expiresAt, now) })}</p>
                    <div className="field">
                      <label htmlFor="signing-otp">{t('doc.signing.otp.label')}</label>
                      <input id="signing-otp" autoComplete="one-time-code" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                      <small>{t('doc.signing.otp.hint')}</small>
                    </div>
                    <div className="row gap">
                      <button type="submit" className="primary" disabled={complete.isPending}>
                        {t('doc.signing.complete.action')}
                      </button>
                      <button type="button" onClick={() => void detail.refetch()}>
                        {t('doc.signing.refresh.action')}
                      </button>
                    </div>
                  </form>
                ) : canStartSigning(doc, now) ? (
                  <form onSubmit={submitStart} aria-label={t('doc.signing.start.form')} noValidate>
                    <div className="formgrid">
                      <div className="field">
                        <label htmlFor="signing-certificate">{t('doc.signing.certificate.label')}</label>
                        <select id="signing-certificate" value={chosen?.id ?? ''} onChange={(event) => setCertificateId(event.target.value)}>
                          {certificates.map((certificate) => (
                            <option key={certificate.id} value={certificate.id}>
                              {certificate.subjectDn}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="signing-adapter">{t('doc.signing.adapter.label')}</label>
                        <select id="signing-adapter" value={adapter} onChange={(event) => setAdapter(event.target.value as AdapterChoice)}>
                          <option value="">{t('doc.signing.adapter.default')}</option>
                          {ADAPTER_CHOICES.map((code) => (
                            <option key={code} value={code}>
                              {adapterLabel(t, code)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="check">
                      <input id="signing-docmdp" type="checkbox" checked={docmdp} onChange={(event) => setDocmdp(event.target.checked)} />
                      <label htmlFor="signing-docmdp">{t('doc.signing.docmdp.label')}</label>
                    </div>
                    <button type="submit" className="primary gap" disabled={start.isPending || !mine}>
                      {t('doc.signing.start.action')}
                    </button>
                    {mine ? null : <p className="sub">{t('doc.signing.start.notSigner')}</p>}
                  </form>
                ) : (
                  <p className="callout warning">{t('doc.signing.start.blocked')}</p>
                )}
              </div>
            )}
          </StateBoundary>
        </div>
        <div className="card">
          <h2>{t('doc.signing.preview.title')}</h2>
          {doc === undefined ? (
            <p className="muted">{t('doc.signing.preview.empty')}</p>
          ) : (
            <div className="paper">
              <div className="eyebrow">{t('doc.signing.preview.eyebrow', { type: doc.docTypeCode })}</div>
              <h2>{doc.title}</h2>
              <div className="docline" />
              <div className="docline" />
              <div className="quote">
                {version === undefined
                  ? t('doc.signing.preview.noFile')
                  : t('doc.signing.preview.facts', { version: version.version, pages: version.pageCount, stage: stageLabel(t, version.stage), checksum: version.checksum.slice(0, SHORT_CHECKSUM), signer: signerOf(doc) })}
              </div>
              <div className="docline" />
              {version === undefined ? null : (
                <p className="row">
                  <button type="button" onClick={openFile} disabled={download.isPending}>
                    {t('doc.signing.preview.open.action')}
                  </button>
                  {file === undefined || file.versionId !== version.id ? null : (
                    <a href={file.url} target="_blank" rel="noreferrer">
                      {t('doc.signing.preview.link')}
                    </a>
                  )}
                </p>
              )}
              {download.isError ? <p className="callout warning">{t('doc.signing.preview.failed')}</p> : null}
            </div>
          )}
        </div>
      </div>
      <p className="prototype-note">{t('doc.signing.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
