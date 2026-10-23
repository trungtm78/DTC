import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { useRef } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { AttemptRegistry } from '../../../api/attempt-registry';
import { useSession } from '../../../session/SessionContext';
import { toNotifications } from './model';
import type { NotificationItem, NotificationView } from './model';

export const PAGE_SIZE = 25;

export const notificationsKey = (tenantId: string | undefined) => ['my-notifications', tenantId] as const;

export interface InboxPage {
  items: NotificationItem[];
  /** The cursor of the next page; undefined on the last page. */
  next: string | undefined;
}

/** Every item of the pages loaded so far, in the order the server sent them. */
export const itemsOf = (data: InfiniteData<InboxPage> | undefined): NotificationItem[] | undefined => data?.pages.flatMap((page) => page.items);

/** The member's own notifications, one keyset page at a time, keyed by tenant so a tenant switch never shows another tenant's inbox. */
export function useMyNotifications() {
  const client = useApiClient();
  const { tenant } = useSession();
  return useInfiniteQuery<InboxPage, Error, InfiniteData<InboxPage>, ReturnType<typeof notificationsKey>, string | undefined>({
    queryKey: notificationsKey(tenant?.id),
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      const page = (await client.read('listMyNotifications', {
        query: { limit: PAGE_SIZE, ...(pageParam === undefined ? {} : { cursor: pageParam }) },
      })) as { items?: NotificationView[]; next_cursor?: string | null };
      return { items: toNotifications(page.items ?? []), next: page.next_cursor ?? undefined };
    },
    getNextPageParam: (last) => last.next,
    enabled: tenant !== undefined,
    retry: false,
  });
}

/**
 * The two commands of a notification. Each user intention keeps one idempotency attempt across retries, a second click while
 * a command runs is ignored (the guard is a ref, so it holds before React re-renders), and a success refreshes the inbox.
 */
export function useNotificationCommands() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { tenant } = useSession();
  const readAttempts = useRef(new AttemptRegistry());
  const acknowledgeAttempts = useRef(new AttemptRegistry());
  const busy = useRef(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: notificationsKey(tenant?.id) });

  const read = useMutation({
    mutationFn: (id: string) =>
      client.command('markNotificationRead', {
        path: { notificationId: id },
        body: { opened_via: 'IN_APP' },
        attempt: readAttempts.current.forPayload({ id }),
      }),
    onSuccess: async () => {
      readAttempts.current.done();
      await refresh();
    },
    onError: (error) => readAttempts.current.ended(error),
  });
  const acknowledge = useMutation({
    mutationFn: (input: { id: string; comment: string }) =>
      client.command('acknowledgeNotification', {
        path: { notificationId: input.id },
        body: input.comment === '' ? {} : { comment: input.comment },
        attempt: acknowledgeAttempts.current.forPayload(input),
      }),
    onSuccess: async () => {
      acknowledgeAttempts.current.done();
      await refresh();
    },
    onError: (error) => acknowledgeAttempts.current.ended(error),
  });

  return {
    read,
    acknowledge,
    markRead(id: string, handlers?: { onSuccess?: () => void; onError?: (error: unknown) => void }): void {
      if (busy.current) return;
      busy.current = true;
      read.mutate(id, {
        onSuccess: handlers?.onSuccess,
        onError: handlers?.onError,
        onSettled: () => {
          busy.current = false;
        },
      });
    },
    acknowledgeAs(id: string, comment: string, handlers?: { onSuccess?: () => void; onError?: (error: unknown) => void }): void {
      if (busy.current) return;
      busy.current = true;
      acknowledge.mutate(
        { id, comment },
        {
          onSuccess: handlers?.onSuccess,
          onError: handlers?.onError,
          onSettled: () => {
            busy.current = false;
          },
        },
      );
    },
  };
}
