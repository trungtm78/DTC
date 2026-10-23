import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where the API stack describes itself once it is ready (and where its pid and stop files live). */
export const STACK_DIR = resolve(HERE, '..', '.stack');
export const STACK_INFO_PATH = resolve(STACK_DIR, 'stack-info.json');
export const STACK_STOP_PATH = `${STACK_INFO_PATH}.stop`;
export const STACK_PID_PATH = `${STACK_INFO_PATH}.pid`;
/** The temporary directory prefix of the stack's database (apps/api/test/e2e-stack): its leftovers are recognised by it. */
export const STACK_TEMP_PREFIX = 'machvon-e2e-pg-';
