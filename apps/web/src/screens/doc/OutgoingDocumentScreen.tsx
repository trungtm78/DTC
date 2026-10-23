import { Fragment, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { useAssignNumber, useCompleteSigning, useOutgoingDocument, useOutgoingQueue, useStartSeal } from './outgoing/hooks';
import { adapterLabel, dateProblemMessage, problemMessage, statusLabel, stepHint, stepStateLabel, stepTitle } from './outgoing/labels';
import { describeProblem } from './outgoing/problems';
import type { ProblemContext } from './outgoing/problems';
import { activeCertificates, displayNumber, expectedSymbol, issueDateProblem, minutesLeft, numberingSteps, openSessionOf, vietnamDateOf } from './outgoing/rules';
import type { StepState } from './outgoing/rules';
import { NUMBER_OUTGOING_PERMISSION, SEAL_OUTGOING_PERMISSION } from './outgoing/types';
import { useRegisters, useUnitOptions } from './registers/hooks';
import './outgoing/outgoing.css';

const ARROW = '→';
const STEP_BADGE: Readonly<Record<StepState, string>> = { done: 'pill', current: 'pill warn', waiting: 'pill gray' };
const ADAPTER_CHOICES = ['REMOTE_CA', 'LOCAL_AGENT'] as const;
type AdapterChoice = (typeof ADAPTER_CHOICES)[number] | '';

/** DOC-06: the clerk numbers a signed document from a register and has the organisation seal put on the whole file. */
export default function OutgoingDocumentScreen({ route }: ScreenProps) {
  const { t, locale } = useTranslation();
  const { permissions } = useSession();
  const [params, setParams] = useSearchParams();
  const canNumber = permissions === undefined || permissions.includes(NUMBER_OUTGOING_PERMISSION);
  const canSeal = permissions === undefined || permissions.includes(SEAL_OUTGOING_PERMISSION);
  const today = vietnamDateOf(new Date());
  const [issuedOn, setIssuedOn] = useState(today);
  const [registerId, setRegisterId] = useState('');
  const [certificateId, setCertificateId] = useState('');
  const [adapter, setAdapter] = useState<AdapterChoice>('');
  const [confirmation, setConfirmation] = useState('');
  const [refused, setRefused] = useState(false);
  const [context, setContext] = useState<ProblemContext>('number');
  const signed = useOutgoingQueue('SIGNED');
  const numbered = useOutgoingQueue('NUMBERED');
  const queued = useMemo(() => [...(signed.data?.items ?? []), ...(numbered.data?.items ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [signed.data, numbered.data]);
  const selectedId = params.get('doc') ?? queued[0]?.id;
  const detail = useOutgoingDocument(selectedId);
  const doc = detail.data;
  const year = issuedOn.slice(0, 4);
  const registers = useRegisters({ year, direction: 'OUTGOING' });
  const units = useUnitOptions();
  const assign = useAssignNumber();
  const startSeal = useStartSeal();
  const complete = useCompleteSigning();
  const now = new Date();
  const timeOf = (value: string): string => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(value));
  const queueState = useScreenState({ isLoading: signed.isLoading || numbered.isLoading, error: signed.error ?? numbered.error, data: signed.data === undefined || numbered.data === undefined ? undefined : queued });
  const detailState = useScreenState({ isLoading: detail.isLoading, error: detail.error, data: doc });
  const state = selectedId === undefined ? queueState : detailState;

  const openRegisters = useMemo(
    () =>
      (registers.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (register) => register.status === 'OPEN' && register.mode === 'MANAGED' && (doc === undefined || register.scopeDocTypes.length === 0 || register.scopeDocTypes.includes(doc.docTypeCode)),
      ),
    [registers.data, doc],
  );
  const docType = doc === undefined ? undefined : registers.data?.pages.flatMap((page) => page.docTypes).find((candidate) => candidate.code === doc.docTypeCode);
  const register = openRegisters.find((candidate) => candidate.id === registerId) ?? openRegisters[0];
  const unit = units.data?.find((candidate) => candidate.id === register?.organizationUnitId);
  const planned =
    docType === undefined || register === undefined
      ? undefined
      : expectedSymbol(docType.symbolPattern, { number: register.nextNumber, type: docType.abbreviation, agency: register.registerCode, unit: unit?.code ?? '' });
  const signedOn = doc === undefined || doc.leaderSignedAt === null ? null : vietnamDateOf(new Date(doc.leaderSignedAt));
  const dateProblem = issueDateProblem(issuedOn, today, signedOn);
  const sealCertificates = doc === undefined ? [] : activeCertificates(doc, 'ORGANIZATION');
  const sealCertificate = sealCertificates.find((certificate) => certificate.id === certificateId) ?? sealCertificates[0];
  const open = doc === undefined ? undefined : openSessionOf(doc, 'ORGANIZATION', now);
  const failure = context === 'number' ? assign.error : context === 'start' ? startSeal.error : complete.error;
  const failed = context === 'number' ? assign.isError : context === 'start' ? startSeal.isError : complete.isError;
  const problem = failed ? describeProblem(failure, context) : undefined;
  const steps = doc === undefined ? [] : numberingSteps(doc.status);
  const waitingForNumber = doc?.status === 'SIGNED';

  const choose = (id: string): void => {
    setParams({ doc: id });
    setRefused(false);
    assign.reset();
    startSeal.reset();
    complete.reset();
  };

  const submitNumber = (event: FormEvent): void => {
    event.preventDefault();
    if (doc === undefined || register === undefined || assign.isPending) return;
    if (dateProblem !== undefined) {
      setRefused(true);
      return;
    }
    setContext('number');
    setParams({ doc: doc.id });
    assign.mutate({ documentId: doc.id, version: doc.version, registerId: register.id, issuedOn });
  };

  const submitSeal = (event: FormEvent): void => {
    event.preventDefault();
    if (doc === undefined || startSeal.isPending) return;
    setContext('start');
    startSeal.mutate({ documentId: doc.id, version: doc.version, certificateId: sealCertificate?.id, adapterCode: adapter === '' ? undefined : adapter });
  };

  const submitComplete = (event: FormEvent): void => {
    event.preventDefault();
    if (open === undefined || complete.isPending) return;
    setContext('complete');
    complete.mutate({ sessionId: open.id, version: open.version, confirmation: confirmation.trim() });
  };

  return (
    <section data-screen-id={route.id} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('doc.outgoing.page.title')}</h1>
          <p>{t('doc.outgoing.page.subtitle')}</p>
        </div>
      </div>
      <div className="card">
        <div className="row between">
          <h2>{t('doc.outgoing.card.title')}</h2>
          {doc === undefined ? null : <span className="pill gray">{t('doc.outgoing.version.pill', { version: doc.version })}</span>}
        </div>
        <StateBoundary state={state} onRetry={() => void (selectedId === undefined ? Promise.all([signed.refetch(), numbered.refetch()]) : detail.refetch())}>
          {doc === undefined ? null : (
            <div data-document-id={doc.id} data-status={doc.status}>
              <div className="flow">
                {steps.map((step, index) => (
                  <Fragment key={step.id}>
                    {index === 0 ? null : (
                      <span className="arrow" aria-hidden="true">
                        {ARROW}
                      </span>
                    )}
                    <div className="node" data-step={step.id} data-state={step.state}>
                      <span className="badge">{`0${index + 1}`}</span>
                      <h3 className="node-title">{stepTitle(t, step.id)}</h3>
                      <span className="sub">{stepHint(t, step.id)}</span>
                      <div>
                        <span className={STEP_BADGE[step.state]}>{stepStateLabel(t, step.state)}</span>
                      </div>
                    </div>
                  </Fragment>
                ))}
              </div>
              <form onSubmit={submitNumber} noValidate aria-label={t('doc.outgoing.number.form')}>
                <div className="formgrid">
                  <div className="field">
                    <label htmlFor="outgoing-document">{t('doc.outgoing.queue.label')}</label>
                    <select id="outgoing-document" value={doc.id} onChange={(event) => choose(event.target.value)}>
                      {queued.some((row) => row.id === doc.id) ? null : <option value={doc.id}>{doc.title}</option>}
                      {queued.map((row) => (
                        <option key={row.id} value={row.id}>
                          {t('doc.outgoing.queue.option.text', { title: row.title, status: statusLabel(t, row.status) })}
                        </option>
                      ))}
                    </select>
                    <small>{t('doc.outgoing.scope.hint')}</small>
                  </div>
                  <div className="field">
                    <label htmlFor="outgoing-register">{t('doc.outgoing.register.label')}</label>
                    <select id="outgoing-register" value={register?.id ?? ''} disabled={!waitingForNumber} onChange={(event) => setRegisterId(event.target.value)}>
                      {openRegisters.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {t('doc.outgoing.register.option.text', { code: candidate.registerCode, number: displayNumber(candidate.nextNumber) })}
                        </option>
                      ))}
                    </select>
                    <small>{register === undefined ? t('doc.outgoing.register.none') : t('doc.outgoing.register.next', { number: displayNumber(register.nextNumber) })}</small>
                  </div>
                  <div className="field">
                    <label htmlFor="outgoing-issued-on">{t('doc.outgoing.date.label')}</label>
                    <input
                      id="outgoing-issued-on"
                      type="date"
                      value={waitingForNumber ? issuedOn : (doc.issuedOn ?? '')}
                      disabled={!waitingForNumber}
                      aria-invalid={refused && dateProblem !== undefined}
                      onChange={(event) => setIssuedOn(event.target.value)}
                    />
                    {refused && dateProblem !== undefined ? (
                      <small role="alert" className="field-error">
                        {dateProblemMessage(t, dateProblem)}
                      </small>
                    ) : (
                      <small>{t('doc.outgoing.date.hint')}</small>
                    )}
                  </div>
                  <div className="field">
                    <label htmlFor="outgoing-symbol">{t('doc.outgoing.symbol.label')}</label>
                    <input id="outgoing-symbol" readOnly value={waitingForNumber ? (planned ?? '') : (doc.symbol ?? '')} placeholder={t('doc.outgoing.symbol.placeholder')} />
                    <small>{t('doc.outgoing.symbol.hint')}</small>
                  </div>
                </div>
                {doc.documentNumber === null ? null : (
                  <p className="callout" role="status">
                    {t('doc.outgoing.numbered.notice', { number: displayNumber(doc.documentNumber), symbol: doc.symbol ?? '' })}
                  </p>
                )}
                {problem === undefined ? null : (
                  <p className="callout warning" role="alert">
                    {problemMessage(t, problem)}
                  </p>
                )}
                {waitingForNumber ? (
                  canNumber ? (
                    <button type="submit" className="primary" disabled={assign.isPending || register === undefined}>
                      {t('doc.outgoing.assign.action')}
                    </button>
                  ) : (
                    <p className="callout warning">{t('doc.outgoing.denied.number')}</p>
                  )
                ) : null}
              </form>
              {doc.status === 'NUMBERED' ? (
                canSeal ? (
                  open !== undefined ? (
                    <form onSubmit={submitComplete} noValidate aria-label={t('doc.outgoing.sealComplete.form')}>
                      <p className="sub">{t('doc.outgoing.sealComplete.hint', { minutes: minutesLeft(open.expiresAt, now) })}</p>
                      <div className="field">
                        <label htmlFor="outgoing-otp">{t('doc.outgoing.otp.label')}</label>
                        <input id="outgoing-otp" autoComplete="one-time-code" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                      </div>
                      <div className="row gap">
                        <button type="submit" className="primary" disabled={complete.isPending}>
                          {t('doc.outgoing.sealComplete.action')}
                        </button>
                        <button type="button" onClick={() => void detail.refetch()}>
                          {t('doc.outgoing.refresh.action')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={submitSeal} noValidate aria-label={t('doc.outgoing.seal.form')}>
                      <div className="formgrid">
                        <div className="field">
                          <label htmlFor="outgoing-seal-certificate">{t('doc.outgoing.sealCertificate.label')}</label>
                          <select id="outgoing-seal-certificate" value={sealCertificate?.id ?? ''} onChange={(event) => setCertificateId(event.target.value)}>
                            {sealCertificates.map((certificate) => (
                              <option key={certificate.id} value={certificate.id}>
                                {certificate.subjectDn}
                              </option>
                            ))}
                          </select>
                          <small>{sealCertificate === undefined ? t('doc.outgoing.sealCertificate.none') : t('doc.outgoing.sealCertificate.until', { time: timeOf(sealCertificate.validUntil) })}</small>
                        </div>
                        <div className="field">
                          <label htmlFor="outgoing-adapter">{t('doc.outgoing.adapter.label')}</label>
                          <select id="outgoing-adapter" value={adapter} onChange={(event) => setAdapter(event.target.value as AdapterChoice)}>
                            <option value="">{t('doc.outgoing.adapter.default')}</option>
                            {ADAPTER_CHOICES.map((code) => (
                              <option key={code} value={code}>
                                {adapterLabel(t, code)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <button type="submit" className="primary" disabled={startSeal.isPending || sealCertificate === undefined}>
                        {t('doc.outgoing.seal.action')}
                      </button>
                    </form>
                  )
                ) : (
                  <p className="callout warning">{t('doc.outgoing.denied.seal')}</p>
                )
              ) : null}
              {doc.status === 'SEALED' || doc.status === 'ISSUED' ? (
                <div className="callout" role="status">
                  <p>{t('doc.outgoing.sealed.notice')}</p>
                  {doc.currentVersionId === null ? null : <Link to={`/doc/doc-07?version=${doc.currentVersionId}`}>{t('doc.outgoing.sealed.verify.link')}</Link>}
                </div>
              ) : null}
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('doc.outgoing.progress.col.step')}</th>
                      <th>{t('doc.outgoing.progress.col.time')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr data-progress="leader">
                      <td>{t('doc.outgoing.progress.leader')}</td>
                      <td>{doc.leaderSignedAt === null ? t('doc.outgoing.progress.waiting') : timeOf(doc.leaderSignedAt)}</td>
                    </tr>
                    <tr data-progress="number">
                      <td>{t('doc.outgoing.progress.number')}</td>
                      <td>{doc.numberedAt === null ? t('doc.outgoing.progress.waiting') : timeOf(doc.numberedAt)}</td>
                    </tr>
                    <tr data-progress="seal">
                      <td>{t('doc.outgoing.progress.seal')}</td>
                      <td>{doc.sealedAt === null ? t('doc.outgoing.progress.waiting') : timeOf(doc.sealedAt)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="callout">{t('doc.outgoing.note.text')}</p>
            </div>
          )}
        </StateBoundary>
      </div>
      <p className="prototype-note">{t('doc.outgoing.footer.reference', { id: route.id, req: route.req ?? '' })}</p>
    </section>
  );
}
