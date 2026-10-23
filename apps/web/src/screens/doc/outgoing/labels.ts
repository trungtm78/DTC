import type { Translator } from '../../../i18n';
import type { ProblemView } from './problems';
import type { CheckState, Fact, NumberingStepId, SigningCheckId, StepState } from './rules';
import type { AdapterCode, AdapterStatus, DocumentStatus } from './types';

type T = Translator['t'];

// Every key is written out so the i18n check can see it is in use.
export function checkTitle(t: T, id: SigningCheckId): string {
  switch (id) {
    case 'viewer':
      return t('doc.signing.check.viewer.title');
    case 'box':
      return t('doc.signing.check.box.title');
    case 'certificate':
      return t('doc.signing.check.certificate.title');
    case 'session':
      return t('doc.signing.check.session.title');
    case 'adapter':
      return t('doc.signing.check.adapter.title');
    case 'reject':
      return t('doc.signing.check.reject.title');
  }
}

export function stateLabel(t: T, state: CheckState): string {
  switch (state) {
    case 'pass':
      return t('doc.signing.state.pass');
    case 'review':
      return t('doc.signing.state.review');
    case 'fail':
      return t('doc.signing.state.fail');
    case 'none':
      return t('doc.signing.state.none');
  }
}

export function adapterLabel(t: T, adapter: AdapterCode): string {
  switch (adapter) {
    case 'REMOTE_CA':
      return t('doc.outgoing.adapter.remoteCa');
    case 'LOCAL_AGENT':
      return t('doc.outgoing.adapter.localAgent');
    case 'MOCK':
      return t('doc.outgoing.adapter.mock');
  }
}

export function adapterStatusLabel(t: T, status: AdapterStatus): string {
  switch (status) {
    case 'VERIFIED':
      return t('doc.outgoing.adapterStatus.verified');
    case 'PROPOSED':
      return t('doc.outgoing.adapterStatus.proposed');
    case 'MOCK':
      return t('doc.outgoing.adapterStatus.mock');
    case 'MISSING':
      return t('doc.outgoing.adapterStatus.missing');
  }
}

export function statusLabel(t: T, status: DocumentStatus): string {
  switch (status) {
    case 'DRAFT':
      return t('doc.outgoing.status.draft');
    case 'IN_REVIEW':
      return t('doc.outgoing.status.inReview');
    case 'SUBMITTED':
      return t('doc.outgoing.status.submitted');
    case 'SIGNED':
      return t('doc.outgoing.status.signed');
    case 'NUMBERED':
      return t('doc.outgoing.status.numbered');
    case 'SEALED':
      return t('doc.outgoing.status.sealed');
    case 'ISSUED':
      return t('doc.outgoing.status.issued');
    case 'OTHER':
      return t('doc.outgoing.status.other');
  }
}

export function stageLabel(t: T, stage: string): string {
  switch (stage) {
    case 'RENDERED_FINAL':
      return t('doc.outgoing.stage.renderedFinal');
    case 'LEADER_SIGNED':
      return t('doc.outgoing.stage.leaderSigned');
    case 'NUMBERED':
      return t('doc.outgoing.stage.numbered');
    case 'ORG_SEALED':
      return t('doc.outgoing.stage.orgSealed');
    default:
      return t('doc.outgoing.stage.other', { stage });
  }
}

/** The line a checklist row shows under its title; the times arrive already formatted. */
export function factText(t: T, fact: Fact, time: (value: string) => string): string {
  switch (fact.kind) {
    case 'viewerReady':
      return t('doc.signing.fact.viewerReady', { version: fact.version, pages: fact.pages, stage: stageLabel(t, fact.stage) });
    case 'viewerMissing':
      return t('doc.signing.fact.viewerMissing');
    case 'viewerStage':
      return t('doc.signing.fact.viewerStage', { stage: stageLabel(t, fact.stage) });
    case 'boxUnnamed':
      return t('doc.signing.fact.boxUnnamed');
    case 'boxPending':
      return t('doc.signing.fact.boxPending', { signer: fact.signer });
    case 'boxSigned':
      return t('doc.signing.fact.boxSigned', { time: time(fact.at) });
    case 'certActive':
      return t('doc.signing.fact.certActive', { subject: fact.subject, until: time(fact.until) });
    case 'certNone':
      return t('doc.signing.fact.certNone');
    case 'certInactive':
      return t('doc.signing.fact.certInactive', { subject: fact.subject, status: fact.status });
    case 'sessionOpen':
      return t('doc.signing.fact.sessionOpen', { time: time(fact.until) });
    case 'sessionExpired':
      return t('doc.signing.fact.sessionExpired', { time: time(fact.at) });
    case 'sessionNone':
      return t('doc.signing.fact.sessionNone');
    case 'sessionDone':
      return t('doc.signing.fact.sessionDone', { time: time(fact.at) });
    case 'adapterLine': {
      const adapter = fact.adapter === 'REMOTE_CA' || fact.adapter === 'LOCAL_AGENT' || fact.adapter === 'MOCK' ? adapterLabel(t, fact.adapter) : fact.adapter;
      const status = fact.status === 'VERIFIED' || fact.status === 'PROPOSED' || fact.status === 'MOCK' || fact.status === 'MISSING' ? adapterStatusLabel(t, fact.status) : fact.status;
      return t('doc.signing.fact.adapterLine', { adapter, status });
    }
    case 'adapterNone':
      return t('doc.signing.fact.adapterNone');
    case 'rejectReason':
      return t('doc.signing.fact.rejectReason', { reason: fact.reason });
    case 'rejectNone':
      return t('doc.signing.fact.rejectNone');
  }
}

