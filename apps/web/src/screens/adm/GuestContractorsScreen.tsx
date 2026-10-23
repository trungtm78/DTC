import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from '../../i18n';
import type { ScreenProps } from '../../routes/types';
import { useSession } from '../../session/SessionContext';
import { StateBoundary } from '../../states/StateBoundary';
import { useScreenState } from '../../states/useScreenState';
import { DevAcceptanceSlot } from './members/DevAcceptanceSlot';
import { InviteGuestDialog } from './members/InviteGuestDialog';
import { LifecycleDialog } from './members/LifecycleDialog';
import { RowActions } from './members/RowActions';
import { useMembers } from './members/hooks';
import { dayOf, lifecycleDone, statusLabel, statusPill } from './members/labels';
import { MEMBERSHIP_STATUSES, PERMISSION_INVITE_GUEST, PERMISSION_MANAGE, PERMISSION_READ } from './members/types';
import type { Lifecycle, Member, MembershipStatus } from './members/types';
import './members/members.css';

interface Filter {
  text: string;
  status: MembershipStatus | '';
}

const NO_FILTER: Filter = { text: '', status: '' };

type Notice = { kind: 'invited'; email: string } | { kind: 'changed'; text: string };

/** Whether the user holds a permission; unknown permissions (no list in the session) leave the decision to the server. */
function holds(permissions: readonly string[] | undefined, permission: string): boolean {
  return permissions === undefined || permissions.includes(permission);
}

const matches = (member: Member, filter: Filter): boolean =>
  (filter.status === '' || member.status === filter.status) &&
  (filter.text === '' || `${member.contractorName ?? ''} ${member.displayName} ${member.email} ${member.contracts.map((contract) => contract.code).join(' ')}`.toLowerCase().includes(filter.text.toLowerCase()));

/**
 * ADM-17 guest contractors (FR-ADM-17): the guests of the contractors, each with the contracts it may see, the guest role
 * and the end of its access. The command inviteGuestContractor needs iam.guest.invite; suspending, reactivating and
 * ending a guest need iam.member.manage. Without them the screen is read-only or denied.
 */
export default function GuestContractorsScreen({ route }: ScreenProps) {
  const tenantId = useSession().tenant?.id;
  // Everything the screen holds (filters, dialogs, notices) belongs to one tenant: a switch starts it over.
  return <GuestContractorsContent key={tenantId ?? 'none'} routeId={route.id} requirement={route.req ?? ''} />;
}

function GuestContractorsContent({ routeId, requirement }: { routeId: string; requirement: string }) {
  const { t } = useTranslation();
  const { permissions, mode, tenant } = useSession();
  // A suspended tenant (READ_ONLY mode) is read-only for everyone, whatever the grants say.
  const frozen = mode === 'READ_ONLY';
  const canRead = holds(permissions, PERMISSION_READ);
  const canInvite = holds(permissions, PERMISSION_INVITE_GUEST) && !frozen;
  const canManage = holds(permissions, PERMISSION_MANAGE) && !frozen;

  const list = useMembers('GUEST_CONTRACTOR', canRead);
  const [draft, setDraft] = useState<Filter>(NO_FILTER);
  const [applied, setApplied] = useState<Filter>(NO_FILTER);
  const [inviting, setInviting] = useState(false);
  const [acting, setActing] = useState<{ action: Lifecycle; member: Member } | undefined>(undefined);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);

  const all = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const shown = useMemo(() => all.filter((member) => matches(member, applied)), [all, applied]);
  const queryState = useScreenState({ isLoading: list.isLoading, error: list.error ?? undefined, data: list.data === undefined ? undefined : all });
  // Without membership.read nothing is requested and the screen is denied, not empty.
  const state = canRead ? queryState : 'denied';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setApplied(draft);
  };

  return (
    <section data-screen-id={routeId} aria-labelledby="screen-title">
      <div className="heading">
        <div>
          <h1 id="screen-title">{t('adm.guests.page.title')}</h1>
          <p>{t('adm.guests.page.subtitle')}</p>
        </div>
        {(state === 'default' || state === 'empty') && canInvite ? (
          <div className="actions">
            <button type="button" className="primary" onClick={() => setInviting(true)}>
              {t('adm.guests.invite.action')}
            </button>
          </div>
        ) : null}
      </div>
      <StateBoundary state={state} onRetry={() => void list.refetch()}>
        {notice === undefined ? null : (
          <div className="callout" role="status">
            {notice.kind === 'invited' ? t('adm.members.notice.invited', { email: notice.email }) : notice.text}
            {notice.kind === 'invited' ? <DevAcceptanceSlot email={notice.email} /> : null}
          </div>
        )}
        <div className="card">
          <form className="filters" onSubmit={submit}>
            <div>
              <label htmlFor="guest-search">{t('adm.members.search.label')}</label>
              <input id="guest-search" type="search" value={draft.text} placeholder={t('adm.guests.search.placeholder')} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
            </div>
            <div>
              <label htmlFor="guest-status">{t('adm.members.status.label')}</label>
              <select id="guest-status" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as MembershipStatus | '' })}>
                <option value="">{t('adm.members.status.all')}</option>
                {MEMBERSHIP_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(t, status)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit">{t('adm.members.filter.action')}</button>
          </form>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>{t('adm.guests.col.contractor')}</th>
                  <th>{t('adm.guests.col.email')}</th>
                  <th>{t('adm.guests.col.contracts')}</th>
                  <th>{t('adm.guests.col.roles')}</th>
                  <th>{t('adm.guests.col.validUntil')}</th>
                  <th>{t('adm.guests.col.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((member) => (
                  <tr key={member.id} data-member-id={member.id}>
                    <td>
                      <strong>{member.contractorName ?? t('adm.guests.contractor.unknown')}</strong>
                      <div className="sub">{member.displayName}</div>
                    </td>
                    <td>{member.email}</td>
                    <td>{member.contracts.length === 0 ? t('adm.guests.contracts.none') : member.contracts.map((contract) => contract.code).join(', ')}</td>
                    <td>{member.roleCodes.length === 0 ? t('adm.members.roles.none') : member.roleCodes.join(', ')}</td>
                    <td>{member.validUntil === null ? t('adm.members.validUntil.open') : dayOf(member.validUntil)}</td>
                    <td>
                      <span className={statusPill(member.status)}>{statusLabel(t, member.status)}</span>
                    </td>
                    <td className="members-actions">
                      <RowActions member={member} selfId={tenant?.membershipId} canManage={canManage} onAction={(action, target) => setActing({ action, member: target })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 ? <p className="muted">{t('adm.members.filtered.empty')}</p> : null}
          <div className="row between gap tiny muted">
            <span>{t('adm.guests.count.text', { count: shown.length })}</span>
            {list.hasNextPage ? (
              <button type="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {t('adm.members.more.action')}
              </button>
            ) : null}
          </div>
        </div>
      </StateBoundary>
      {inviting ? (
        <InviteGuestDialog
          onClose={() => setInviting(false)}
          onInvited={(email) => {
            setInviting(false);
            setNotice({ kind: 'invited', email });
          }}
        />
      ) : null}
      {acting === undefined ? null : (
        <LifecycleDialog
          action={acting.action}
          member={acting.member}
          onClose={() => setActing(undefined)}
          onDone={() => {
            setNotice({ kind: 'changed', text: lifecycleDone(t, acting.action, acting.member) });
            setActing(undefined);
          }}
        />
      )}
      <p className="prototype-note">{t('adm.guests.footer.reference', { id: routeId, req: requirement })}</p>
    </section>
  );
}
