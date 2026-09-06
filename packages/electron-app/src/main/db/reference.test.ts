import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CABLE_TABLE } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import {
  REFERENCE_SECTIONS,
  normalize,
  queryReference,
  referenceSections,
} from './repos/reference.js';
import { globalSearch } from './repos/search.js';

/**
 * Справочники §3.3 на настоящем контенте репозитория.
 *
 * База наполняется один раз на весь файл: чтение по ней ничего не меняет,
 * а сборка 1224 строк сопел на каждый тест была бы пустой тратой времени.
 */

let db: DatabaseSync;

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

beforeAll(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);
});

describe('Состав раздела «Справочники» (§3.3)', () => {
  it('содержит все девять справочников из ТЗ', () => {
    const keys = referenceSections(db).map((s) => s.key);
    for (const key of [
      'nozzles',
      'pipes',
      'soils',
      'plants',
      'valves',
      'cable',
      'filtration',
      'glossary',
      'standards',
    ]) {
      expect(keys, key).toContain(key);
    }
  });

  it('в каждом справочнике есть строки', () => {
    for (const section of referenceSections(db)) {
      expect(section.rows, section.key).toBeGreaterThan(0);
    }
  });

  it('у каждой таблицы объявлены колонки и они не повторяются', () => {
    for (const section of REFERENCE_SECTIONS) {
      for (const table of section.tables) {
        expect(table.columns.length, `${section.key}/${table.key}`).toBeGreaterThan(0);
        const keys = table.columns.map((c) => c.key);
        expect(new Set(keys).size, `${section.key}/${table.key}`).toBe(keys.length);
      }
    }
  });

  it('колонки поиска и фильтров объявлены среди колонок таблицы', () => {
    for (const section of REFERENCE_SECTIONS) {
      for (const table of section.tables) {
        const declared = new Set([
          ...table.columns.map((c) => c.key),
          ...(table.sortOnlyColumns ?? []),
          'id',
        ]);
        for (const column of table.searchColumns) {
          expect(declared, `${section.key}/${table.key}: поиск по ${column}`).toContain(column);
        }
        for (const filter of table.filters ?? []) {
          expect(declared, `${section.key}/${table.key}: фильтр ${filter.column}`).toContain(
            filter.column,
          );
        }
      }
    }
  });

  it('каждая таблица каждого раздела выбирается без ошибок', () => {
    for (const section of REFERENCE_SECTIONS) {
      for (const table of section.tables) {
        const result = queryReference(db, { section: section.key, table: table.key });
        expect(result.rows.length, `${section.key}/${table.key}`).toBeGreaterThan(0);
        expect(result.total).toBeGreaterThanOrEqual(result.rows.length);
      }
    }
  });

  it('на неизвестный раздел отвечает ошибкой, а не пустой таблицей', () => {
    expect(() => queryReference(db, { section: 'nonexistent' })).toThrow(/Неизвестный раздел/);
  });
});

