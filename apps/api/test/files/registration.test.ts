import 'reflect-metadata';
import type { TenantDatabase } from '@machvon/db';
import { AppModule } from '../../src/app.module';
import type { AppModuleOptions } from '../../src/app.module';
import { FileService } from '../../src/modules/files';
import { MODULES, controllersOf, providersOf } from '../../src/modules/registry';

const OPTIONS = { database: {} as TenantDatabase, registry: new Map() } as AppModuleOptions;

// The module tests build their controllers and providers by hand; these checks go through the registry that the running
// application is composed from, so a module that is written but not listed there is noticed.
describe('the modules FILES and SEARCH in the composed application', () => {
  it('lists both modules in the registry', () => {
    const codes = MODULES.map((module) => module.code);
    expect(codes).toEqual(expect.arrayContaining(['FILES', 'SEARCH']));
  });

  it('provides the FileService to the application', () => {
    const provided = (list: readonly unknown[]): boolean => list.some((provider) => (provider as { provide?: unknown }).provide === FileService);
    expect(provided(providersOf(OPTIONS))).toBe(true);
    expect(provided(AppModule.register(OPTIONS).providers ?? [])).toBe(true);
  });

  it('mounts the search controller, which answers GET /search', () => {
    const names = controllersOf(OPTIONS).map((controller) => controller.name);
    expect(names).toContain('SearchController');
    const mounted = AppModule.register(OPTIONS).controllers ?? [];
    const search = mounted.find((controller) => controller.name === 'SearchController');
    expect(search).toBeDefined();
    const prototype = (search as { prototype: Record<string, unknown> }).prototype;
    const paths = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata('path', prototype[name] as object) as string);
    expect(paths).toContain('search');
  });
});
