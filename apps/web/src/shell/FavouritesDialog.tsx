import { useRef } from 'react';
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
        <div role="list">
          {favourites.map((id, index) => (
            <div key={id} role="listitem" className="favorite-settings-row">
              <span>{routeTitle(id) ?? id}</span>
              <button type="button" onClick={() => onMove(id, -1)} aria-label={t('shell.favourites.up.label', { id })} disabled={index === 0}>
                ↑
              </button>
              <button type="button" onClick={() => onMove(id, 1)} aria-label={t('shell.favourites.down.label', { id })} disabled={index === favourites.length - 1}>
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
