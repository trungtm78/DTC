import { useEffect, useState } from 'react';

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** Whether a CSS media query matches now, kept up to date while the window changes. */
export function useMediaQuery(query: string): boolean {
  const [value, setValue] = useState(() => matches(query));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const update = (): void => setValue(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return value;
}
