import { newCommandAttempt } from '@machvon/api-client';
import type { ApiClient, CommandAttempt } from '@machvon/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useApiClient } from '../../../api/ApiClientContext';
import { useSession } from '../../../session/SessionContext';
import { isStepUpRequired } from './errors';
import type { GrantView, RoleView } from './types';

const ROLES_KEY = 'adm-roles';
const GRANTABLE_KEY = 'adm-roles-grantable';
const GRANTS_KEY = 'adm-grants';

export function useRoleDefinitions(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery({
    queryKey: [ROLES_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_role_definition')) as RoleView[],
    enabled,
    retry: false,
  });
}

/** The roles the signed-in user could hand out; the grant dialog offers nothing else. */
export function useGrantableRoles(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery({
    queryKey: [GRANTABLE_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_role_definition', { query: { grantable: true } })) as RoleView[],
    enabled,
    retry: false,
  });
}

export function useGrants(enabled: boolean) {
  const client = useApiClient();
  const tenantId = useSession().tenant?.id;
  return useQuery({
    queryKey: [GRANTS_KEY, tenantId],
    queryFn: async () => (await client.readAll('get_resources_role_grant')) as unknown as GrantView[],
    enabled,
    retry: false,
  });
}

/** Reloads every list of the screen after a command changed roles or grants. */
export function useRefreshRolesAndGrants(): () => Promise<void> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([ROLES_KEY, GRANTABLE_KEY, GRANTS_KEY].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  }, [queryClient]);
}

export interface AttemptedCommand<I> {
  /** Runs the command; resolves true on success. A second call while one is running is ignored (a double click). */
  run(input: I): Promise<boolean>;
  pending: boolean;
  error: unknown;
  /** The server asked for the second factor; the prompt is open until it is confirmed or cancelled. */
  stepUpOpen: boolean;
  confirmStepUp(): Promise<void>;
  cancelStepUp(): void;
  /** The user changed something: the next run is a new intention with a new idempotency key. */
  resetAttempt(): void;
}

export type CommandExecutor<I> = (client: ApiClient, input: I, attempt: CommandAttempt) => Promise<unknown>;

/**
 * Runs one command with the idempotency discipline of the screen: one attempt (one Idempotency-Key) per user
 * intention, reused when the same intention is retried (after the second factor), replaced as soon as the user
 * edits the form or the server answered with a final refusal.
 */
export function useAttemptedCommand<I>(execute: CommandExecutor<I>, onSuccess: () => void | Promise<void>): AttemptedCommand<I> {
  const client = useApiClient();
  const session = useSession();
  const attempt = useRef<CommandAttempt | undefined>(undefined);
  const running = useRef(false);
  const retryInput = useRef<I | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  // The latest callbacks, so `run` keeps one identity and a stale closure never decides what happens after a command.
  const latest = useRef({ execute, onSuccess });
  latest.current = { execute, onSuccess };

  const run = useCallback(
    async (input: I): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setPending(true);
      setError(undefined);
      attempt.current ??= newCommandAttempt();
      try {
        await latest.current.execute(client, input, attempt.current);
        attempt.current = undefined;
        await latest.current.onSuccess();
        return true;
      } catch (failure) {
        if (isStepUpRequired(failure)) {
          // The guard refused before the command ran, so the same key is safe to reuse after the second factor.
          retryInput.current = input;
          setStepUpOpen(true);
        } else {
          attempt.current = undefined;
          setError(failure);
        }
        return false;
      } finally {
        running.current = false;
        setPending(false);
      }
    },
    [client],
  );

  const confirmStepUp = useCallback(async () => {
    await session.requestStepUp?.();
    setStepUpOpen(false);
    const input = retryInput.current;
    retryInput.current = undefined;
    if (input !== undefined) await run(input);
  }, [session, run]);

  const cancelStepUp = useCallback(() => {
    setStepUpOpen(false);
    retryInput.current = undefined;
    attempt.current = undefined;
  }, []);

  const resetAttempt = useCallback(() => {
    attempt.current = undefined;
    setError(undefined);
  }, []);

  return { run, pending, error, stepUpOpen, confirmStepUp, cancelStepUp, resetAttempt };
}
