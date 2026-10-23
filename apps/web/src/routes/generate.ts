import type { WebRoute } from './types.ts';

/** Where the generated route table is written, relative to apps/web. */
export const ROUTES_FILE = 'src/routes/routes.generated.json';

export interface NavigationArchitecture {
  webRoutes: ReadonlyArray<{
    id: string;
    title: string;
    kind: string;
    area: string;
    module: string;
    group: string;
    role: string;
    parent: string | null;
  }>;
}

export type ScreenCatalogue = ReadonlyArray<{ id: string; req?: string }>;

/** The route path of a screen: `/<module>/<id>` in lower case. */
export function pathOf(module: string, id: string): string {
  return `/${module.toLowerCase()}/${id.toLowerCase()}`;
}

/**
 * Joins the web routes of the navigation architecture with the requirement id of the screen catalogue.
 * The table keeps the order of the architecture file. A duplicate id or path, a parent that is not a route
 * or a route the catalogue does not know is a defect of the design package and throws.
 */
export function buildRoutes(architecture: NavigationArchitecture, catalogue: ScreenCatalogue): WebRoute[] {
  const requirements = new Map(catalogue.map((screen) => [screen.id, screen.req ?? null]));
  const ids = new Set<string>();
  const paths = new Set<string>();
  const routes = architecture.webRoutes.map((route): WebRoute => {
    const path = pathOf(route.module, route.id);
    if (ids.has(route.id)) throw new Error(`Duplicate route id ${route.id}`);
    if (paths.has(path)) throw new Error(`Duplicate route path ${path}`);
    if (!requirements.has(route.id)) throw new Error(`Route ${route.id} is not in the screen catalogue`);
    ids.add(route.id);
    paths.add(path);
    return {
      id: route.id,
      path,
      title: route.title,
      kind: route.kind,
      area: route.area,
      module: route.module,
      group: route.group,
      role: route.role,
      parent: route.parent,
      req: requirements.get(route.id) ?? null,
    };
  });
  for (const route of routes) {
    if (route.parent !== null && !ids.has(route.parent)) throw new Error(`Route ${route.id} has an unknown parent ${route.parent}`);
  }
  return routes;
}

/** The text of the generated data file (JSON, so the Vietnamese design titles stay data); deterministic, LF line endings, one route per line. */
export function renderRoutesData(routes: readonly WebRoute[]): string {
  const lines = routes.map((route, index) => `    ${JSON.stringify(route)}${index < routes.length - 1 ? ',' : ''}`);
  return [
    '{',
    '  "generatedBy": "apps/web/scripts/generate-routes.mjs from navigation_architecture.json and screen_catalog.json; do not edit, run npm run routes:generate -w @machvon/web",',
    '  "routes": [',
    ...lines,
    '  ]',
    '}',
    '',
  ].join('\n');
}
