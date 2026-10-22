export type MachvonRole =
  | 'machvon_owner'
  | 'machvon_app'
  | 'machvon_control'
  | 'machvon_outbox_relay'
  | 'machvon_reporting'
  | 'machvon_sync';

export const MACHVON_ROLES: readonly MachvonRole[] = [
  'machvon_owner',
  'machvon_app',
  'machvon_control',
  'machvon_outbox_relay',
  'machvon_reporting',
  'machvon_sync',
];

export const OWNER_ROLE: MachvonRole = 'machvon_owner';
export const APP_ROLE: MachvonRole = 'machvon_app';
