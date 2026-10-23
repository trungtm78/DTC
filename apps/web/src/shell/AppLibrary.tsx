import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { normalizeSearch } from '../navigation/model';
import type { LibraryArea, NavigationModel } from '../navigation/model';
import { WEB_ROUTES } from '../routes/web-routes';
import { Icon } from './Icon';
import { NavigationDialog } from './NavigationDialog';

export type LibraryScope = 'all' | 'admin';

export interface AppLibraryProps {
  navigation: NavigationModel;
  scope: LibraryScope;
  workspaceName: string;
  onClose(): void;
}

/** The searchable list of every application or only the administration ones. */
export function AppLibrary({ navigation, scope, workspaceName, onClose }: AppLibraryProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState('');
  const areas: LibraryArea[] = scope === 'admin' ? navigation.adminLibrary : navigation.library;
  const allowed = useMemo(() => new Set(areas.flatMap((area) => area.modules.map((module) => module.code))), [areas]);
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const found =
    words.length === 0
      ? []
      : WEB_ROUTES.filter((route) => {
          if (!allowed.has(route.module)) return false;
          const haystack = normalizeSearch(`${route.id} ${route.title} ${navigation.moduleName(route.module)}`);
          return words.every((word) => haystack.includes(word));
        });
  const title = scope === 'admin' ? t('shell.library.admin.title') : t('shell.library.all.title');
  const subtitle = scope === 'admin' ? t('shell.library.admin.subtitle') : t('shell.library.all.subtitle');

  return (
    <NavigationDialog className="navigation-modal application-library" onClose={onClose}>
      <section className="application-library-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div>
            <span className="directory-eyebrow">{t('shell.library.eyebrow.text', { name: workspaceName.toLocaleUpperCase('vi') })}</span>
            <h2 id={titleId}>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('shell.library.close.label')}>
            <Icon name="close" />
          </button>
        </header>
        <label className="library-search">
          <Icon name="search" />
          <input
            type="text"
            aria-label={t('shell.library.search.label')}
            placeholder={t('shell.library.search.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>{t('shell.library.escape.key')}</kbd>
        </label>
        <div id="application-results">
          {words.length > 0 ? (
            <>
              <p className="library-result-count" role="status">
                {t('shell.library.results.count', { count: found.length })}
              </p>
              <div className="library-search-results">
                {found.map((route) => (
                  <Link to={route.path} key={route.id} onClick={onClose}>
                    <span>
                      <strong>{route.title}</strong>
                      <small>{navigation.moduleName(route.module)}</small>
                    </span>
                    <Icon name="chevron" />
                  </Link>
                ))}
                {found.length === 0 ? <p className="library-empty">{t('shell.library.results.empty')}</p> : null}
              </div>
            </>
          ) : (
            areas.map((area) => (
              <section className="library-group" key={area.id}>
                <h3>{area.name}</h3>
                <div className="application-grid">
                  {area.modules.map((module) => (
                    <Link className="application-card" to={module.path} key={module.code} onClick={onClose}>
                      <span className="application-card-icon">
                        <Icon name={area.icon} />
                      </span>
                      <span>
                        <strong>{module.name}</strong>
                        <small>{module.description}</small>
                      </span>
                      <Icon name="chevron" />
                    </Link>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
        <footer>{t('shell.library.footer.text')}</footer>
      </section>
    </NavigationDialog>
  );
}
