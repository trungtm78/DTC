import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiffOptions {
  /** Where the highlighted difference image is written. */
  diffPath: string;
  /** pixelmatch colour distance, 0 (exact) to 1 (anything). Default 0.1, pixelmatch's own default. */
  threshold?: number;
  /** Compare only this part of both images, which may then differ in overall size (a shell frame inside a screen baseline). */
  region?: Region;
}

export interface DiffResult {
  differentPixels: number;
  totalPixels: number;
  /** differentPixels / totalPixels; the visual-regression budget is at most 0.001 per screen. */
  ratio: number;
  diffPath: string;
}

const DEFAULT_THRESHOLD = 0.1;

function readPng(path: string): PNG {
  try {
    return PNG.sync.read(readFileSync(path));
  } catch (error) {
    throw new Error(`cannot read PNG ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function crop(source: PNG, region: Region): PNG {
  const { x, y, width, height } = region;
  if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > source.width || y + height > source.height) {
    throw new Error(`region ${x},${y} ${width}x${height} is outside the ${source.width}x${source.height} image`);
  }
  const part = new PNG({ width, height });
  PNG.bitblt(source, part, x, y, width, height, 0, 0);
  return part;
}

/**
 * Pixel difference of two PNGs of the same size, anti-aliased edge pixels excluded (pixelmatch's detection),
 * so a font hinting wobble does not count but a moved or recoloured element does.
 */
export function diffImages(actualPath: string, expectedPath: string, options: DiffOptions): DiffResult {
  const { region } = options;
  // A region is cut out of each image on its own, so a shell frame can be compared with a screen of another height.
  const actual = region === undefined ? readPng(actualPath) : crop(readPng(actualPath), region);
  const expected = region === undefined ? readPng(expectedPath) : crop(readPng(expectedPath), region);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `image sizes differ: ${actualPath} is ${actual.width}x${actual.height}, ${expectedPath} is ${expected.width}x${expected.height}`,
    );
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const differentPixels = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    includeAA: false,
  });
  mkdirSync(dirname(options.diffPath), { recursive: true });
  writeFileSync(options.diffPath, PNG.sync.write(diff));
  const totalPixels = actual.width * actual.height;
  return { differentPixels, totalPixels, ratio: differentPixels / totalPixels, diffPath: options.diffPath };
}
