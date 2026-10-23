import type { Provider, Type } from '@nestjs/common';
import type { AppModuleOptions } from '../app.module';

const MODULE_CODE = /^[A-Z]{2,6}$/;

/**
 * What a business module contributes to the application: its controllers and providers, and the condition under
 * which it is active. A slice adds its descriptor to `registry.ts`; `AppModule` composes the registry and is not
 * edited again for that slice.
 */
export interface ModuleDescriptor {
  /** The module code of the design (NOT, ADM, MDM...): two to six capital letters. */
  code: string;
  controllers: readonly Type[];
  providers?: readonly Provider[];
  /** Whether the module is active for these application options; default: always. */
  enabled?(options: AppModuleOptions): boolean;
  /**
   * What the module adds only where the application options carry the control plane (`options.control`). The controllers
   * and providers above stay active without it, so a read that needs no control database is never switched off by it.
   */
  controlPlane?: { controllers: readonly Type[]; providers?: readonly Provider[] };
}

/** Validates and returns a descriptor, so a malformed module fails when the registry is loaded. */
export function defineModule(descriptor: ModuleDescriptor): ModuleDescriptor {
  if (!MODULE_CODE.test(descriptor.code)) {
    throw new Error(`module code ${descriptor.code} must be two to six capital letters`);
  }
  if (descriptor.controllers.length === 0 && (descriptor.providers ?? []).length === 0) {
    throw new Error(`module ${descriptor.code} declares neither controllers or providers`);
  }
  return descriptor;
}
