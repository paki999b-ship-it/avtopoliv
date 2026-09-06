import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { catalogHeadAt } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { pump, pumpSources, selectPumps } from './repos/pumps.js';

/**
 * Каталоги насосов и подбор (§5.11, часть 2 задачи).
 *
 * Проверяется не только логика подбора, но и качество извлечённых данных:
 * кривая, у которой напор растёт с расходом, — это ошибка разбора PDF,
 * и попасть в подбор она не должна.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);
});

describe('Каталоги насосов в базе', () => {
  it('насосы загружены и у каждого есть кривая', () => {
    const rows = db.prepare('SELECT id FROM pumps').all() as unknown as Array<{ id: number }>;
    expect(rows.length).toBeGreaterThan(100);

    for (const row of rows.slice(0, 40)) {
      expect(pump(db, row.id).curve.length, String(row.id)).toBeGreaterThanOrEqual(2);
    }
  });

  it('у каждой записи непустой файл-источник и страница (§7 ТЗ)', () => {
    const bad = db
      .prepare(
        "SELECT COUNT(*) AS n FROM pumps WHERE source_file IS NULL OR trim(source_file) = '' OR source_page IS NULL",
      )
      .get() as { n: number };
    expect(Number(bad.n)).toBe(0);
  });

  it('у оцифрованной кривой обязательно сказано, как снята точка', () => {
    const bad = db
      .prepare(
        "SELECT COUNT(*) AS n FROM pumps WHERE digitized = 1 AND (digitized_note IS NULL OR trim(digitized_note) = '')",
      )
      .get() as { n: number };
    expect(Number(bad.n)).toBe(0);
  });

  it('кривая каждого насоса не возрастает: напор падает с расходом', () => {
    const rows = db.prepare('SELECT id, model FROM pumps').all() as unknown as Array<{
      id: number;
      model: string;
    }>;

    for (const row of rows) {
      const curve = pump(db, row.id).curve;
      for (let i = 1; i < curve.length; i += 1) {
        expect(curve[i]!.hM, `${row.model} @ ${curve[i]!.qM3h}`).toBeLessThanOrEqual(
          curve[i - 1]!.hM,
        );
        expect(curve[i]!.qM3h, `${row.model}`).toBeGreaterThan(curve[i - 1]!.qM3h);
      }
    }
  });

  it('значения лежат в инженерно осмысленных пределах', () => {
    const row = db
      .prepare('SELECT MIN(h_m) AS hmin, MAX(h_m) AS hmax, MAX(q_m3h) AS qmax FROM pump_curve_points')
      .get() as { hmin: number; hmax: number; qmax: number };

    expect(Number(row.hmin)).toBeGreaterThan(0);
    expect(Number(row.hmax)).toBeLessThan(500);
    expect(Number(row.qmax)).toBeLessThan(2000);
  });

  it('отчёт об источниках сохранён и называет пропущенные каталоги', () => {
    const sources = pumpSources(db);
    expect(sources.length).toBeGreaterThanOrEqual(1);

    const parsed = sources.filter((s) => s.status === 'parsed');
    expect(parsed.length).toBeGreaterThanOrEqual(1);

    // У пропущенного каталога обязана быть причина: молча потерянный
    // источник выглядит как «его и не было».
    for (const skipped of sources.filter((s) => s.status === 'skipped')) {
      expect(skipped.reason, skipped.file).toBeTruthy();
      expect(skipped.reason!.length, skipped.file).toBeGreaterThan(30);
    }
  });

  it('контрольная модель Speroni CS 65-160 C совпадает с каталогом', () => {
    const row = db.prepare("SELECT id FROM pumps WHERE model = 'CS 65-160 C'").get() as
      | { id: number }
      | undefined;
    expect(row).toBeDefined();

    const model = pump(db, row!.id);
    expect(model.brand).toBe('Speroni');
    expect(model.sourcePage).toBe(62);
    expect(model.digitized).toBe(false);

    // Первые три точки строки каталога: 42 → 32, 48 → 31,7, 54 → 31,5.
    expect(model.curve.slice(0, 3)).toEqual([
      { qM3h: 42, hM: 32 },
      { qM3h: 48, hM: 31.7 },
      { qM3h: 54, hM: 31.5 },
    ]);
    expect(model.powerKwMin).toBe(9.2);
  });

  it('на несуществующий насос отвечает ошибкой', () => {
    expect(() => pump(db, 999_999)).toThrow(/не найден/);
  });
});

describe('Подбор насоса под требуемую точку', () => {
  const request = {
    flowM3h: 5,
    headM: 40,
    staticHeadM: 20,
    designLossM: 8,
  };

  it('находит насосы и сортирует их по возрастанию запаса', () => {
    const result = selectPumps(db, request);

    expect(result.catalogSize).toBeGreaterThan(100);
    expect(result.matches.length).toBeGreaterThan(0);

    for (let i = 1; i < result.matches.length; i += 1) {
      expect(result.matches[i]!.marginM).toBeGreaterThanOrEqual(result.matches[i - 1]!.marginM);
    }
  });

  it('каждый подобранный насос действительно даёт нужный напор', () => {
    const result = selectPumps(db, request);

    for (const match of result.matches) {
      const head = catalogHeadAt(
        match.pump.curve.map((p) => ({ flowM3h: p.qM3h, headM: p.hM })),
        request.flowM3h,
      );
      expect(head, match.pump.model).not.toBeNull();
      expect(head!, match.pump.model).toBeGreaterThanOrEqual(request.headM);
      expect(head!, match.pump.model).toBeLessThanOrEqual(request.headM * result.maxOverhead);
    }
  });

  it('избыточные по напору насосы в выдачу не попадают', () => {
    const result = selectPumps(db, request);
    expect(result.maxOverhead).toBe(1.3);

    for (const match of result.matches) {
      expect(match.marginRatio, match.pump.model).toBeLessThanOrEqual(0.3);
      expect(match.marginRatio, match.pump.model).toBeGreaterThanOrEqual(0);
    }
  });

  it('насосы не своего класса в выдачу не попадают', () => {
    const result = selectPumps(db, request);
    expect(result.minFlowShare).toBe(0.15);
    expect(result.matches.length).toBeGreaterThan(0);

    for (const match of result.matches) {
      // Требуемый расход не должен лежать у левого края кривой: иначе это
      // промышленная машина, формально проходящая по напору.
      const curveMax = Math.max(...match.pump.curve.map((p) => p.qM3h));
      expect(request.flowM3h / curveMax, match.pump.model).toBeGreaterThanOrEqual(
        result.minFlowShare,
      );
      expect(match.flowShare, match.pump.model).toBeCloseTo(request.flowM3h / curveMax, 3);
    }
  });

  it('фактическая рабочая точка лежит на кривой насоса', () => {
    const result = selectPumps(db, request);
    const withPoint = result.matches.filter((m) => m.operatingPoint);
    expect(withPoint.length).toBeGreaterThan(0);

    for (const match of withPoint.slice(0, 10)) {
      const head = catalogHeadAt(
        match.pump.curve.map((p) => ({ flowM3h: p.qM3h, headM: p.hM })),
        match.operatingPoint!.qM3h,
      );
      expect(head, match.pump.model).toBeCloseTo(match.operatingPoint!.hM, 1);
    }
  });

  it('фильтр по типу применяется', () => {
    const result = selectPumps(db, { ...request, type: 'submersible' });
    for (const match of result.matches) expect(match.pump.type).toBe('submersible');
  });

  it('на заведомо недостижимую точку возвращает пустой список, а не ошибку', () => {
    const result = selectPumps(db, {
      flowM3h: 5,
      headM: 5000,
      staticHeadM: 4000,
      designLossM: 10,
    });

    expect(result.matches).toEqual([]);
    // Размер каталога всё равно приходит: интерфейс отличает «нет данных»
    // от «данные есть, но ничего не подошло».
    expect(result.catalogSize).toBeGreaterThan(100);
  });

  it('отчёт об источниках приходит вместе с подбором', () => {
    expect(selectPumps(db, request).sources.length).toBeGreaterThanOrEqual(1);
  });
});
