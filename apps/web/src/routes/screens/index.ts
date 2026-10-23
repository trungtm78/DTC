import type { ScreenLoader } from '../types.ts';

/**
 * The implemented screens by screen id, each loaded on demand. A screen is registered here when its
 * implementation lands (ADM-01 and ADM-03 first); every other route renders NotImplementedScreen.
 */
export const screenModules: Readonly<Record<string, ScreenLoader>> = {
  'ADM-01': () => import('../../screens/adm/OrgTreeScreen'),
  'ADM-02': () => import('../../screens/adm/MembersScreen'),
  'ADM-03': () => import('../../screens/adm/RolesGrantsScreen'),
  'ADM-17': () => import('../../screens/adm/GuestContractorsScreen'),
  'ADM-08': () => import('../../screens/adm/CertificatesScreen'),
  'ADM-14': () => import('../../screens/adm/SecurityPolicyScreen'),
  'DOC-10': () => import('../../screens/doc/NumberRegistersScreen'),
  'DOC-21': () => import('../../screens/doc/DocumentTypesScreen'),
  'IAM-04': () => import('../../screens/iam/TenantChooserScreen'),
  'IAM-09': () => import('../../screens/iam/EffectiveAccessScreen'),
  'NOT-01': () => import('../../screens/not/InboxScreen'),
  'NOT-02': () => import('../../screens/not/NotificationDetailScreen'),
  'SAS-01': () => import('../../screens/sas/TenantListScreen'),
  'SAS-02': () => import('../../screens/sas/TenantCreateScreen'),
  'SAS-03': () => import('../../screens/sas/TenantDetailScreen'),
  'SAS-25': () => import('../../screens/sas/EntitlementsScreen'),
};
