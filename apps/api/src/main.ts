import { CONTRACTS_PACKAGE } from '@machvon/contracts';
import { DB_PACKAGE } from '@machvon/db';
import { KERNEL_PACKAGE } from '@machvon/kernel';

export const API_PACKAGE = '@machvon/api';
export const API_DEPENDENCIES: readonly string[] = [CONTRACTS_PACKAGE, DB_PACKAGE, KERNEL_PACKAGE];
