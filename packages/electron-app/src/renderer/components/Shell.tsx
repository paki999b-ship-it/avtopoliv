import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, ProgressBar, cx } from '@irrigo/ui';
import { levelFromXp } from '@shared/xp.js';
import { useSession } from '../store/session.js';
import { useRouter } from '../store/router.js';
import { useOverlay } from '../lib/overlay.js';
import { NAV_ITEMS } from '../lib/sections.js';
import { Logo } from './Logo.js';

/**
 * Каркас окна: боковое меню, шапка с профилем и область содержимого.
 * Прокручивается только содержимое — шапка и меню остаются на месте.
 *
 * Одна и та же разметка обслуживает окно на Windows и экран телефона на
 * Android. Различие ровно одно: на ширине от `lg` меню стоит на месте, ниже —
 * выезжает поверх содержимого по кнопке, потому что 256 px постоянного меню на
 * экране шириной 360 px не оставили бы места самому уроку. Отдельной мобильной
 * копии каркаса нет: два каркаса неизбежно разошлись бы в составе разделов.
 */
export function Shell({
  children,
  onOpenSearch,
}: {
  children: ReactNode;
  /** Поиск открывает App: он же владеет состоянием окна поиска. */
  onOpenSearch?: () => void;
}) {
  const profile = useSession((s) => s.activeProfile);
  const progress = useSession((s) => s.progress);
  const signOut = useSession((s) => s.signOut);
  const route = useRouter((s) => s.route);
  const navigate = useRouter((s) => s.navigate);
  const back = useRouter((s) => s.back);
  const canGoBack = useRouter((s) => s.history.length > 0);

  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Аппаратная «назад» на Android закрывает меню, а не уводит с экрана.
  useOverlay(menuOpen, closeMenu);

  // Переход в раздел закрывает меню: иначе на телефоне выбранный раздел
  // остаётся под шторкой и выглядит как «ничего не произошло».
  useEffect(() => closeMenu(), [route, closeMenu]);

  const level = profile ? levelFromXp(profile.xp) : null;

  return (
    <div className="h-full flex bg-bg">
      {/* Затемнение под выехавшим меню. На широком экране меню не выезжает. */}
      {menuOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          onClick={closeMenu}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      <nav
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-64 shrink-0 flex flex-col border-r border-border bg-surface',
          'transition-transform duration-200 lg:static lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Название бренда есть в самом знаке, подпись под ним его дублировала. */}
        <div className="px-4 py-4 border-b border-border">
          <Logo className="w-full max-w-44 mx-auto" />
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          {NAV_ITEMS.map((item) => {
            const active = route.name === item.name;
            const section = item.progressKey
              ? progress?.sections.find((s) => s.key === item.progressKey)
              : undefined;

            return (
              <button
                key={item.name}
                type="button"
                onClick={() => navigate(item.route)}
                className={cx(
                  'w-full flex items-center gap-3 px-5 py-3 lg:py-2.5 text-left transition-colors',
                  active
                    ? 'bg-accent/10 text-text border-l-2 border-accent'
                    : 'border-l-2 border-transparent text-muted hover:bg-surface-2 hover:text-text',
                )}
              >
                <span className="text-[17px] w-6 text-center shrink-0" aria-hidden>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] truncate">{item.title}</span>
                </span>
                {section && section.total > 0 && (
                  <span className="iw-num text-[11px] text-dim shrink-0">
                    {section.done}/{section.total}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="px-5 py-3 border-t border-border"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={() => navigate({ name: 'settings' })}
            className={cx(
              'w-full flex items-center gap-3 text-left text-[13px] transition-colors',
              route.name === 'settings' ? 'text-text' : 'text-muted hover:text-text',
            )}
          >
            <span aria-hidden>⚙️</span>
            <span>Настройки профиля</span>
          </button>
        </div>
      </nav>

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="shrink-0 flex items-center gap-2 sm:gap-3 h-14 px-3 sm:px-6 border-b border-border bg-surface/60"
          style={{ marginTop: 'env(safe-area-inset-top)' }}
        >
          {/* Меню и «назад» — разные действия: первое открывает список
              разделов, второе возвращает на шаг. На телефоне нужны оба. */}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Разделы"
            className="lg:hidden px-2 py-1.5 -ml-1 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors"
          >
            <span className="text-[18px]" aria-hidden>
              ☰
            </span>
          </button>

          <Button
            variant="ghost"
            size="sm"
            disabled={!canGoBack}
            onClick={back}
            aria-label="Назад"
          >
            <span className="hidden sm:inline">← Назад</span>
            <span className="sm:hidden" aria-hidden>
              ←
            </span>
          </Button>

          <div className="flex-1" />

          {profile && level && (
            <div className="flex items-center gap-2 sm:gap-4">
              {/* На телефоне у поиска нет Ctrl+F — нужна кнопка. */}
              {onOpenSearch && (
                <button
                  type="button"
                  onClick={onOpenSearch}
                  aria-label="Поиск по приложению"
                  title="Поиск (Ctrl+F)"
                  className="lg:hidden px-2 py-1.5 rounded-lg text-muted hover:text-text hover:bg-surface-2 transition-colors"
                >
                  <span className="text-[16px]" aria-hidden>
                    🔍
                  </span>
                </button>
              )}

              {/* Стрик — про регулярный полив, поэтому капля, а не огонь.
                  Тон тоже сменён: янтарный в интерфейсе означает
                  предупреждение, а серия дней — это не предупреждение. */}
              {profile.streakDays > 0 && (
                <Badge tone="info" className="hidden sm:inline-flex shrink-0">
                  💧 {profile.streakDays} дн.
                </Badge>
              )}
              <div className="w-44 hidden lg:block">
                <ProgressBar
                  size="sm"
                  value={level.xpIntoLevel / level.xpForNextLevel}
                  label={`Уровень ${level.level}`}
                  hint={`${level.xpIntoLevel}/${level.xpForNextLevel} XP`}
                />
              </div>
              <button
                type="button"
                onClick={signOut}
                title="Сменить профиль"
                className="flex items-center gap-2 pl-2 sm:pl-3 pr-2 py-1.5 rounded-lg border border-border bg-surface-2 hover:border-border-strong transition-colors"
              >
                <span className="text-[15px]" aria-hidden>
                  {profile.avatar}
                </span>
                <span className="text-[13px] max-w-20 sm:max-w-28 truncate hidden sm:inline">
                  {profile.name}
                </span>
                <span className="text-dim text-[12px]">⇄</span>
              </button>
            </div>
          )}
        </header>

        <main
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
