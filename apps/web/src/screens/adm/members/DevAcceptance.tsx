import { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n';

/** The one-time data of an invitation, as the development API's mailbox gives it (never present in production). */
interface DevInvitation {
  invitation_id: string;
  token: string;
  expires_at: string;
}

function isDevInvitation(value: unknown): value is DevInvitation {
  if (typeof value !== 'object' || value === null) return false;
  const { invitation_id: id, token, expires_at: expires } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof token === 'string' && typeof expires === 'string';
}

/**
 * Development sessions only: the invited person receives the one-time token by email, which the development stack
 * keeps in memory instead of sending, so the screen reads it from the stack's mailbox and shows how to accept. This
 * module is imported only when `import.meta.env.DEV` is true; a production bundle never contains it.
 */
export default function DevAcceptance({ email }: { email: string }) {
  const { t } = useTranslation();
  const [invitation, setInvitation] = useState<DevInvitation | undefined>(undefined);

  useEffect(() => {
    let current = true;
    const base = import.meta.env.VITE_API_BASE_URL ?? '';
    void fetch(`${base}/__dev/mailbox?email=${encodeURIComponent(email)}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => {
        if (current && isDevInvitation(body)) setInvitation(body);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [email]);

  if (invitation === undefined) return null;
  const acceptPath = ['/memberships/invitations', invitation.invitation_id, 'accept'].join('/');
  return (
    <div className="callout" role="note" data-dev-acceptance="">
      <strong>{t('adm.members.dev.acceptance.title')}</strong>
      <p className="sub">{t('adm.members.dev.acceptance.hint')}</p>
      <p className="sub">
        {t('adm.members.dev.acceptance.link')}: <code data-dev-invitation={invitation.invitation_id}>{acceptPath}</code>
      </p>
      <p className="sub">
        {t('adm.members.dev.acceptance.token')}: <code data-dev-token="">{invitation.token}</code>
      </p>
    </div>
  );
}
