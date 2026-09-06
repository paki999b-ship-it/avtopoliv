import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { queryReference, referenceSections } from './repos/reference.js';
import { globalSearch } from './repos/search.js';

/**
 * Перечень оборудования Hunter (§3.3).
 *
 * Раздел собирается из каталога, а не пишется руками, поэтому проверяется не
 * конкретный состав, а свойства, которые обязаны выполняться у любой строки:
 * есть назначение, есть ссылка на полосу издания, артикул не повторяется.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);
});

describe('Перечень оборудования каталога', () => {
  it('изделия загружены', () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM equipment_items').get() as { n: number };
    expect(Number(row.n)).toBeGreaterThan(150);
  });

  it('у каждого изделия есть назначение и ссылка на полосу издания', () => {
    const bad = db
      .prepare(
        `SELECT COUNT(*) AS n FROM equipment_items
         WHERE trim(description) = '' OR trim(source) = '' OR source_page IS NULL`,
      )
      .get() as { n: number };
    expect(Number(bad.n)).toBe(0);
  });

  it('полосы лежат в пределах издания', () => {
    const row = db
      .prepare('SELECT MIN(source_page) AS lo, MAX(source_page) AS hi FROM equipment_items')
      .get() as { lo: number; hi: number };
    expect(Number(row.lo)).toBeGreaterThanOrEqual(1);
    expect(Number(row.hi)).toBeLessThanOrEqual(228);
  });

  it('артикулы не повторяются', () => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM equipment_items').get() as { n: number };
    const distinct = db
      .prepare('SELECT COUNT(DISTINCT model) AS n FROM equipment_items')
      .get() as { n: number };
    expect(Number(distinct.n)).toBe(Number(total.n));
  });

  it('расшифровки артикула в перечень не попали', () => {
    // «= 30 м = 15 см = чёрный» — это ключ к обозначению, а не изделие.
    const keys = db
      .prepare("SELECT COUNT(*) AS n FROM equipment_items WHERE description LIKE '%=%=%'")
      .get() as { n: number };
    expect(Number(keys.n)).toBe(0);
  });

  it('слово шапки не осталось в начале назначения', () => {
    const bad = db
      .prepare(
        "SELECT COUNT(*) AS n FROM equipment_items WHERE description LIKE 'Описание %' OR description LIKE 'Наименование %'",
      )
      .get() as { n: number };
    expect(Number(bad.n)).toBe(0);
  });

  it('перекрёстные ссылки на полосы вычищены из назначения', () => {
    const refs = db
      .prepare("SELECT COUNT(*) AS n FROM equipment_items WHERE description LIKE '%Страница %'")
      .get() as { n: number };
    expect(Number(refs.n)).toBe(0);
  });

  it('раздел справочника отдаётся с фильтром по разделу каталога', () => {
    const section = referenceSections(db).find((s) => s.key === 'equipment');
    expect(section).toBeDefined();
    expect(section!.rows).toBeGreaterThan(150);

    const filter = section!.tables[0]!.filters.find((f) => f.key === 'section');
    expect(filter?.values.length).toBeGreaterThan(10);
  });

  it('поиск по разделу находит изделие по артикулу', () => {
    const result = queryReference(db, {
      section: 'equipment',
      table: 'rows',
      query: 'PGV',
      limit: 20,
      offset: 0,
    });
    expect(result.total).toBeGreaterThan(0);
  });

  it('изделия попадают в глобальный поиск', () => {
    const found = globalSearch(db, 'декодер');
    expect(found.total).toBeGreaterThan(0);
  });
});
