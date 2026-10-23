# API module registry

A business module (one code of the design: `NOT`, `ADM`, `MDM`...) is described by a `ModuleDescriptor`
(`module-descriptor.ts`) and listed in `registry.ts`. `AppModule` composes the registry (`controllersOf`,
`providersOf`), so a new slice does not edit `app.module.ts`.

To add a module:

1. Create `apps/api/src/modules/<code>/` with the controllers, services and tests of the slice, and an `index.ts`
   that exports `defineModule({ code, controllers, providers?, enabled? })`.
2. Add one import and one entry to `MODULES` in `registry.ts` (keep the list sorted by code).
3. Put the slice's migrations in its block (`db/migrations/BLOCKS.md`; `npm run migrations:check`).
4. Operations still need the usual gates: `@Command`, a negative-matrix row, a request body registration
   (`npm run commands:check`).

`enabled(options)` makes a module conditional on the application options (for example a module that needs the
control-plane database). The worked example is `notifications/`, whose implementation still lives in
`apps/api/src/notifications`; moving existing code into `modules/` is done per module, with its tests, when that
module is next touched.
