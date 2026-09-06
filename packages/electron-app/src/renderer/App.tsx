import { useCallback, useEffect, useState } from 'react';
import { Button } from '@irrigo/ui';
import { useSession } from './store/session.js';
import { useRouter } from './store/router.js';
import type { Route } from './store/router.js';
import { Shell } from './components/Shell.js';
import { ProfileSelect } from './screens/ProfileSelect.js';
import { Home } from './screens/Home.js';
import { Calculators } from './screens/Calculators.js';
import { Reference } from './screens/Reference.js';
import { Academy } from './screens/Academy.js';
import { LayoutTrainer } from './screens/LayoutTrainer.js';
import { Assembly } from './screens/Assembly.js';
import { ErrorHunt } from './screens/ErrorHunt.js';
import { Diagnostics } from './screens/Diagnostics.js';
import { Safety } from './screens/Safety.js';
import { Exam } from './screens/Exam.js';
import { GlobalSearch, useGlobalSearchHotkey } from './components/GlobalSearch.js';
import { Settings } from './screens/Settings.js';
import { Pending } from './screens/Pending.js';
import { applyTheme } from './lib/theme.js';

export function App() {
  const ready = useSession((s) => s.ready);
  const error = useSession((s) => s.error);
  const clearError = useSession((s) => s.clearError);
  const bootstrap = useSession((s) => s.bootstrap);
  const activeProfile = useSession((s) => s.activeProfile);
  const route = useRouter((s) => s.route);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /*
   * Тема — настройка профиля, поэтому она применяется при выборе профиля и
   * при её смене. До выбора профиля остаётся тёмная: экран выбора общий, и
   * подставлять чью-то чужую тему на нём не из чего.
   */
  useEffect(() => {
    applyTheme(activeProfile?.theme ?? 'dark');
  }, [activeProfile?.theme]);

  // Поиск доступен только при выбранном профиле: до этого разделов нет.
  const openSearch = useCallback(() => {
    if (activeProfile) setSearchOpen(true);
  }, [activeProfile]);
  useGlobalSearchHotkey(openSearch);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center text-dim">
        Загрузка базы знаний…
      </div>
    );
  }

  // Пока профиль не выбран, никакой раздел не открывается: у каждого
  // профиля свой прогресс, и показывать разделы «ничьими» нельзя.
  const content = !activeProfile ? (
    <ProfileSelect />
  ) : (
    <Shell onOpenSearch={openSearch}>{renderRoute(route)}</Shell>
  );

  return (
    <div className="h-full">
      {error && (
        <div className="flex items-start gap-3 px-6 py-3 bg-danger-dim border-b border-danger/40">
          <span className="text-danger" aria-hidden>
            ⚠
          </span>
          <p className="flex-1 text-[13px]">{error}</p>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Скрыть
          </Button>
        </div>
      )}
      <div className={error ? 'h-[calc(100%-49px)]' : 'h-full'}>{content}</div>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'calculators':
      return <Calculators />;
    case 'reference':
      return <Reference />;
    case 'academy':
    case 'lesson':
      return <Academy />;
    case 'layout':
      return <LayoutTrainer />;
    case 'assembly':
      return <Assembly />;
    case 'errors':
      return <ErrorHunt />;
    case 'diagnostics':
      return <Diagnostics />;
    case 'safety':
      return <Safety />;
    case 'exam':
      return <Exam />;
    case 'settings':
      return <Settings />;
    default:
      return <Pending sectionName={route.name} />;
  }
}
