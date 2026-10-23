import { useLocation } from 'react-router-dom';
import { useTranslation } from '../../i18n';
import { useSession } from '../SessionContext';

/** What a signed-out visitor sees instead of a screen: the standard card of the lapsed session, with the way back in. */
export function SignInGate() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const location = useLocation();
  return (
    <div className="card statecard" role="alert">
      <div className="stateicon" aria-hidden="true">
        ◷
      </div>
      <h1>{t('states.signedOut.title')}</h1>
      <p className="muted">{t('states.signedOut.body')}</p>
      <button type="button" className="primary" onClick={() => void signIn?.({ returnTo: `${location.pathname}${location.search}` })}>
        {t('session.oidc.signIn.action')}
      </button>
    </div>
  );
}
