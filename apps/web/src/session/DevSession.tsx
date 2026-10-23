import type { ReactNode } from 'react';
import { devTenantsFor } from './dev-tenants';
import DevSessionProvider from './DevSessionProvider';

/**
 * The development session as the application mounts it: the tenants come from the address (`?tenants=2` offers both
 * fixture tenants). Like the provider it wraps, it is only imported by a development build.
 */
export default function DevSession({ children }: { children: ReactNode }) {
  return <DevSessionProvider tenants={devTenantsFor(window.location.search)}>{children}</DevSessionProvider>;
}
