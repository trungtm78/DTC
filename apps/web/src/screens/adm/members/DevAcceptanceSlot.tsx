import { lazy, Suspense } from 'react';
import { useSession } from '../../../session/SessionContext';

// Imported only when the build is a development one: `import.meta.env.DEV` is a constant false in production, so the
// bundler drops the branch and the module never reaches the bundle.
const DevAcceptance = import.meta.env.DEV ? lazy(() => import('./DevAcceptance')) : undefined;

/** Shows the one-time acceptance data of an invitation in a development session; renders nothing anywhere else. */
export function DevAcceptanceSlot({ email }: { email: string }) {
  // A real sign-in (OIDC) always has a status; the development session has none.
  const { status } = useSession();
  if (DevAcceptance === undefined || status !== undefined) return null;
  return (
    <Suspense fallback={null}>
      <DevAcceptance email={email} />
    </Suspense>
  );
}
