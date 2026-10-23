import { useTranslation } from '../i18n';
import type { ScreenProps } from './types.ts';

/** Stands in for a screen of the route table whose implementation has not landed yet; the shell around it stays intact. */
export function NotImplementedScreen({ route }: ScreenProps) {
  const { t } = useTranslation();
  return (
    <section role="status" aria-labelledby="screen-title" data-screen-id={route.id}>
      <p>{t('shell.screen.notImplemented.title')}</p>
      <h1 id="screen-title">{route.title}</h1>
      <p>{t('shell.screen.notImplemented.body')}</p>
      <p>
        <code>{route.id}</code>
        {route.req === null ? null : <span> / {route.req}</span>}
      </p>
    </section>
  );
}
