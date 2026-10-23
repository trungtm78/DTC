import { useTranslation } from '../i18n';

/** The answer for a location that is not in the route table; like every screen it renders inside the shell. */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <section role="alert" aria-labelledby="not-found-title">
      <h1 id="not-found-title">{t('shell.notFound.title')}</h1>
      <p>{t('shell.notFound.body')}</p>
    </section>
  );
}
