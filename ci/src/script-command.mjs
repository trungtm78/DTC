import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SHELL_SYNTAX = /[&|;<>$`"'()*?]|\$\{/;
// Glob characters that are safe because the receiving program expands them, not a shell.
const PROGRAM_GLOB = /^--[\w-]+=\S*\*\*\S*$/;

function needsShell(tokens) {
  return tokens.some((token) => SHELL_SYNTAX.test(token) && !PROGRAM_GLOB.test(token));
}

// Runs a package script directly (no shell) when it is a plain command, so the single source of
// truth for thresholds stays in package.json and Windows shell-argument warnings do not appear.
export function scriptCommand(packageDir, name) {
  const path = join(packageDir, 'package.json');
  const script = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).scripts?.[name] : undefined;
  const tokens = script?.trim().split(/\s+/);
  if (!tokens || tokens[0] !== 'node' || needsShell(tokens)) return ['npm', ['run', name]];
  return [tokens[0], tokens.slice(1)];
}
