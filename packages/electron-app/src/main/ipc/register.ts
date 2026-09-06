import { BrowserWindow, app, clipboard, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '../db/connection.js';
import { databaseFile } from '../content/paths.js';
import { createHandlers, type PlatformServices } from './handlers.js';
import type { ExportResult } from '../../shared/types.js';

/**
 * Регистрация обработчиков IPC под Electron.
 *
 * Прикладной слой общий с Android и лежит в `handlers.ts`; здесь остаётся
 * только то, что умеет одна лишь настольная оболочка: системные диалоги
 * сохранения, буфер обмена и версии среды. Renderer по-прежнему не получает ни
 * путей, ни доступа к Node.
 */
export function registerIpc(db: Db): void {
  const platform: PlatformServices = {
    appVersion: app.getVersion(),
    runtime: `Electron ${process.versions.electron ?? '—'} · Node ${process.versions.node}`,
    platform: 'windows',
    databasePath: databaseFile(),

    exportCsv: (suggestedName, csv) =>
      // BOM — иначе Excel на русской локали покажет кириллицу как «РїСЂ».
      saveThroughDialog('Сохранить расчёт в CSV', suggestedName, 'csv', () =>
        Buffer.from(`﻿${csv}`, 'utf8'),
      ),

    exportPng: (suggestedName, base64) =>
      saveThroughDialog('Сохранить план участка', suggestedName, 'png', () =>
        // Изображение приходит как data-URL: отрезаем заголовок и пишем байты.
        Buffer.from(base64.slice(base64.indexOf(',') + 1), 'base64'),
      ),

    writeClipboard: (text) => {
      clipboard.writeText(text);
      return { copied: true };
    },
  };

  const handlers = createHandlers(db, platform);

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      // Ошибки уходят в renderer как отклонённый промис — там их ловит
      // общий обработчик и показывает пользователю, а не «молча ничего».
      return (handler as (...a: unknown[]) => unknown)(...args);
    });
  }
}

async function saveThroughDialog(
  title: string,
  suggestedName: string,
  extension: string,
  payload: () => Buffer,
): Promise<ExportResult> {
  const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const defaultPath = join(
    app.getPath('documents'),
    sanitizeFileName(suggestedName, extension),
  );
  const options = {
    title,
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  };

  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) return { saved: false };

  await writeFile(result.filePath, payload());
  return { saved: true, path: result.filePath };
}

/** Windows не принимает в имени файла ни один из этих символов. */
function sanitizeFileName(name: string, extension = 'csv'): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').trim();
  const safe = cleaned || 'irrigo';
  return safe.toLowerCase().endsWith(`.${extension}`) ? safe : `${safe}.${extension}`;
}
