// Module rules for the MACHVON monorepo (ST-KERNEL-010). Paths are relative to the repository root.
// A target is matched by its resolved path (workspace symlinks resolve to packages/* and apps/*)
// and by the bare specifier, so the rules also hold when dependencies are not installed.
const OTHER_PACKAGES = '^(packages/(db|contracts)/|@machvon/(db|contracts|api)(/|$))';
const ANY_APP = '^(apps/|@machvon/api(/|$))';

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
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage)/' },
  },
};
