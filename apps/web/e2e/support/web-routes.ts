import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { WebRoute } from '../../src/routes/types.ts';

const TABLE = fileURLToPath(new URL('../../src/routes/routes.generated.json', import.meta.url));

/** The web routes of the generated data file, read at run time so the browser specs need no JSON module support. */
export const WEB_ROUTES: readonly WebRoute[] = (JSON.parse(readFileSync(TABLE, 'utf8')) as { routes: WebRoute[] }).routes;
