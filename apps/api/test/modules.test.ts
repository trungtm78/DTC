import 'reflect-metadata';
import { Controller } from '@nestjs/common';
import type { TenantDatabase } from '@machvon/db';
import { AppModule } from '../src/app.module';
import type { AppModuleOptions } from '../src/app.module';
import { defineModule } from '../src/modules/module-descriptor';
import { MODULES, controllersOf, providersOf } from '../src/modules/registry';

const OPTIONS = { database: {} as TenantDatabase, registry: new Map() } as AppModuleOptions;
const MODULE_CODE = /^[A-Z]{2,6}$/;

@Controller('example-a')
class ExampleAController {}

@Controller('example-b')
class ExampleBController {}

describe('module registry', () => {
  it('lists modules with unique, upper-case, sorted codes', () => {
    const codes = MODULES.map((module) => module.code);
    expect(codes.every((code) => MODULE_CODE.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...codes].sort()).toEqual(codes);
  });

  it('only lists classes that are Nest controllers, and none twice', () => {
    const controllers = MODULES.flatMap((module) => [...module.controllers, ...(module.controlPlane?.controllers ?? [])]);
    for (const controller of controllers) expect(Reflect.getMetadata('path', controller)).toBeDefined();
    expect(new Set(controllers).size).toBe(controllers.length);
  });

  it('composes the registered controllers into AppModule without duplicates', () => {
    const composed = AppModule.register(OPTIONS).controllers ?? [];
    expect(new Set(composed).size).toBe(composed.length);
    for (const controller of controllersOf(OPTIONS)) expect(composed).toContain(controller);
  });

  it('registers the control-plane controllers only where the control plane is configured, and the tenant reads always', () => {
    const without = controllersOf(OPTIONS).map((controller) => controller.name);
    expect(without).toContain('TenantThemeController');
    expect(without).not.toContain('ThemeController');
    expect(without).not.toContain('TenantStateController');
    const withControl = controllersOf({ ...OPTIONS, control: {} } as AppModuleOptions).map((controller) => controller.name);
    expect(withControl).toEqual(expect.arrayContaining(['TenantThemeController', 'ThemeController', 'TenantStateController', 'TenantOwnerController']));
    // The theme store serves both; the bootstrap store belongs to the control plane.
    const sasProviders = (options: AppModuleOptions): string[] =>
      providersOf(options)
        .map((provider) => (provider as { provide?: { name?: string } }).provide?.name ?? '')
        .filter((name) => name === 'ThemeStore' || name === 'TenantBootstrapStore');
    expect(sasProviders(OPTIONS)).toEqual(['ThemeStore']);
    expect(sasProviders({ ...OPTIONS, control: {} } as AppModuleOptions)).toEqual(['ThemeStore', 'TenantBootstrapStore']);
  });

  it('keeps the notification controllers registered through the notifications module', () => {
    const names = controllersOf(OPTIONS).map((controller) => controller.name);
    expect(names).toEqual(expect.arrayContaining(['NotificationsController', 'NotificationInstancesController']));
    expect(MODULES.some((module) => module.code === 'NOT')).toBe(true);
  });
});

describe('defineModule', () => {
  it('returns the descriptor with defaults: always enabled, no providers', () => {
    const module = defineModule({ code: 'EXA', controllers: [ExampleAController] });
    expect(module.code).toBe('EXA');
    expect(module.enabled?.(OPTIONS) ?? true).toBe(true);
    expect(module.providers ?? []).toEqual([]);
  });

  it('skips the controllers and providers of a module that is not enabled for the options', () => {
    const provider = { provide: 'EXAMPLE', useValue: 1 };
    const on = defineModule({ code: 'ONN', controllers: [ExampleAController], providers: [provider] });
    const off = defineModule({ code: 'OFF', controllers: [ExampleBController], providers: [{ provide: 'OFF', useValue: 2 }], enabled: () => false });
    expect(controllersOf(OPTIONS, [on, off])).toEqual([ExampleAController]);
    expect(providersOf(OPTIONS, [on, off])).toEqual([provider]);
  });

  it('adds the control-plane part of a module only when the options carry the control plane', () => {
    const provider = { provide: 'CTRL', useValue: 3 };
    const module = defineModule({ code: 'CPL', controllers: [ExampleAController], controlPlane: { controllers: [ExampleBController], providers: [provider] } });
    expect(controllersOf(OPTIONS, [module])).toEqual([ExampleAController]);
    expect(providersOf(OPTIONS, [module])).toEqual([]);
    const withControl = { ...OPTIONS, control: {} } as AppModuleOptions;
    expect(controllersOf(withControl, [module])).toEqual([ExampleAController, ExampleBController]);
    expect(providersOf(withControl, [module])).toEqual([provider]);
    const off = defineModule({ code: 'OFF', controllers: [ExampleAController], controlPlane: { controllers: [ExampleBController] }, enabled: () => false });
    expect(controllersOf(withControl, [off])).toEqual([]);
  });

  it('refuses a code that is not two to six capital letters and a module without controllers or providers', () => {
    expect(() => defineModule({ code: 'not', controllers: [ExampleAController] })).toThrow(/code/);
    expect(() => defineModule({ code: 'EMP', controllers: [] })).toThrow(/controllers or providers/);
  });

  it('refuses the same code twice in one registry', () => {
    const first = defineModule({ code: 'DUP', controllers: [ExampleAController] });
    const second = defineModule({ code: 'DUP', controllers: [ExampleBController] });
    expect(() => controllersOf(OPTIONS, [first, second])).toThrow(/DUP/);
  });
});
