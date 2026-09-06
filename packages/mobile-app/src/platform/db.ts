import { openDatabase, type Db } from '@main/db/connection.js';
import { seedReferenceData } from '@main/db/seed.js';
import { CONTENT_DIR, assertContentBundled } from './content.js';
import { currentDatabase, prepareSqlite } from './node-sqlite.js';
import { readDatabaseFile, writeDatabaseFile } from './storage.js';

/**
 * Подготовка базы в мобильной сборке.
 *
 * На десктопе базу поднимает main-процесс до создания окна; здесь всё
 * происходит в самом WebView и занимает заметное время: нужно загрузить SQLite
 * в WebAssembly, применить миграции и при первом запуске собрать справочники из
 * контента. Пока это идёт, на экране висит заставка (см. `main.tsx`).
 *
 * Открытие и наполнение выполняет тот же код, что и под Windows
 * (`@main/db/connection` и `@main/db/seed`) — платформенная разница спрятана в
 * алиасах `node:sqlite`, `node:fs` и `node:path`, см. `vite.config.ts`.
 */

let db: Db | null = null;

export interface DbBootstrapResult {
  seeded: boolean;
  counts: Record<string, number>;
}

export async function initDatabase(): Promise<DbBootstrapResult> {
  assertContentBundled();

  await prepareSqlite(await readDatabaseFile());

  // Путь фиктивный: SQLite здесь работает в памяти, а файл пишет `storage.ts`.
  db = openDatabase('/data/irrigo-master.db');

  const seed = seedReferenceData(db, CONTENT_DIR);

  // Первый запуск собирает справочники несколько секунд — потерять эту работу
  // из-за того, что систему смахнули из списка задач, было бы обидно.
  await saveNow();

  return { seeded: seed.seeded, counts: seed.counts };
}

export function getDb(): Db {
  if (!db) throw new Error('База данных не инициализирована: вызовите initDatabase().');
  return db;
}

/* ------------------------------------------------------------------ */
/* Сохранение образа базы                                              */
/* ------------------------------------------------------------------ */

/**
 * Задержка перед записью. Одно действие пользователя (сдача теста, разбор
 * зоны) — это несколько операций подряд; писать файл после каждой значит
 * впустую выгружать всю базу. Полсекунды достаточно, чтобы записи слиплись в
 * одну, и мало, чтобы что-то потерять при сворачивании.
 */
const SAVE_DELAY_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let pending = false;

async function saveNow(): Promise<void> {
  const database = currentDatabase();
  if (!database) return;

  // Две одновременные записи одного файла — верный способ получить обрезанную
  // базу, поэтому запись идёт по очереди.
  if (saving) {
    pending = true;
    return saving;
  }

  saving = (async () => {
    try {
      await writeDatabaseFile(database.export());
    } finally {
      saving = null;
    }
    if (pending) {
      pending = false;
      await saveNow();
    }
  })();

  return saving;
}

/** Отложенная запись после операции, изменившей базу. */
export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, SAVE_DELAY_MS);
}

/** Немедленная запись: при сворачивании приложения ждать нельзя. */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await saveNow();
}
