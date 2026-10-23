import type { ScreenLoader } from '../types.ts';

/**
 * The implemented screens by screen id, each loaded on demand. A screen is registered here when its
 * implementation lands (ADM-01 and ADM-03 first); every other route renders NotImplementedScreen.
 */
export const screenModules: Readonly<Record<string, ScreenLoader>> = {
  'ADM-01': () => import('../../screens/adm/OrgTreeScreen'),
  'ADM-03': () => import('../../screens/adm/RolesGrantsScreen'),
  'NOT-01': () => import('../../screens/not/InboxScreen'),
  'NOT-02': () => import('../../screens/not/NotificationDetailScreen'),
};
