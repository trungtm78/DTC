import type { ComponentType } from 'react';

/** One web screen of navigation_architecture.json, joined with its requirement id from screen_catalog.json. */
export interface WebRoute {
  id: string;
  /** `/<module>/<id>` in lower case, unique across the table. */
  path: string;
  title: string;
  kind: string;
  area: string;
  module: string;
  group: string;
  role: string;
  parent: string | null;
  /** The functional requirement the screen implements (FR-ADM-01), when the catalogue names one. */
  req: string | null;
}

export interface ScreenProps {
  route: WebRoute;
}

export type ScreenComponent = ComponentType<ScreenProps>;
export type ScreenLoader = () => Promise<{ default: ScreenComponent }>;
