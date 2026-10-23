/**
 * Which entitlement feature gates which permission. `openapi.json` has no `x-feature` (a change request is proposed),
 * so the mapping is kept here by hand; a test checks that every key is a permission of the generated catalogue.
 * Permissions that are not listed are not gated by a plan feature.
 */
export const FEATURE_BY_PERMISSION: Readonly<Record<string, string>> = {
  'report.read': 'reporting',
  'report.edit': 'reporting',
  'report.import': 'reporting',
  'report.withdraw': 'reporting',
  'report.export': 'export',
  'bi.export': 'export',
  'bi.export.schedule': 'export',
  'mne.report.export': 'export',
  'contractor.export': 'export',
  'audit.export': 'export',
  'ai.invoke': 'ai.analysis',
  'ai.decide': 'ai.analysis',
  'notification.campaign.manage': 'notification.campaign',
  'notification.campaign.approve': 'notification.campaign',
  'iam.member.invite': 'member.invite',
  'iam.guest.invite': 'member.invite',
};

/** The feature that gates `permission`, or undefined when no plan feature does. */
export function featureOf(permission: string): string | undefined {
  return Object.hasOwn(FEATURE_BY_PERMISSION, permission) ? FEATURE_BY_PERMISSION[permission] : undefined;
}
