import { useEffect, useRef } from 'react';
import { useTranslation } from '../i18n';
import { Icon } from './Icon';
import { NavigationDialog } from './NavigationDialog';

export interface FavouritesDialogProps {
  favourites: readonly string[];
  routeTitle(id: string): string | undefined;
  onMove(id: string, offset: -1 | 1): void;
  onRemove(id: string): void;
  onClose(): void;
}

/** Orders and unpins the pinned screens of the sidebar; the order is stored in the browser. */
export function FavouritesDialog({ favourites, routeTitle, onMove, onRemove, onClose }: FavouritesDialogProps) {
  const { t } = useTranslation();
  const closeButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The row that was just moved and the direction pressed: after the list re-renders, focus goes back into that row.
  const moved = useRef<{ id: string; offset: -1 | 1 } | undefined>(undefined);
  useEffect(() => {
    const target = moved.current;
    moved.current = undefined;
    if (target === undefined) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-favourite-id]') ?? [])].find((item) => item.dataset.favouriteId === target.id);
    const buttons = [...(row?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    // The same arrow if it can still be pressed (several moves in a row), otherwise the other arrow, otherwise unpin.
    const preferred = buttons.find((button) => button.dataset.move === String(target.offset)) ?? buttons.find((button) => button.dataset.move !== undefined) ?? buttons[0];
    (preferred ?? closeButton.current)?.focus();
  }, [favourites]);
  const move = (id: string, offset: -1 | 1): void => {
    moved.current = { id, offset };
    onMove(id, offset);
  };
  // The row that was unpinned takes its button with it; focus goes to the close button so the keyboard stays in the dialog.
  const remove = (id: string): void => {
    onRemove(id);
    closeButton.current?.focus();
  };
  return (
    <NavigationDialog className="navigation-modal" onClose={onClose}>
      <section className="favorite-settings" role="dialog" aria-modal="true" aria-labelledby="favorites-title">
        <header>
          <h2 id="favorites-title">{t('shell.favourites.title')}</h2>
          <button type="button" ref={closeButton} onClick={onClose} aria-label={t('shell.favourites.close.label')}>
            <Icon name="close" />
          </button>
        </header>
        <p>{t('shell.favourites.hint.text')}</p>
        {favourites.length === 0 ? <p>{t('shell.favourites.empty.text')}</p> : null}
        <div role="list" ref={list}>
          {favourites.map((id, index) => (
            <div key={id} role="listitem" className="favorite-settings-row" data-favourite-id={id}>
              <span>{routeTitle(id) ?? id}</span>
              <button type="button" data-move="-1" onClick={() => move(id, -1)} aria-label={t('shell.favourites.up.label', { id })} disabled={index === 0}>
                ↑
              </button>
              <button type="button" data-move="1" onClick={() => move(id, 1)} aria-label={t('shell.favourites.down.label', { id })} disabled={index === favourites.length - 1}>
                ↓
              </button>
              <button type="button" onClick={() => remove(id)} aria-label={t('shell.favourites.remove.label', { id })}>
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </NavigationDialog>
  );
}
