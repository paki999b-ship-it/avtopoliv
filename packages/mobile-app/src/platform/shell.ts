import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useRouter } from '@renderer/store/router.js';
import { dismissTopOverlay } from '@renderer/lib/overlay.js';
import { flushSave } from './db.js';
import { databaseUri } from './storage.js';

/**
 * Всё, что приложение получает от самой оболочки Android: сведения о сборке,
 * аппаратная кнопка «назад» и реакция на сворачивание.
 */

const native = Capacitor.isNativePlatform();

/**
 * Сведения об оболочке читаются один раз при старте: обработчик `app:info`
 * отдаёт их синхронно, а Capacitor — через промисы.
 */
let info = {
  appVersion: '0.1.0',
  runtime: native ? 'Android · WebView' : 'Браузер',
  databasePath: '',
};

export async function loadShellInfo(): Promise<void> {
  if (!native) {
    info = { ...info, databasePath: 'память браузера' };
    return;
  }

  try {
    const [app, uri] = await Promise.all([App.getInfo(), databaseUri()]);
    info = {
      appVersion: app.version,
      runtime: `Android · Capacitor ${Capacitor.getPlatform()} · WebView`,
      databasePath: uri,
    };
  } catch {
    // Версия и путь к базе — справочные строки на экране «О приложении»:
    // без них приложение работает, поэтому сбой не должен ронять старт.
  }
}

export function shellInfo(): typeof info {
  return info;
}

/**
 * Аппаратная кнопка «назад».
 *
 * Без обработчика она закрывает приложение из любого места — из урока, из
 * открытого расчёта, из раскрытого меню. Пользователь Android ждёт обратного:
 * сначала закрывается то, что открыто сверху, потом работает шаг назад по
 * разделам, и только с главного экрана происходит выход.
 */
export function registerBackButton(): void {
  // В браузере (npm run dev) аппаратной кнопки нет, и веб-реализация плагина
  // событий не шлёт: подписка там просто не нужна.
  if (!native) return;

  void App.addListener('backButton', () => {
    if (dismissTopOverlay()) return;

    const router = useRouter.getState();
    if (router.canGoBack()) {
      router.back();
      return;
    }

    void flushSave().finally(() => void App.exitApp());
  });
}

/**
 * Сворачивание приложения. Android вправе выгрузить процесс в любой момент
 * после этого события, поэтому отложенная запись базы здесь форсируется.
 */
export function registerLifecycle(): void {
  if (native) {
    void App.addListener('pause', () => {
      void flushSave();
    });
  }

  // Тот же случай в браузере и при выгрузке WebView.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
}

/**
 * Системная полоса под тему приложения.
 *
 * Тема — настройка профиля (тёмная или светлая), поэтому цвет полосы
 * выставляется не один раз при старте, а при каждой смене темы.
 */
export async function applyStatusBarTheme(theme: 'dark' | 'light'): Promise<void> {
  if (!native) return;
  try {
    await StatusBar.setStyle({ style: theme === 'light' ? Style.Light : Style.Dark });
    // Цвета совпадают с токеном --iw-bg темы (packages/ui/src/theme/theme.css).
    await StatusBar.setBackgroundColor({ color: theme === 'light' ? '#ffffff' : '#081910' });
  } catch {
    // На части устройств цветом полосы распоряжается система; это не повод падать.
  }
}
