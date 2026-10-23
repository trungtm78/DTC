import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DesignTokens } from '../src/types.ts';

export const REPO_ROOT = resolve(__dirname, '..', '..', '..');
export const DESIGN_DIR = join(REPO_ROOT, 'Design', 'MACHVON_Design');
export const TOKENS_JSON_PATH = join(DESIGN_DIR, '04_Design_Assets', 'design_tokens.json');
export const THEME_SPEC_PATH = join(DESIGN_DIR, '03_Engineering', 'Tenant_Theme_Specification.html');
export const PROTOTYPE_THEME_PATH = join(DESIGN_DIR, '02_Prototype', 'tenant-theme.js');

export function realDesignTokens(): DesignTokens {
  return JSON.parse(readFileSync(TOKENS_JSON_PATH, 'utf8')) as DesignTokens;
}