export function stepTitle(t: T, id: NumberingStepId): string {
  switch (id) {
    case 'queue':
      return t('doc.outgoing.step.queue.title');
    case 'register':
      return t('doc.outgoing.step.register.title');
    case 'date':
      return t('doc.outgoing.step.date.title');
    case 'symbol':
      return t('doc.outgoing.step.symbol.title');
    case 'seal':
      return t('doc.outgoing.step.seal.title');
    case 'status':
      return t('doc.outgoing.step.status.title');
    case 'void':
      return t('doc.outgoing.step.void.title');
  }
}

export function stepHint(t: T, id: NumberingStepId): string {
  switch (id) {
    case 'queue':
      return t('doc.outgoing.step.queue.hint');
    case 'register':
      return t('doc.outgoing.step.register.hint');
    case 'date':
      return t('doc.outgoing.step.date.hint');
    case 'symbol':
      return t('doc.outgoing.step.symbol.hint');
    case 'seal':
      return t('doc.outgoing.step.seal.hint');
    case 'status':
      return t('doc.outgoing.step.status.hint');
    case 'void':
      return t('doc.outgoing.step.void.hint');
  }
}

export function stepStateLabel(t: T, state: StepState): string {
  switch (state) {
    case 'done':
      return t('doc.outgoing.stepState.done');
    case 'current':
      return t('doc.outgoing.stepState.current');
    case 'waiting':
      return t('doc.outgoing.stepState.waiting');
  }
}

/** What a failed command says, in the words of the signing and numbering screens. */
export function problemMessage(t: T, problem: ProblemView): string {
  switch (problem.reason) {
    case 'conflict':
      return t('doc.outgoing.problem.conflict');
    case 'selfSign':
      return t('doc.outgoing.problem.selfSign');
    case 'notSigner':
      return t('doc.outgoing.problem.notSigner');
    case 'certificate':
      return t('doc.outgoing.problem.certificate');
    case 'sessionOpen':
      return t('doc.outgoing.problem.sessionOpen');
    case 'pending':
      return t('doc.outgoing.problem.pending');
    case 'expired':
      return t('doc.outgoing.problem.expired');
    case 'adapter':
      return t('doc.outgoing.problem.adapter');
    case 'provider':
      return t('doc.outgoing.problem.provider');
    case 'digest':
      return t('doc.outgoing.problem.digest');
    case 'signature':
      return t('doc.outgoing.problem.signature');
    case 'state':
      return t('doc.outgoing.problem.state');
    case 'registerNotOpen':
      return t('doc.outgoing.problem.registerNotOpen');
    case 'registerYear':
      return t('doc.outgoing.problem.registerYear');
    case 'lockTimeout':
      return t('doc.outgoing.problem.lockTimeout');
    case 'leaderBroken':
      return t('doc.outgoing.problem.leaderBroken');
    case 'incremental':
      return t('doc.outgoing.problem.incremental');
    case 'symbol':
      return t('doc.outgoing.problem.symbol');
    case 'invalid':
      return t('doc.outgoing.problem.invalid');
    case 'notFound':
      return t('doc.outgoing.problem.notFound');
    case 'denied':
      return t('doc.outgoing.problem.denied');
    case 'session':
      return t('doc.outgoing.problem.session');
    case 'general':
      return t('doc.outgoing.problem.general');
  }
}

export function dateProblemMessage(t: T, problem: 'required' | 'future' | 'beforeSigning'): string {
  switch (problem) {
    case 'required':
      return t('doc.outgoing.date.problem.required');
    case 'future':
      return t('doc.outgoing.date.problem.future');
    case 'beforeSigning':
      return t('doc.outgoing.date.problem.beforeSigning');
  }
}
