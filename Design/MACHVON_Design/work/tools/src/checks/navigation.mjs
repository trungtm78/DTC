import { finding } from './finding.mjs';

// navigation_architecture.json is exported from the prototype at runtime; every catalogued screen
// must be reachable through a route of its own platform, and no route may point elsewhere.

const ROUTE_LISTS = [
  ['web', 'webRoutes'],
  ['mobile', 'mobileRoutes'],
];

export function checkNavigation(model) {
  if (!model.navigation) return [];
  return ROUTE_LISTS.flatMap(([platform, listName]) => {
    const screens = model.screens.filter((screen) => screen.platform === platform).map((screen) => screen.id);
    const routes = (model.navigation[listName] ?? []).map((route) => route.id);
    const catalogued = new Set(screens);
    const routed = new Set(routes);
    return [
      ...screens.filter((id) => !routed.has(id)).map((id) => finding('NAV_ROUTE_MISSING', { screen: id, platform })),
      ...routes.filter((id) => !catalogued.has(id)).map((id) => finding('NAV_ROUTE_UNKNOWN', { screen: id, platform })),
    ];
  });
}
