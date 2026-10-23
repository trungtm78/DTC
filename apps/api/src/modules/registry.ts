import type { Provider, Type } from '@nestjs/common';
import type { AppModuleOptions } from '../app.module';
import type { ModuleDescriptor } from './module-descriptor';
import { admModule } from './adm';
import { notificationsModule } from './notifications';
import { sasModule } from './sas';

/** Every business module of the API, sorted by code. A slice adds one line here (one import and one entry). */
export const MODULES: readonly ModuleDescriptor[] = [admModule, notificationsModule, sasModule];

function activeModules(options: AppModuleOptions, modules: readonly ModuleDescriptor[]): ModuleDescriptor[] {
  const codes = new Set<string>();
  for (const module of modules) {
    if (codes.has(module.code)) throw new Error(`module ${module.code} is registered twice`);
    codes.add(module.code);
  }
  return modules.filter((module) => module.enabled?.(options) ?? true);
}

/** The controllers of the active modules, in registry order. */
export function controllersOf(options: AppModuleOptions, modules: readonly ModuleDescriptor[] = MODULES): Type[] {
  return activeModules(options, modules).flatMap((module) => [...module.controllers]);
}

/** The providers of the active modules, in registry order. */
export function providersOf(options: AppModuleOptions, modules: readonly ModuleDescriptor[] = MODULES): Provider[] {
  return activeModules(options, modules).flatMap((module) => [...(module.providers ?? [])]);
}
