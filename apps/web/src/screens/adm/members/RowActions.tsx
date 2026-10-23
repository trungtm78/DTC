import { useTranslation } from '../../../i18n';
import { lifecycleRowLabel, lifecycleAction } from './labels';
import { lifecycleOptions } from './types';
import type { Lifecycle, Member } from './types';

export interface RowActionsProps {
  member: Member;
  /** The membership of the signed-in user: nobody acts on themselves (SELF_ACTION_DENIED), so no control is shown for it. */
  selfId: string | undefined;
  /** Whether suspend, reactivate and end are offered (iam.member.manage); the server still decides. */
  canManage: boolean;
  onAction(action: Lifecycle, member: Member): void;
}

/** The lifecycle commands the status of a membership allows, as one button each; none for a read-only user or for oneself. */
export function RowActions({ member, selfId, canManage, onAction }: RowActionsProps) {
  const { t } = useTranslation();
  if (!canManage || member.id === selfId) return null;
  return (
    <>
      {lifecycleOptions(member.status).map((action) => (
        <button key={action} type="button" className={action === 'end' ? 'danger' : undefined} aria-label={lifecycleRowLabel(t, action, member)} onClick={() => onAction(action, member)}>
          {lifecycleAction(t, action)}
        </button>
      ))}
    </>
  );
}
