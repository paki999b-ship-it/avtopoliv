import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRATIONS } from './schema.js';

/**
 * Подключение к SQLite.
 *
 * Используется встроенный в Node модуль `node:sqlite`, а не `better-sqlite3`:
 * на целевой машине политика Windows Application Control блокирует загрузку
 * нативных `.node`-аддонов. Подробности и запасной вариант — DECISIONS.md,
 * решение 1. Electron 44 несёт Node 24.18, где `node:sqlite` доступен без
 * флага `--experimental-sqlite` — проверено.
 */

export type Db = DatabaseSync;

export function openDatabase(filePath: string): Db {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);

  // WAL — чтобы чтение справочников не блокировалось записью прогресса.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // Каскадное удаление профиля вместе с прогрессом работает только с этим.
  db.exec('PRAGMA foreign_keys = ON');

  migrate(db);
  return db;
}

/** Прогоняет непринятые миграции. Версия хранится в `PRAGMA user_version`. */
export function migrate(db: Db): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;

  for (let i = version; i < MIGRATIONS.length; i += 1) {
    const step = MIGRATIONS[i];
    if (!step) continue;
    db.exec('BEGIN');
    try {
      db.exec(step);
      // user_version не принимает параметр — только литерал.
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Миграция схемы №${i + 1} не применилась: ${String(error)}`, {
        cause: error,
      });
    }
    version = i + 1;
  }

  return version;
}

/** Выполняет функцию в транзакции: либо всё, либо ничего. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO app_meta (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
