// Module rules for the MACHVON monorepo (ST-KERNEL-010). Paths are relative to the repository root.
// A target is matched by its resolved path (workspace symlinks resolve to packages/* and apps/*)
// and by the bare specifier, so the rules also hold when dependencies are not installed.
const OTHER_PACKAGES = '^(packages/(db|contracts|api-client|design-tokens)/|@machvon/(db|contracts|api-client|design-tokens|api|web)(/|$))';
const ANY_APP = '^(apps/|@machvon/(api|web)(/|$))';
// Imports that apps/web must never have: server-side workspaces and the API app.
const WEB_FORBIDDEN = '^(packages/(kernel|db)/|apps/api/|@machvon/(kernel|db|api)(/|$))';
// design-tokens is framework-free and imports no workspace; api-client reaches only the contracts.
const TOKENS_FORBIDDEN = '^(packages/(kernel|db|contracts|api-client)/|@machvon/(kernel|db|contracts|api-client)(/|$))';
const CLIENT_FORBIDDEN = '^(packages/(kernel|db|design-tokens)/|@machvon/(kernel|db|design-tokens)(/|$))';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'kernel-imports-nothing-from-other-packages',
      comment: '@machvon/kernel is the dependency-free core; it must not import other workspaces.',
      severity: 'error',
      from: { path: '^packages/kernel/' },
      to: { path: `${OTHER_PACKAGES}|${ANY_APP}` },
    },
    {
      name: 'packages-must-not-import-apps',
      comment: 'Dependencies point from apps/* to packages/*, never the other way.',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: ANY_APP },
    },
    {
      name: 'design-tokens-imports-no-workspace',
      comment: '@machvon/design-tokens is framework-free and imports nothing from other workspaces.',
      severity: 'error',
      from: { path: '^packages/design-tokens/' },
      to: { path: TOKENS_FORBIDDEN },
    },
    {
      name: 'api-client-imports-contracts-only',
      comment: '@machvon/api-client may import @machvon/contracts and nothing else from the workspaces.',
      severity: 'error',
      from: { path: '^packages/api-client/' },
      to: { path: CLIENT_FORBIDDEN },
    },
    {
      name: 'web-imports-allowed-packages-only',
      comment: 'apps/web may import design-tokens, api-client and contracts (types) only, never server-side code.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: WEB_FORBIDDEN },
    },
    {
      name: 'api-does-not-import-web',
      comment: 'Apps do not depend on each other.',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^(apps/web/|@machvon/web(/|$))' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage)/' },
  },
};
