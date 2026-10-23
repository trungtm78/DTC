import type { ReactNode } from 'react';
import { devTenantsFor } from './dev-tenants';
import { applyDevUser, devUserFor, parseDevUsers } from './dev-users';
import DevSessionProvider from './DevSessionProvider';

/**
 * The development session as the application mounts it: the tenants come from the address (`?tenants=2` offers both
 * fixture tenants) and `?devUser=<key>` signs in as a user of the development API fixture (`VITE_DEV_USERS`). Like the
 * provider it wraps, it is only imported by a development build.
 */
export default function DevSession({ children }: { children: ReactNode }) {
  const { search } = window.location;
  const picked = devUserFor(search, parseDevUsers(import.meta.env.VITE_DEV_USERS));
  const { user, tenants, permissions, controlRoles } = applyDevUser(picked, devTenantsFor(search));
  return (
    <DevSessionProvider tenants={tenants} user={user} permissions={permissions} controlRoles={controlRoles}>
      {children}
    </DevSessionProvider>
  );
}
