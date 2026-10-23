import { useLocation } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { useSignInAttempt } from './useSignInAttempt';

/** What a signed-out visitor sees instead of a screen: the standard card of the lapsed session, with the way back in. */
export function SignInGate() {
  const { t } = useTranslation();
  const attempt = useSignInAttempt();
  const location = useLocation();
  return (
    <div className="card statecard" role="alert">
      <div className="stateicon" aria-hidden="true">
        {attempt.failed ? '!' : '◷'}
      </div>
      <h1>{attempt.failed ? t('session.oidc.unavailable.title') : t('states.signedOut.title')}</h1>
      <p className="muted">{attempt.failed ? t('session.oidc.unavailable.body') : t('states.signedOut.body')}</p>
      <button type="button" className="primary" onClick={() => attempt.start({ returnTo: `${location.pathname}${location.search}` })}>
        {t('session.oidc.signIn.action')}
      </button>
    </div>
  );
}
