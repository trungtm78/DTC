import { ICON_PATHS } from './icons';
import type { IconName } from './icons';

/**
 * A decorative icon of the prototype's set. The markup comes from the constant table copied from the design
 * package (never from user input), so it is safe to place inside the svg element.
 */
export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }} />;
}
