import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from '@swc/core';

// Same compiler options as the jest transform of this package: decorators and their metadata are what Nest injects by.
const OPTIONS = {
  jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, keepClassNames: true },
  module: { type: 'es6' },
  sourceMaps: 'inline',
};

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.ts') || url.includes('/node_modules/@swc/')) return nextLoad(url, context);
  const source = await readFile(fileURLToPath(url), 'utf8');
  const { code } = await transform(source, { ...OPTIONS, filename: fileURLToPath(url) });
  return { format: 'module', source: code, shortCircuit: true };
}

const HAS_EXTENSION = /\.[cm]?[jt]s$|\.json$/;

// The sources import their siblings without an extension (as the compiler and jest resolve them).
export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && !HAS_EXTENSION.test(specifier)) {
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await nextResolve(`${specifier}${suffix}`, context);
      } catch {
        // try the next form
      }
    }
  }
  return nextResolve(specifier, context);
}
