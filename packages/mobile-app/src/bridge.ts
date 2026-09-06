import { IPC_CHANNELS } from '@shared/ipc.js';
import type { IpcChannel } from '@shared/ipc.js';
import { createHandlers, type PlatformServices } from '@main/ipc/handlers.js';
import { getDb, scheduleSave } from './platform/db.js';
import { exportCsv, exportPng, writeClipboard } from './platform/export.js';
import { shellInfo } from './platform/shell.js';

/**
 * Мост `window.irrigo` в мобильной сборке.
 *
 * Под Electron мост — граница между процессами: renderer не имеет доступа ни к
 * Node, ни к базе, и всё ходит через `ipcMain`. В WebView двух процессов нет,
 * разделять нечего, и тот же контракт выполняется прямым вызовом обработчиков
 * из `@main/ipc/handlers`. Экраны разницы не видят: они по-прежнему знают
 * только `window.irrigo.invoke`.
 */
export function installBridge(): void {
  const info = shellInfo();

  const platform: PlatformServices = {
    appVersion: info.appVersion,
    runtime: info.runtime,
    platform: 'android',
    databasePath: info.databasePath,
    exportCsv,
    exportPng,
    writeClipboard,
    // sql.js держит базу в памяти: после каждой записи её образ нужно
    // сбросить в файл, иначе прогресс не переживёт закрытие приложения.
    onMutate: scheduleSave,
  };

  const handlers = createHandlers(getDb(), platform);
  const allowed = new Set<string>(IPC_CHANNELS);

  window.irrigo = {
    invoke(channel: IpcChannel, ...args: unknown[]) {
      if (!allowed.has(channel)) {
        return Promise.reject(new Error(`Канал «${channel}» не разрешён.`));
      }
      // Обработчики синхронны, а контракт обещает промис. Оборачивание в
      // `Promise.resolve` внутри `try` заодно превращает синхронное исключение
      // в отклонённый промис — ровно так же, как это делает Electron.
      try {
        const handler = handlers[channel] as (...a: unknown[]) => unknown;
        return Promise.resolve(handler(...args)) as never;
      } catch (error) {
        return Promise.reject(error as Error);
      }
    },
  };
}