describe('Наполнение справочников шага §12 п.5', () => {
  it('клапаны: потери, типоразмеры и соленоиды', () => {
    const losses = queryReference(db, { section: 'valves', table: 'losses', limit: 500 });
    expect(losses.total).toBeGreaterThan(80);

    const models = queryReference(db, { section: 'valves', table: 'models' });
    expect(models.total).toBe(7);

    const solenoids = queryReference(db, { section: 'valves', table: 'solenoids' });
    expect(solenoids.total).toBe(3);
  });

  it('потери клапана растут с расходом внутри одной модели', () => {
    const result = queryReference(db, {
      section: 'valves',
      table: 'losses',
      filters: { model: 'PGV-100/101' },
      sort: { column: 'flow_m3h', dir: 'asc' },
      limit: 200,
    });

    const losses = result.rows.map((r) => Number(r['loss_bar']));
    for (let i = 1; i < losses.length; i += 1) {
      expect(losses[i]!, `строка ${i}`).toBeGreaterThanOrEqual(losses[i - 1]!);
    }
  });

  it('строки клапанов, где две таблицы каталога разошлись, помечены', () => {
    const result = queryReference(db, { section: 'valves', table: 'losses', limit: 500 });
    const unverified = result.rows.filter((r) => Number(r['verified']) === 0);
    // Они должны существовать и быть в меньшинстве: иначе разбор сломан.
    expect(unverified.length).toBeGreaterThan(0);
    expect(unverified.length).toBeLessThan(result.rows.length / 2);
  });

  it('фильтрация: меш, требования, типы и подбор под источник', () => {
    expect(queryReference(db, { section: 'filtration', table: 'mesh' }).total).toBe(4);
    expect(queryReference(db, { section: 'filtration', table: 'requirements' }).total).toBe(5);
    expect(queryReference(db, { section: 'filtration', table: 'types' }).total).toBe(3);
    expect(queryReference(db, { section: 'filtration', table: 'sources' }).total).toBe(4);
  });

  it('меш и микроны обратно пропорциональны — чем больше меш, тем тоньше фильтрация', () => {
    const result = queryReference(db, {
      section: 'filtration',
      table: 'mesh',
      sort: { column: 'mesh', dir: 'asc' },
    });
    const microns = result.rows.map((r) => Number(r['micron']));
    for (let i = 1; i < microns.length; i += 1) {
      expect(microns[i]!).toBeLessThan(microns[i - 1]!);
    }
  });

  it('кабель совпадает с таблицей расчётного движка строка в строку', () => {
    const result = queryReference(db, { section: 'cable', limit: 100 });
    expect(result.total).toBe(CABLE_TABLE.length);

    for (const row of result.rows) {
      const twin = CABLE_TABLE.find(
        (c) =>
          c.crossSectionMm2 === Number(row['cross_section_mm2']) &&
          Math.abs(c.currentA - Number(row['current_a'])) < 1e-9,
      );
      expect(twin, `${row['cross_section_mm2']} мм² / ${row['current_a']} А`).toBeDefined();
      expect(Number(row['max_length_m'])).toBe(twin!.maxLengthM);
    }
  });

  it('глоссарий покрывает термины, названные в §3.3.8', () => {
    const result = queryReference(db, { section: 'glossary', limit: 200 });
    const english = result.rows.map((r) => String(r['term_en']));

    for (const term of ['PR', 'DU', 'MAD', 'EU', 'SM', 'Head-to-head', 'Cycle and soak', 'Swing joint', 'Latching']) {
      expect(
        english.some((e) => e.toLowerCase().includes(term.toLowerCase())),
        `нет термина ${term}`,
      ).toBe(true);
    }
  });

  it('у каждого термина есть и русское, и английское название, и определение', () => {
    const result = queryReference(db, { section: 'glossary', limit: 200 });
    for (const row of result.rows) {
      expect(String(row['term_ru']).trim().length).toBeGreaterThan(0);
      expect(String(row['term_en']).trim().length).toBeGreaterThan(0);
      expect(String(row['definition']).trim().length).toBeGreaterThan(40);
    }
  });
});

