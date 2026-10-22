import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const KEY_VALUE_RECEIVERS = 'store|redis|kv';
const KEY_VALUE_STORE_MESSAGE =
  'KeyValueStore may only be used in packages/kernel/src/tenant-keys.ts, packages/kernel/src/index.ts and packages/kernel/src/adapters/**; other code receives a TenantCache so keys carry the t:{tenantId}: prefix.';
const RAW_STORE_MESSAGE =
  'Direct .get/.set on a key-value store is forbidden outside packages/kernel/src/tenant-keys.ts; use TenantCache so keys carry the t:{tenantId}: prefix.';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/lint-fixtures/**', '**/*.generated.ts', 'Design/**', 'ci/**', 'docs/**', 'backend/**', '.tools/**', '.superpowers/**', '.claude/**', '.gstack/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': 'error',
    },
  },
  {
    // Raw key-value access must go through TenantCache so every key carries the tenant prefix.
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.property.name=/^(get|set)$/][callee.object.name=/^(${KEY_VALUE_RECEIVERS})$/]`,
          message: RAW_STORE_MESSAGE,
        },
        {
          selector: `CallExpression[callee.property.name=/^(get|set)$/][callee.object.property.name=/^(${KEY_VALUE_RECEIVERS})$/]`,
          message: RAW_STORE_MESSAGE,
        },
        {
          selector: "TSImportType[qualifier.name='KeyValueStore']",
          message: KEY_VALUE_STORE_MESSAGE,
        },
      ],
      // Adapter boundary: the KeyValueStore type cannot be imported by name outside its allowed homes.
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: '@machvon/kernel', importNames: ['KeyValueStore'], message: KEY_VALUE_STORE_MESSAGE }],
          patterns: [
            { group: ['**/tenant-keys', '**/tenant-keys.ts', '**/tenant-keys.js'], importNames: ['KeyValueStore'], message: KEY_VALUE_STORE_MESSAGE },
          ],
        },
      ],
    },
  },
  {
    // Allowed homes of the store abstraction: its definition, the public re-export and store adapters.
    files: ['packages/kernel/src/tenant-keys.ts', 'packages/kernel/src/index.ts', 'packages/kernel/src/adapters/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off', 'no-restricted-imports': 'off' },
  },
  {
    // Tests implement in-memory stores to exercise TenantCache.
    files: ['**/*.test.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: { globals: { ...globals.jest } },
  },
);
