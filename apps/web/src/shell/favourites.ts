import { useCallback, useState } from 'react';

/** The key and the starting list of the prototype (workspace-navigation.js), so both read the same browser data. */
export const FAVOURITES_STORAGE_KEY = 'investment-favorites';
export const DEFAULT_FAVOURITES: readonly string[] = ['DIS-15', 'BI-02'];

/** The part of Storage the shell needs; a blocked or missing storage must never break the page. */
export interface FavouritesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadFavourites(storage: FavouritesStorage | undefined, isWebScreen: (id: string) => boolean): string[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(FAVOURITES_STORAGE_KEY) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((id): id is string => typeof id === 'string' && isWebScreen(id));
  } catch {
    // Unreadable data or a blocked storage: start from the defaults, the pins are a convenience.
  }
  return [...DEFAULT_FAVOURITES];
}

export function saveFavourites(storage: FavouritesStorage | undefined, favourites: readonly string[]): void {
  try {
    storage?.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(favourites));
  } catch {
    // A full or blocked storage only loses the pins of the next session.
  }
}

function browserStorage(): FavouritesStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The pinned screens of the sidebar, persisted in the browser. */
export function useFavourites(isWebScreen: (id: string) => boolean) {
  const [favourites, setFavourites] = useState<string[]>(() => loadFavourites(browserStorage(), isWebScreen));
  const toggle = useCallback(
    (id: string) => {
      const next = favourites.includes(id) ? favourites.filter((entry) => entry !== id) : [...favourites, id];
      setFavourites(next);
      saveFavourites(browserStorage(), next);
    },
    [favourites],
  );
  const isPinned = useCallback((id: string) => favourites.includes(id), [favourites]);
  return { favourites, toggle, isPinned };
}
