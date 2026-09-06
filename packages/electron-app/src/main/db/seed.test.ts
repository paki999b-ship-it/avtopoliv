import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALCULATORS, PIPE_CATALOG, PLANTS, SOILS } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';

/**
 * Сборка справочников из `/content` в базу (§2 ТЗ). Тест работает с настоящим
 * каталогом контента репозитория: если извлечение из каталога Hunter или
 * справочные модули движка разъедутся со схемой, это выяснится здесь, а не
 * при первом запуске у пользователя.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

function seededDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  const info = seedReferenceData(db, CONTENT_DIR);
  return { db, info };
}

describe('Наполнение справочников из /content', () => {
  it('переносит все строки каталога сопел с указанием источника', () => {
    const { db, info } = seededDb();
    expect(info.seeded).toBe(true);

    const total = db.prepare('SELECT COUNT(*) AS n FROM equipment_nozzles').get() as {
      n: number;
    };
    expect(Number(total.n)).toBeGreaterThan(1200);

    // §8 п.1: у каждой строки каталога должна быть страница.
    const noPage = db
      .prepare(
        "SELECT COUNT(*) AS n FROM equipment_nozzles WHERE source_page IS NULL AND emitter_class <> 'strip'",
      )
      .get() as { n: number };
    expect(Number(noPage.n)).toBe(0);

    // Полосовые форсунки взяты не из каталога, а из отдельного технического
    // листа: у них вместо страницы — ссылка на документ.
    const stripNoSource = db
      .prepare(
        "SELECT COUNT(*) AS n FROM equipment_nozzles WHERE emitter_class = 'strip' AND (source_url IS NULL OR source_url = '')",
      )
      .get() as { n: number };
    expect(Number(stripNoSource.n)).toBe(0);
  });

  it('полосовые форсунки наполнены и PR посчитана движком, а не переписана', () => {
    const { db } = seededDb();

    const rows = db
      .prepare(
        "SELECT model, pressure_bar, pattern_width_m, pattern_length_m, flow_m3h, pr_square_mm_h, is_recommended FROM equipment_nozzles WHERE emitter_class = 'strip'",
      )
      .all() as unknown as Array<{
      model: string;
      pressure_bar: number;
      pattern_width_m: number;
      pattern_length_m: number;
      flow_m3h: number;
      pr_square_mm_h: number;
      is_recommended: number;
    }>;

    // 6 моделей × 5 значений давления.
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((r) => r.model)).size).toBe(6);

    for (const row of rows) {
      const expected = (row.flow_m3h * 1000) / (row.pattern_width_m * row.pattern_length_m);
      expect(row.pr_square_mm_h, `${row.model} ${row.pressure_bar}`).toBeCloseTo(expected, 1);
    }

    // §1.1 задачи: рекомендованная рабочая точка — 2,1 бар, по одной на модель.
    const recommended = rows.filter((r) => r.is_recommended === 1);
    expect(recommended).toHaveLength(6);
    expect(recommended.every((r) => r.pressure_bar === 2.1)).toBe(true);
  });

  it('контрольный пример SS-530 при 2,1 бар воспроизводится в базе', () => {
    const { db } = seededDb();
    const row = db
      .prepare(
        "SELECT pattern_width_m, pattern_length_m, flow_m3h, flow_lpm, pr_square_mm_h FROM equipment_nozzles WHERE model = 'SS-530' AND pressure_bar = 2.1",
      )
      .get() as {
      pattern_width_m: number;
      pattern_length_m: number;
      flow_m3h: number;
      flow_lpm: number;
      pr_square_mm_h: number;
    };

    expect(row.pattern_width_m).toBe(1.5);
    expect(row.pattern_length_m).toBe(9.1);
    expect(row.flow_lpm).toBe(5);
    expect(row.pr_square_mm_h).toBeCloseTo(22, 0);
  });

  it('сохраняет пометку строк, не прошедших сверку (DECISIONS.md, решение 7)', () => {
    const { db } = seededDb();
    const unverified = db
      .prepare('SELECT COUNT(*) AS n FROM equipment_nozzles WHERE verified = 0')
      .get() as { n: number };
    // Их немного, но они должны существовать и быть помечены, а не молча пропасть.
    expect(Number(unverified.n)).toBeGreaterThan(0);
    expect(Number(unverified.n)).toBeLessThan(30);
  });

  it('переносит сортамент труб, почвы, Kc, нормы и реестр калькуляторов', () => {
    const { db, info } = seededDb();
    expect(info.counts['pipes']).toBe(PIPE_CATALOG.length);
    expect(info.counts['soils']).toBe(SOILS.length);
    expect(info.counts['kc_values']).toBe(PLANTS.length);
    expect(info.counts['calculators']).toBe(CALCULATORS.length);

    const standards = db.prepare('SELECT COUNT(*) AS n FROM standards_refs').get() as {
      n: number;
    };
    expect(Number(standards.n)).toBeGreaterThanOrEqual(12);
  });

  it('воспроизводит контрольный пример §5.2 в колонке потерь на 100 м', () => {
    const { db } = seededDb();
    // ПНД 63 мм SDR17 (внутр. 55,4 мм) при 1,5 м/с даёт ≈13 м³/ч,
    // потери — около 3,9 м на 100 м.
    const row = db
      .prepare(
        "SELECT id_mm, q_1_5_m3h, hf_100m_at_1_5 FROM pipes WHERE standard = 'PE100 SDR17' AND od_mm = 63",
      )
      .get() as { id_mm: number; q_1_5_m3h: number; hf_100m_at_1_5: number };

    expect(row.id_mm).toBeCloseTo(55.4, 1);
    expect(row.q_1_5_m3h).toBeCloseTo(13, 0);
    expect(row.hf_100m_at_1_5).toBeCloseTo(3.9, 1);
  });

  it('расходы в сортаменте растут вместе со скоростью', () => {
    const { db } = seededDb();
    const rows = db
      .prepare('SELECT q_1_0_m3h, q_1_5_m3h, q_2_0_m3h FROM pipes')
      .all() as Array<{ q_1_0_m3h: number; q_1_5_m3h: number; q_2_0_m3h: number }>;

    for (const row of rows) {
      expect(row.q_1_0_m3h).toBeLessThan(row.q_1_5_m3h);
      expect(row.q_1_5_m3h).toBeLessThan(row.q_2_0_m3h);
      // Расход линеен по скорости: 2,0 м/с ровно вдвое больше 1,0 м/с.
      expect(row.q_2_0_m3h / row.q_1_0_m3h).toBeCloseTo(2, 1);
    }
  });

  it('повторный запуск не пересобирает справочники и не плодит дубликаты', () => {
    const { db, info } = seededDb();
    const again = seedReferenceData(db, CONTENT_DIR);

    expect(again.seeded).toBe(false);
    expect(again.signature).toBe(info.signature);
    expect(again.counts).toEqual(info.counts);
  });

  it('пересборка после смены подписи оставляет прежнее число строк', () => {
    const { db, info } = seededDb();
    db.prepare("UPDATE app_meta SET value = 'stale' WHERE key = 'content_signature'").run();

    const again = seedReferenceData(db, CONTENT_DIR);
    expect(again.seeded).toBe(true);
    expect(again.counts).toEqual(info.counts);
  });

  it('запоминает издание каталога — §10 п.2 требует показывать его пользователю', () => {
    const { info } = seededDb();
    expect(info.catalogEdition).toMatch(/Hunter/);
    expect(info.catalogEdition).toMatch(/41/);
  });
});
