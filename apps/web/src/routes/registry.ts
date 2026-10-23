import { lazy } from 'react';
import { NotImplementedScreen } from './NotImplementedScreen';
import { WEB_ROUTES } from './web-routes.ts';
import { screenModules } from './screens/index';
import type { ScreenComponent, ScreenLoader, WebRoute } from './types.ts';

const BY_ID: ReadonlyMap<string, WebRoute> = new Map(WEB_ROUTES.map((route) => [route.id, route]));
const BY_PATH: ReadonlyMap<string, WebRoute> = new Map(WEB_ROUTES.map((route) => [route.path, route]));

export function routeById(id: string): WebRoute | undefined {
  return BY_ID.get(id);
}

/** The route of a location path; the match ignores case and a trailing slash. */
export function routeByPath(path: string): WebRoute | undefined {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return BY_PATH.get(trimmed.toLowerCase());
}

const loaded = new Map<ScreenLoader, ScreenComponent>();

function lazyScreen(loader: ScreenLoader): ScreenComponent {
  const known = loaded.get(loader);
  if (known !== undefined) return known;
  const component = lazy(loader);
  loaded.set(loader, component);
  return component;
}

/**
 * The component of a screen: the lazily loaded implementation when one is registered for the id (one chunk per
 * screen module), otherwise the shared "not implemented yet" screen, so every route of the table can be opened.
 */
export function resolveScreen(id: string, modules: Readonly<Record<string, ScreenLoader>> = screenModules): ScreenComponent {
  const loader = modules[id];
  return loader === undefined ? NotImplementedScreen : lazyScreen(loader);
}
