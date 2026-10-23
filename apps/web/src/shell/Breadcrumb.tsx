import { useTranslation } from '../i18n';

export interface BreadcrumbProps {
  /** Module name; absent for an address outside the route table. */
  module: string | undefined;
  title: string;
  onOpenModule(): void;
}

/** `Module / Screen`: the module opens its function directory, the screen is the current page. */
export function Breadcrumb({ module, title, onOpenModule }: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <nav className="workspace-breadcrumb" aria-label={t('shell.nav.breadcrumb.label')}>
      {module === undefined ? null : (
        <>
          <button type="button" onClick={onOpenModule}>
            {module}
          </button>
          <span>/</span>
        </>
      )}
      <strong>{title}</strong>
    </nav>
  );
}
