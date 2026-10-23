import table from './routes.generated.json';
import type { WebRoute } from './types.ts';

/** The 406 web routes of the navigation architecture; the data file is generated (npm run routes:generate). */
export const WEB_ROUTES: readonly WebRoute[] = table.routes;