describe('Фильтр, сортировка и постраничный вывод', () => {
  it('фильтр по семейству сопел сужает выборку', () => {
    const all = queryReference(db, { section: 'nozzles', limit: 1 });
    const filtered = queryReference(db, {
      section: 'nozzles',
      filters: { model: 'PGJ' },
      limit: 1,
    });

    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(all.total);
  });

  it('неизвестный фильтр игнорируется, а не роняет запрос', () => {
    const result = queryReference(db, { section: 'nozzles', filters: { nope: 'x' }, limit: 1 });
    expect(result.total).toBeGreaterThan(0);
  });

  it('сортировка по числовой колонке идёт по числу, а не по строке', () => {
    const result = queryReference(db, {
      section: 'pipes',
      sort: { column: 'od_mm', dir: 'desc' },
      limit: 5,
    });
    const values = result.rows.map((r) => Number(r['od_mm']));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
    }
  });

  it('сортировка по необъявленной колонке отклоняется', () => {
    expect(() =>
      queryReference(db, { section: 'pipes', sort: { column: 'source', dir: 'asc' } }),
    ).toThrow(/не объявлена/);
  });

  it('постраничный вывод не повторяет и не теряет строки', () => {
    const first = queryReference(db, { section: 'nozzles', limit: 50, offset: 0 });
    const second = queryReference(db, { section: 'nozzles', limit: 50, offset: 50 });

    const ids = new Set(first.rows.map((r) => r['id']));
    for (const row of second.rows) {
      expect(ids.has(row['id'])).toBe(false);
    }
    expect(first.total).toBe(second.total);
  });

  it('размер страницы ограничен сверху', () => {
    const result = queryReference(db, { section: 'nozzles', limit: 100000 });
    expect(result.limit).toBeLessThanOrEqual(500);
  });

  it('поиск по разделу не чувствителен к регистру и к «ё»', () => {
    const lower = queryReference(db, { section: 'nozzles', query: 'pgp', limit: 1 });
    const upper = queryReference(db, { section: 'nozzles', query: 'PGP', limit: 1 });
    expect(lower.total).toBe(upper.total);
    expect(lower.total).toBeGreaterThan(0);

    expect(normalize('Плёнка')).toBe('пленка');
  });

  it('поиск с кавычкой и процентом не ломает запрос', () => {
    // Строка уходит параметром, поэтому спецсимволы SQL и LIKE безопасны.
    expect(() => queryReference(db, { section: 'glossary', query: "'; DROP TABLE glossary; --" }))
      .not.toThrow();
    expect(queryReference(db, { section: 'glossary', limit: 1 }).total).toBeGreaterThan(0);
  });
});

describe('Глобальный поиск (§3.3, Ctrl+F)', () => {
  it('находит по всем справочникам сразу', () => {
    const result = globalSearch(db, 'PGP');
    expect(result.total).toBeGreaterThan(0);
    expect(result.groups.some((g) => g.section === 'nozzles')).toBe(true);
  });

  it('находит термин глоссария по английскому названию', () => {
    const result = globalSearch(db, 'cycle and soak');
    expect(result.groups.some((g) => g.section === 'glossary')).toBe(true);
  });

  it('находит калькулятор по номеру раздела ТЗ', () => {
    const result = globalSearch(db, '5.12');
    expect(result.groups.some((g) => g.section === 'calculators')).toBe(true);
  });

  it('находит норматив по коду', () => {
    const result = globalSearch(db, 'S627');
    expect(result.groups.some((g) => g.section === 'standards')).toBe(true);
  });

  it('на слишком короткий запрос ничего не ищет', () => {
    expect(globalSearch(db, 'а').total).toBe(0);
    expect(globalSearch(db, ' ').groups).toEqual([]);
  });

  it('на бессмысленный запрос отвечает пустым результатом, а не ошибкой', () => {
    const result = globalSearch(db, 'ъъъщщщ');
    expect(result.total).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it('сопла в индексе сгруппированы по насадке, а не построчно', () => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM search_index WHERE section = 'nozzles:rows'")
      .get() as { n: number };
    const nozzles = db.prepare('SELECT COUNT(*) AS n FROM equipment_nozzles').get() as { n: number };

    expect(Number(row.n)).toBeGreaterThan(0);
    // Иначе 1224 строки давления забили бы выдачу шумом.
    expect(Number(row.n)).toBeLessThan(Number(nozzles.n) / 3);
  });

  it('каждая находка ведёт в существующий раздел', () => {
    const known = new Set([...REFERENCE_SECTIONS.map((s) => s.key), 'calculators']);
    for (const query of ['PGP', 'суглинок', 'клапан', 'меш', 'кабель', 'FAO']) {
      for (const group of globalSearch(db, query).groups) {
        expect(known, `${query} → ${group.section}`).toContain(group.section);
      }
    }
  });
});
