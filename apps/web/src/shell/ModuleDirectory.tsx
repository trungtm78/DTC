import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../i18n';
import { normalizeSearch } from '../navigation/model';
import type { NavigationModel } from '../navigation/model';
import { Icon } from './Icon';
import { NavigationDialog } from './NavigationDialog';

export interface ModuleDirectoryProps {
  navigation: NavigationModel;
  module: string;
  onClose(): void;
}

/** Every function of one module by task group, searchable (the all-functions panel). */
export function ModuleDirectory({ navigation, module, onClose }: ModuleDirectoryProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [query, setQuery] = useState('');
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const groups = navigation.directory(module).map((group) => ({
    title: group.title,
    links: group.links.filter((link) => {
      const haystack = normalizeSearch(`${link.id} ${link.title}`);
      return words.every((word) => haystack.includes(word));
    }),
  }));
  const visibleGroups = groups.filter((group) => group.links.length > 0);

  return (
    <NavigationDialog id="module-directory" className="module-directory" onClose={onClose}>
      <section className="module-directory-panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <span className="directory-eyebrow">{t('shell.directory.eyebrow.text')}</span>
          <button type="button" onClick={onClose} aria-label={t('shell.directory.close.label')}>
            <Icon name="close" />
          </button>
          <h2 id={titleId}>{navigation.moduleName(module)}</h2>
          <p>{t('shell.directory.subtitle')}</p>
        </header>
        <div className="directory-search">
          <Icon name="search" />
          <input
            type="text"
            aria-label={t('shell.directory.search.label')}
            placeholder={t('shell.directory.search.placeholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="directory-sections">
          {visibleGroups.map((group) => (
            <section className="directory-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.links.map((link) => (
                <Link className="directory-link" to={link.path} key={link.id} onClick={onClose}>
                  <span>
                    <strong>{link.title}</strong>
                    <small>{link.primary ? t('shell.directory.link.primary') : t('shell.directory.link.secondary')}</small>
                  </span>
                  <Icon name="chevron" />
                </Link>
              ))}
            </section>
          ))}
          <p className="directory-empty" hidden={visibleGroups.length > 0}>
            {t('shell.directory.empty.text')}
          </p>
        </div>
      </section>
    </NavigationDialog>
  );
}
