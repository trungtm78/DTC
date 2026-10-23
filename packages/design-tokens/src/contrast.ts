const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#RGB` or `#RRGGBB` (any letter case) into channel values 0 to 255; anything else is a TypeError. */
export function parseHexColor(value: string): [number, number, number] {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new TypeError(`not a hex colour: ${String(value)}`);
  const digits = value.slice(1);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16)) as [number, number, number];
}

function linear(channel: number): number {
  const scaled = channel / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHexColor(hex);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG 2.x contrast ratio between two colours, 1 to 21, independent of their order. */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** `#abc` and `#aabbcc` both become `#AABBCC`. */
export function normaliseHexColor(value: string): string {
  const [red, green, blue] = parseHexColor(value);
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
