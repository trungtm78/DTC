import { useTranslation } from './i18n';

export function App() {
  const { t } = useTranslation();
  return (
    <main>
      <h1>{t('shell.app.name.title')}</h1>
      <p>{t('shell.app.tagline.text')}</p>
    </main>
  );
}
