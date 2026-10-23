import type { WebRoute } from '../routes/types';
import type { IconName } from '../shell/icons';
import { ICON_PATHS } from '../shell/icons';
import type { NavArchitecture } from './architecture';

/** The i18n keys of the three personal destinations; `labelText` writes each one out. */
export type PersonalLabelKey = 'shell.nav.home.label' | 'shell.nav.tasks.label' | 'shell.nav.notifications.label';

/** A label is either an i18n key (text the shell owns) or text that comes from the design data. */
export type Label = { key: PersonalLabelKey } | { text: string };

export interface NavLink {
  id: string;
  module: string;
  label: Label;
  icon: IconName;
  path: string;
  /** The module has contextual shortcuts that open under the link. */
  expandable: boolean;
}

export interface ShortcutLink {
  id: string;
  label: string;
  path: string;
}

export interface LibraryModule {
  code: string;
  name: string;
  description: string;
  path: string;
}

export interface LibraryArea {
  id: string;
  name: string;
  icon: IconName;
  modules: LibraryModule[];
}

export interface DirectoryLink {
  id: string;
  title: string;
  path: string;
  primary: boolean;
}

export interface DirectoryGroup {
  title: string;
  links: DirectoryLink[];
}

/** Which modules the signed-in user may open; the server still decides every request. */
export interface NavigationAccess {
  isModuleVisible(module: string): boolean;
}

export const ALL_MODULES_VISIBLE: NavigationAccess = { isModuleVisible: () => true };

export interface NavigationModel {
  personal: NavLink[];
  quick: NavLink[];
  shortcuts: ReadonlyMap<string, ShortcutLink[]>;
  /** Every module by area: the "Tất cả ứng dụng" library. */
  library: LibraryArea[];
  /** Only the administration modules: the "Quản trị & cấu hình" library. */
  adminLibrary: LibraryArea[];
  directory(module: string): DirectoryGroup[];
  moduleName(module: string): string;
  breadcrumb(route: WebRoute): { module: string; title: string };
}

const PERSONAL: readonly { id: string; key: PersonalLabelKey; icon: IconName; expandable: boolean }[] = [
  { id: 'HOME-01', key: 'shell.nav.home.label', icon: 'home', expandable: false },
  { id: 'HOME-02', key: 'shell.nav.tasks.label', icon: 'task', expandable: false },
  { id: 'NOT-01', key: 'shell.nav.notifications.label', icon: 'inbox', expandable: true },
];

const DIACRITICS = /[̀-ͯ]/g;

/** Search text of the library and the directory: lower case, no diacritics, đ as d. */
export function normalizeSearch(value: string): string {
  return value.trim().normalize('NFD').replace(DIACRITICS, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICON_PATHS, name);
}

/** The screen id of a module and number, as the prototype writes it: MOD-NN. */
export function screenId(module: string, number: number): string {
  return `${module}-${String(number).padStart(2, '0')}`;
}

/**
 * Builds the navigation of the shell from navigation_architecture.json and the route table. Pure: the same input
 * gives the same model, so it can be tested without a browser.
 */
export function buildNavigation(arch: NavArchitecture, routes: readonly WebRoute[], access: NavigationAccess): NavigationModel {
  const byId = new Map(routes.map((route) => [route.id, route]));
  const visible = (module: string): boolean => access.isModuleVisible(module);
  const nameOf = (module: string): string => arch.modules[module]?.name ?? module;
  const linkTo = (id: string): string | undefined => byId.get(id)?.path;

  const personal: NavLink[] = PERSONAL.flatMap((entry) => {
    const path = linkTo(entry.id);
    return path === undefined ? [] : [{ id: entry.id, module: entry.id.split('-')[0] ?? '', label: { key: entry.key }, icon: entry.icon, path, expandable: entry.expandable }];
  });

  const quick: NavLink[] = arch.quickModules.flatMap(([module, label, icon]) => {
    const id = screenId(module, 1);
    const path = linkTo(id);
    if (!visible(module) || path === undefined || !isIconName(icon)) return [];
    return [{ id, module, label: { text: label }, icon, path, expandable: true }];
  });

  const shortcuts = new Map<string, ShortcutLink[]>();
  for (const [module, entries] of Object.entries(arch.contextualShortcuts)) {
    if (!visible(module)) continue;
    const links = entries.flatMap(([number, label]) => {
      const id = screenId(module, number);
      const path = linkTo(id);
      return path === undefined ? [] : [{ id, label, path }];
    });
    shortcuts.set(module, links);
  }

  const libraryModule = (code: string): LibraryModule | undefined => {
    const path = linkTo(screenId(code, 1));
    if (path === undefined || !visible(code)) return undefined;
    return { code, name: nameOf(code), description: arch.moduleDescriptions[code] ?? '', path };
  };

  const areas = (only?: readonly string[]): LibraryArea[] =>
    arch.libraryGroups.flatMap((group) => {
      if (!isIconName(group.icon)) return [];
      const modules = group.modules
        .filter((code) => only === undefined || only.includes(code))
        .flatMap((code) => libraryModule(code) ?? []);
      return modules.length === 0 ? [] : [{ id: group.id, name: group.name, icon: group.icon, modules }];
    });

  return {
    personal,
    quick,
    shortcuts,
    library: areas(),
    adminLibrary: areas(arch.adminLibraryModules),
    directory(module) {
      if (!visible(module)) return [];
      return (arch.modules[module]?.groups ?? []).map((group) => ({
        title: group.title,
        links: group.ids.flatMap((number) => {
          const id = screenId(module, number);
          const route = byId.get(id);
          return route === undefined ? [] : [{ id, title: route.title, path: route.path, primary: group.primary.includes(number) }];
        }),
      }));
    },
    moduleName: nameOf,
    breadcrumb: (route) => ({ module: nameOf(route.module), title: route.title }),
  };
}
