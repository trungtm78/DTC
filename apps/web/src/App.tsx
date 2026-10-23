import { TOKENS } from '@machvon/design-tokens';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useTranslation } from './i18n';
import { resolveScreen, routeById } from './routes/registry';
import { NotFound } from './routes/NotFound';
import { WEB_ROUTES } from './routes/routes.generated';
import type { ScreenLoader, WebRoute } from './routes/types';
import { Shell } from './shell/Shell';
import { useSession } from './session/SessionContext';
import { StateBoundary } from './states/StateBoundary';
import { BASE_THEME, ThemeProvider } from './theme/ThemeProvider';

const HOME = 'HOME-01';

export interface AppRoutesProps {
  /** Screen implementations by id; defaults to the registry. Tests pass their own. */
  screenModules?: Readonly<Record<string, ScreenLoader>>;
}

function ScreenHost({ route, screenModules }: { route: WebRoute; screenModules: AppRoutesProps['screenModules'] }) {
  const session = useSession();
  if (session.tenant === undefined) return <StateBoundary state="expired" />;
  const Screen = resolveScreen(route.id, screenModules);
  return (
    <Suspense fallback={<StateBoundary state="loading" />}>
      <Screen route={route} />
    </Suspense>
  );
}

/** The route tree: the shell around every screen of the route table, a redirect from the root and the not-found state. */
export function AppRoutes({ screenModules }: AppRoutesProps) {
  const session = useSession();
  return (
    <ThemeProvider base={TOKENS} theme={session.tenant?.theme ?? BASE_THEME}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to={routeById(HOME)?.path ?? '/'} replace />} />
          {WEB_ROUTES.map((route) => (
            <Route key={route.id} path={route.path} element={<ScreenHost route={route} screenModules={screenModules} />} />
          ))}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}

// The development session is only imported when the build is a development one: `import.meta.env.DEV` is a
// constant false in production, so the bundler drops the branch and the module never reaches the bundle.
const DevSessionProvider = import.meta.env.DEV ? lazy(() => import('./session/DevSessionProvider')) : undefined;

function AppSession({ children }: { children: ReactNode }) {
  if (DevSessionProvider === undefined) return <>{children}</>;
  return (
    <Suspense fallback={null}>
      <DevSessionProvider>{children}</DevSessionProvider>
    </Suspense>
  );
}

const queryClient = new QueryClient();

/** The browser tab title: the application name and tagline in the current language. */
function DocumentTitle() {
  const { t, locale } = useTranslation();
  useEffect(() => {
    document.title = `${t('shell.app.name.title')} · ${t('shell.app.tagline.text')}`;
  }, [t, locale]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DocumentTitle />
      <AppSession>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppSession>
    </QueryClientProvider>
  );
}
