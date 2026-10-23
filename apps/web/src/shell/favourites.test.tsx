import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FAVOURITES, FAVOURITES_STORAGE_KEY, loadFavourites, saveFavourites, useFavourites } from './favourites';

const isWebScreen = (id: string): boolean => ['DIS-15', 'BI-02', 'PRJ-01', 'ADM-01'].includes(id);

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwing = {
  getItem(): string | null {
    throw new Error('blocked');
  },
  setItem(): void {
    throw new Error('blocked');
  },
};

describe('favourites storage', () => {
  it('uses the prototype storage key and defaults', () => {
    expect(FAVOURITES_STORAGE_KEY).toBe('investment-favorites');
    expect(DEFAULT_FAVOURITES).toEqual(['DIS-15', 'BI-02']);
  });

  it('starts from the defaults without a saved value', () => {
    expect(loadFavourites(new MemoryStorage(), isWebScreen)).toEqual(['DIS-15', 'BI-02']);
  });

  it('reads the saved list, dropping screens that are not web screens', () => {
    const storage = new MemoryStorage();
    storage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(['PRJ-01', 'MOB-07', 'ADM-01', 3]));
    expect(loadFavourites(storage, isWebScreen)).toEqual(['PRJ-01', 'ADM-01']);
  });

  it('falls back to the defaults for corrupt or non-list data and when storage throws', () => {
    const storage = new MemoryStorage();
    storage.setItem(FAVOURITES_STORAGE_KEY, '{broken');
    expect(loadFavourites(storage, isWebScreen)).toEqual(DEFAULT_FAVOURITES);
    storage.setItem(FAVOURITES_STORAGE_KEY, '{"a":1}');
    expect(loadFavourites(storage, isWebScreen)).toEqual(DEFAULT_FAVOURITES);
    expect(loadFavourites(throwing, isWebScreen)).toEqual(DEFAULT_FAVOURITES);
    expect(loadFavourites(undefined, isWebScreen)).toEqual(DEFAULT_FAVOURITES);
  });

  it('saves the list and survives a storage that throws', () => {
    const storage = new MemoryStorage();
    saveFavourites(storage, ['ADM-01']);
    expect(storage.getItem(FAVOURITES_STORAGE_KEY)).toBe('["ADM-01"]');
    expect(() => saveFavourites(throwing, ['ADM-01'])).not.toThrow();
    expect(() => saveFavourites(undefined, ['ADM-01'])).not.toThrow();
  });
});

describe('useFavourites', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('pins and unpins a screen and keeps the choice across remounts', () => {
    const first = renderHook(() => useFavourites(isWebScreen));
    expect(first.result.current.favourites).toEqual(['DIS-15', 'BI-02']);
    act(() => first.result.current.toggle('ADM-01'));
    expect(first.result.current.favourites).toEqual(['DIS-15', 'BI-02', 'ADM-01']);
    expect(first.result.current.isPinned('ADM-01')).toBe(true);
    first.unmount();

    const second = renderHook(() => useFavourites(isWebScreen));
    expect(second.result.current.favourites).toEqual(['DIS-15', 'BI-02', 'ADM-01']);
    act(() => second.result.current.toggle('DIS-15'));
    expect(second.result.current.favourites).toEqual(['BI-02', 'ADM-01']);
    expect(second.result.current.isPinned('DIS-15')).toBe(false);
  });
});
