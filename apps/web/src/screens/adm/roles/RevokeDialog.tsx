import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from '../../../i18n';
import { NavigationDialog } from '../../../shell/NavigationDialog';
import { errorMessage, offendingField } from './errors';
import { StepUpPrompt } from './StepUpPrompt';
import { useAttemptedCommand, useRefreshRolesAndGrants } from './hooks';
import type { CommandExecutor } from './hooks';
import { MIN_REASON_LENGTH } from './types';
import type { GrantView } from './types';

export interface RevokeDialogProps {
  grant: GrantView;
  onClose(): void;
  onRevoked(): void;
}

interface RevokeInput {
  grantId: string;
  version: number;
  reason: string;
}

const revoke: CommandExecutor<RevokeInput> = (client, input, attempt) =>
  client.command('revokeRoleGrant', { path: { grantId: input.grantId }, body: { reason: input.reason }, ifMatchVersion: input.version, attempt });

/** Revokes one grant with a reason of at least ten characters, using the grant version the screen showed (If-Match). */
export function RevokeDialog({ grant, onClose, onRevoked }: RevokeDialogProps) {
  const { t } = useTranslation();
  const refresh = useRefreshRolesAndGrants();
  const titleId = useId();
  const [reason, setReason] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const command = useAttemptedCommand<RevokeInput>(revoke, async () => {
    await refresh();
    onRevoked();
  });
  const invalidField = offendingField(command.error);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    void command.run({ grantId: grant.id, version: grant.version, reason: reason.trim() });
  };

  return (
    <>
      <NavigationDialog className="catalog command-mode" onClose={onClose}>
        <section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="command-titlebar">
            <strong id={titleId}>{t('adm.roles.revoke.dialog.title')}</strong>
            <button type="button" className="icon-button" aria-label={t('adm.roles.dialog.close.label')} onClick={onClose}>
              ×
            </button>
          </div>
          <form className="roles-dialog-body" onSubmit={submit} noValidate>
            <p className="sub">
              {grant.role_code} · {grant.scope_kind}
            </p>
            <div className="field">
              <label htmlFor="revoke-reason">{t('adm.roles.revoke.reason.label')}</label>
              <textarea
                id="revoke-reason"
                name="reason"
                value={reason}
                aria-invalid={tooShort || invalidField === 'reason'}
                onChange={(event) => {
                  setReason(event.target.value);
                  command.resetAttempt();
                }}
              />
              <small>{t('adm.roles.form.reason.help')}</small>
            </div>
            {command.error === undefined ? null : (
              <div className="callout warning" role="alert">
                {errorMessage(t, command.error)}
              </div>
            )}
            <div className="formfooter">
              <button type="button" onClick={onClose}>
                {t('adm.roles.revoke.cancel.action')}
              </button>
              <button type="submit" className="danger" disabled={command.pending}>
                {t('adm.roles.revoke.submit.action')}
              </button>
            </div>
          </form>
        </section>
      </NavigationDialog>
      {command.stepUpOpen ? <StepUpPrompt onConfirm={() => void command.confirmStepUp()} onCancel={command.cancelStepUp} /> : null}
    </>
  );
}
