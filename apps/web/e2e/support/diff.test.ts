import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { diffImages } from './diff.ts';

const WORK = mkdtempSync(join(tmpdir(), 'machvon-diff-'));

/** A solid PNG; `marks` paints single pixels so a test can place a precise difference. */
function writePng(name: string, width: number, height: number, marks: Array<{ x: number; y: number; rgb: [number, number, number] }> = []): string {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 255;
    png.data[i * 4 + 2] = 255;
    png.data[i * 4 + 3] = 255;
  }
  for (const { x, y, rgb } of marks) {
    const at = (y * width + x) * 4;
    png.data[at] = rgb[0];
    png.data[at + 1] = rgb[1];
    png.data[at + 2] = rgb[2];
  }
  const path = join(WORK, name);
  writeFileSync(path, PNG.sync.write(png));
  return path;
}

test('identical images have a zero ratio and write a diff image of the same size', () => {
  const a = writePng('same-a.png', 20, 10);
  const b = writePng('same-b.png', 20, 10);
  const result = diffImages(a, b, { diffPath: join(WORK, 'same-diff.png') });
  assert.deepEqual(
    { differentPixels: result.differentPixels, totalPixels: result.totalPixels, ratio: result.ratio },
    { differentPixels: 0, totalPixels: 200, ratio: 0 },
  );
  const diff = PNG.sync.read(readFileSync(result.diffPath));
  assert.deepEqual([diff.width, diff.height], [20, 10]);
});

test('one changed pixel is counted and gives its share of all pixels', () => {
  const a = writePng('one-a.png', 20, 10);
  const b = writePng('one-b.png', 20, 10, [{ x: 7, y: 3, rgb: [0, 0, 0] }]);
  const result = diffImages(a, b, { diffPath: join(WORK, 'one-diff.png') });
  assert.equal(result.differentPixels, 1);
  assert.equal(result.ratio, 1 / 200);
});

test('a difference below the colour threshold is ignored and one above it is counted', () => {
  const a = writePng('thr-a.png', 8, 8);
  const faint = writePng('thr-faint.png', 8, 8, [{ x: 2, y: 2, rgb: [250, 250, 250] }]);
  const strong = writePng('thr-strong.png', 8, 8, [{ x: 2, y: 2, rgb: [120, 120, 120] }]);
  assert.equal(diffImages(a, faint, { diffPath: join(WORK, 'thr-1.png') }).differentPixels, 0);
  assert.equal(diffImages(a, strong, { diffPath: join(WORK, 'thr-2.png') }).differentPixels, 1);
});

test('images of different sizes are refused with both sizes in the message', () => {
  const a = writePng('size-a.png', 20, 10);
  const b = writePng('size-b.png', 20, 11);
  assert.throws(() => diffImages(a, b, { diffPath: join(WORK, 'size-diff.png') }), /20x10.*20x11/);
});

test('a region limits the comparison to that part of both images', () => {
  const a = writePng('region-a.png', 20, 10);
  const b = writePng('region-b.png', 20, 10, [{ x: 15, y: 8, rgb: [0, 0, 0] }]);
  const left = diffImages(a, b, { diffPath: join(WORK, 'region-left.png'), region: { x: 0, y: 0, width: 10, height: 10 } });
  assert.deepEqual([left.differentPixels, left.totalPixels], [0, 100]);
  const right = diffImages(a, b, { diffPath: join(WORK, 'region-right.png'), region: { x: 10, y: 0, width: 10, height: 10 } });
  assert.deepEqual([right.differentPixels, right.totalPixels], [1, 100]);
});

test('a region outside the image is refused', () => {
  const a = writePng('out-a.png', 20, 10);
  const b = writePng('out-b.png', 20, 10);
  assert.throws(() => diffImages(a, b, { diffPath: join(WORK, 'out-diff.png'), region: { x: 15, y: 0, width: 10, height: 10 } }), /region/);
});

test('a missing file is reported by path', () => {
  const a = writePng('miss-a.png', 4, 4);
  assert.throws(() => diffImages(a, join(WORK, 'absent.png'), { diffPath: join(WORK, 'miss-diff.png') }), /absent\.png/);
});

test('with a region the two images may differ in overall size', () => {
  const a = writePng('reg-size-a.png', 20, 10);
  const b = writePng('reg-size-b.png', 20, 14, [{ x: 3, y: 2, rgb: [0, 0, 0] }]);
  const result = diffImages(a, b, { diffPath: join(WORK, 'reg-size-diff.png'), region: { x: 0, y: 0, width: 10, height: 5 } });
  assert.deepEqual([result.differentPixels, result.totalPixels], [1, 50]);
});
