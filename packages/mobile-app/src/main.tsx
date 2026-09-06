import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AppScreen } from '@renderer/App.js';
import { useSession } from '@renderer/store/session.js';
import { installBridge } from './bridge.js';
import { initDatabase } from './platform/db.js';
import {
  applyStatusBarTheme,
  loadShellInfo,
  registerBackButton,
  registerLifecycle,
} from './platform/shell.js';
import './styles.css';

/**
 * Точка входа Android-сборки.
 *
 * На десктопе базу поднимает main-процесс ещё до появления окна, и renderer
 * стартует на готовом. Здесь всё происходит в самом WebView и занимает
 * заметное время: загрузить SQLite в WebAssembly, применить миграции и при
 * первом запуске собрать справочники из контента. Пока это идёт, на экране
 * висит заставка, а не пустота.
 *
 * Экраны, роутер и хранилища берутся из `packages/electron-app/src/renderer`
 * без изменений: у приложения одна версия интерфейса на обе платформы.
 */

const container = document.getElementById('root');
if (!container) throw new Error('Не найден корневой элемент #root.');
const root = createRoot(container);

function Splash({ text }: { text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
      <p className="text-[15px] font-medium text-text">АртЛандшафт</p>
      <p className="text-[13px] text-dim">{text}</p>
    </div>
  );
}

function StartupError({ message }: { message: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 bg-bg px-8 text-center">
      <p className="text-[15px] font-medium text-danger">Не удалось подготовить базу знаний</p>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted">{message}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-dim">
        Без базы учебные разделы недоступны. Попробуйте перезапустить приложение; если ошибка
        повторяется — переустановите его.
      </p>
    </div>
  );
}

async function bootstrap(): Promise<void> {
  root.render(<Splash text="Подготовка учебной базы…" />);

  const seed = await initDatabase();
  console.log(
    seed.seeded
      ? `[db] справочники собраны: ${JSON.stringify(seed.counts)}`
      : `[db] справочники актуальны: ${JSON.stringify(seed.counts)}`,
  );

  await loadShellInfo();
  installBridge();

  registerBackButton();
  registerLifecycle();

  // Тема — настройка профиля, поэтому системная полоса перекрашивается вслед
  // за ней, а не один раз на старте.
  void applyStatusBarTheme(useSession.getState().activeProfile?.theme ?? 'dark');
  useSession.subscribe((state, previous) => {
    const theme = state.activeProfile?.theme ?? 'dark';
    if (theme !== (previous.activeProfile?.theme ?? 'dark')) {
      void applyStatusBarTheme(theme);
    }
  });

  root.render(
    <StrictMode>
      <AppScreen />
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[startup]', error);
  root.render(<StartupError message={message} />);
});
