import initSqlJs, {
  type Database as SqlJsDatabase,
  type Statement as SqlJsStatement,
  type SqlValue,
} from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

/**
 * Реализация API `node:sqlite` поверх sql.js (SQLite, скомпилированный в
 * WebAssembly).
 *
 * Зачем именно так. Весь слой работы с базой — схема, миграции, наполнение,
 * репозитории — написан под синхронный `DatabaseSync` из `node:sqlite`
 * (см. DECISIONS.md, решение 1). Асинхронный драйвер вроде нативного плагина
 * SQLite потребовал бы переписать на промисы каждый запрос и каждую
 * транзакцию, то есть содержать вторую реализацию тех же правил. sql.js
 * синхронен, поэтому в мобильной сборке `node:sqlite` подменяется этим модулем
 * (алиас в `vite.config.ts`), и код из `packages/electron-app/src/main/db`
 * работает под Android без единой правки.
 *
 * Плата — база живёт в памяти WebView, и её образ нужно сохранять самому:
 * этим занимается `platform/db.ts`.
 */

/** Модуль sql.js и стартовый образ базы, подготовленные до открытия. */
let engine: Awaited<ReturnType<typeof initSqlJs>> | null = null;
let initialBytes: Uint8Array | null = null;

/**
 * Загружает SQLite в WebAssembly и запоминает образ базы с устройства.
 *
 * Обязательно вызывается до `new DatabaseSync(...)`: конструктор `node:sqlite`
 * синхронен, а инициализация WebAssembly — нет, и совместить это можно только
 * разнеся их по времени.
 */
export async function prepareSqlite(
  saved: Uint8Array | null,
  /**
   * Где лежит sql-wasm.wasm. По умолчанию — адрес ассета из бандла; параметр
   * нужен тестам, которые идут в обход сборщика и читают файл с диска.
   */
  locateWasm: () => string = () => wasmUrl,
): Promise<void> {
  engine = await initSqlJs({ locateFile: locateWasm });
  initialBytes = saved;
}

/** Уже открытая база — нужна `platform/db.ts` для выгрузки образа. */
let openDb: DatabaseSync | null = null;

export function currentDatabase(): DatabaseSync | null {
  return openDb;
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** Значения, которые репозитории передают в запросы. */
type BindValue = SqlValue | boolean | undefined;

/** SQLite не знает булевых значений, а `undefined` не отличает от пропуска. */
function toSqlValue(value: BindValue): SqlValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

class StatementSync {
  constructor(
    private readonly db: DatabaseSyncInternals,
    private readonly sql: string,
  ) {}

  get(...params: BindValue[]): unknown {
    const stmt = this.bound(params);
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.reset();
    return row;
  }

  all(...params: BindValue[]): unknown[] {
    const stmt = this.bound(params);
    const rows: unknown[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.reset();
    return rows;
  }

  run(...params: BindValue[]): RunResult {
    const stmt = this.bound(params);
    // Шаг нужен и для INSERT/UPDATE: без него запрос не выполняется вовсе.
    while (stmt.step());
    stmt.reset();
    return {
      changes: this.db.raw.getRowsModified(),
      lastInsertRowid: this.db.lastInsertRowid(),
    };
  }

  /** Заглушка ради совместимости сигнатуры: репозитории её не вызывают. */
  setReadBigInts(): void {}

  private bound(params: BindValue[]): SqlJsStatement {
    const stmt = this.db.compiled(this.sql);
    // `bind` в sql.js сам делает reset; для запросов без параметров его надо
    // позвать явно, иначе повторный вызов продолжит прошлый перебор строк.
    if (params.length > 0) stmt.bind(params.map(toSqlValue));
    else stmt.reset();
    return stmt;
  }
}

interface DatabaseSyncInternals {
  raw: SqlJsDatabase;
  compiled(sql: string): SqlJsStatement;
  lastInsertRowid(): number;
}

export class DatabaseSync implements DatabaseSyncInternals {
  readonly raw: SqlJsDatabase;

  /**
   * Кэш подготовленных запросов.
   *
   * Репозитории вызывают `db.prepare(...)` на каждый запрос и не освобождают
   * результат — под `node:sqlite` за этим следит сборщик мусора, а в sql.js
   * забытый `Statement` навсегда занимает память WebAssembly. Ключ — текст
   * запроса, поэтому один и тот же SQL компилируется ровно однажды, что заодно
   * заметно ускоряет наполнение базы (тысячи вставок в цикле).
   */
  private readonly cache = new Map<string, SqlJsStatement>();
  private rowidStmt: SqlJsStatement | null = null;

  /**
   * Путь принимается ради совместимости сигнатуры и не используется: файл
   * базы читает и пишет `platform/storage.ts`, а сам SQLite работает в памяти.
   */
  constructor(_path?: string) {
    if (!engine) {
      throw new Error(
        'SQLite не инициализирован: перед открытием базы нужно вызвать prepareSqlite().',
      );
    }
    this.raw = initialBytes ? new engine.Database(initialBytes) : new engine.Database();
    openDb = this;
  }

  exec(sql: string): void {
    this.raw.run(sql);
  }

  prepare(sql: string): StatementSync {
    return new StatementSync(this, sql);
  }

  compiled(sql: string): SqlJsStatement {
    let stmt = this.cache.get(sql);
    if (!stmt) {
      stmt = this.raw.prepare(sql);
      this.cache.set(sql, stmt);
    }
    return stmt;
  }

  lastInsertRowid(): number {
    // Отдельный запрос вместо кэша: `last_insert_rowid()` меняется после
    // каждой вставки, и хранить его негде.
    this.rowidStmt ??= this.raw.prepare('SELECT last_insert_rowid() AS id');
    this.rowidStmt.reset();
    this.rowidStmt.step();
    const value = this.rowidStmt.getAsObject()['id'];
    this.rowidStmt.reset();
    return typeof value === 'number' ? value : 0;
  }

  /**
   * Выгрузка образа базы в байты.
   *
   * Метода с таким именем в `node:sqlite` нет — он нужен только мобильной
   * оболочке, которая сама пишет файл базы на устройство. Обёртка обязательна:
   * `export()` в sql.js освобождает все подготовленные запросы и переоткрывает
   * соединение, поэтому кэш после него указывает в никуда, и следующий же
   * запрос падает с «Statement closed».
   */
  export(): Uint8Array {
    // Освобождать самим нечего: это уже сделает сам `export()`.
    this.cache.clear();
    this.rowidStmt = null;
    return this.raw.export();
  }

  close(): void {
    for (const stmt of this.cache.values()) stmt.free();
    this.cache.clear();
    this.rowidStmt?.free();
    this.rowidStmt = null;
    this.raw.close();
    if (openDb === this) openDb = null;
  }
}
