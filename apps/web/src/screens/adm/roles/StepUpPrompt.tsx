import { useId } from 'react';
import { useTranslation } from '../../../i18n';
import { NavigationDialog } from '../../../shell/NavigationDialog';

export interface StepUpPromptProps {
  onConfirm(): void;
  onCancel(): void;
}

/** Asks for the second factor when the server answered MFA_REQUIRED; confirming reruns the very same command attempt. */
export function StepUpPrompt({ onConfirm, onCancel }: StepUpPromptProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  return (
    <NavigationDialog className="catalog command-mode" onClose={onCancel}>
      <section className="command-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <div className="command-titlebar">
          <strong id={titleId}>{t('adm.roles.stepUp.title')}</strong>
        </div>
        <div className="roles-dialog-body">
          <p id={bodyId}>{t('adm.roles.stepUp.body')}</p>
          <div className="formfooter">
            <button type="button" onClick={onCancel}>
              {t('adm.roles.stepUp.cancel.action')}
            </button>
            <button type="button" className="primary" onClick={onConfirm}>
              {t('adm.roles.stepUp.confirm.action')}
            </button>
          </div>
        </div>
      </section>
    </NavigationDialog>
  );
}
