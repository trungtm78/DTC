import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const KEY_VALUE_RECEIVERS = 'store|redis|kv';
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
      ],
    },
  },
  {
    files: ['packages/kernel/src/tenant-keys.ts'],
    rules: { 'no-restricted-syntax': 'off' },
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
