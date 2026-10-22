// Runs ESLint's Node API against the root config in a plain Node process. Jest cannot load the
// ESM flat config (dynamic import needs --experimental-vm-modules), so tests spawn this helper.
// Usage: node run-eslint.mjs <repoRoot> file <path>
//        node run-eslint.mjs <repoRoot> text <virtualPath>   (source code on stdin)
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const [repoRoot, mode, target] = process.argv.slice(2);
if (repoRoot === undefined || target === undefined || (mode !== 'file' && mode !== 'text')) {
  process.stderr.write('usage: run-eslint.mjs <repoRoot> <file|text> <path>\n');
  process.exit(2);
}

const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
  ignore: false,
});

const results =
  mode === 'file' ? await eslint.lintFiles([target]) : await eslint.lintText(readFileSync(0, 'utf8'), { filePath: target });

process.stdout.write(JSON.stringify(results.map((r) => r.messages.map((m) => ({ ruleId: m.ruleId, message: m.message })))));
