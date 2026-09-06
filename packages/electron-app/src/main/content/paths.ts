import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Где лежит каталог `/content`.
 *
 * В разработке — в корне репозитория; в собранном приложении — в
 * `resources/content` (кладётся сборщиком как extraResource). Сеть не нужна
 * ни в одном из режимов: §13 ТЗ требует полностью офлайн-работу.
 */
export function contentDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'content');
  }

  // dist/main/index.cjs → packages/electron-app/dist/main → корень репозитория
  const fromBuild = resolve(app.getAppPath(), '..', '..', 'content');
  if (existsSync(fromBuild)) return fromBuild;

  return resolve(process.cwd(), 'content');
}

export function contentFile(...parts: string[]): string {
  return join(contentDir(), ...parts);
}

/** Файл базы данных профилей и прогресса. */
export function databaseFile(): string {
  return join(app.getPath('userData'), 'irrigo-master.db');
}
