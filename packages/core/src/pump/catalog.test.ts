import { describe, expect, it } from 'vitest';
import { buildSystemCurve } from './head.js';
import {
  PUMP_MAX_HEAD_OVERHEAD,
  PUMP_MIN_FLOW_SHARE,
  catalogHeadAt,
  catalogOperatingPoint,
  selectCatalogPumps,
} from './catalog.js';
import type { CatalogPump } from './catalog.js';

/**
 * Подбор насоса по каталожной кривой.
 *
 * Опорные данные — настоящие точки из каталога Speroni (CS 65-160 C, стр. 62
 * файла SPERONI-cat-2026-1-192.pdf): 42 м³/ч → 32 м, 48 → 31,7, 54 → 31,5.
 */

const CS_65_160_C: CatalogPump = {
  id: 1,
  brand: 'Speroni',
  model: 'CS 65-160 C',
  type: 'surface',
  powerKwMin: 9.2,
  powerKwMax: 11.5,
  voltage: '3~400 В',
  digitized: false,
  sourceFile: 'SPERONI-cat-2026-1-192.pdf',
  sourcePage: 62,
  curve: [
    { flowM3h: 42, headM: 32 },
    { flowM3h: 48, headM: 31.7 },
    { flowM3h: 54, headM: 31.5 },
    { flowM3h: 60, headM: 31.2 },
    { flowM3h: 66, headM: 30.7 },
    { flowM3h: 72, headM: 30.2 },
  ],
};

const TALL: CatalogPump = {
  ...CS_65_160_C,
  id: 2,
  model: 'Условный высоконапорный',
  curve: [
    { flowM3h: 40, headM: 90 },
    { flowM3h: 50, headM: 85 },
    { flowM3h: 60, headM: 78 },
  ],
};

const SHORT: CatalogPump = {
  ...CS_65_160_C,
  id: 3,
  model: 'Условный слабый',
  curve: [
    { flowM3h: 40, headM: 20 },
    { flowM3h: 50, headM: 18 },
    { flowM3h: 60, headM: 15 },
  ],
};

describe('Интерполяция по каталожной кривой', () => {
  it('в узловой точке возвращает табличное значение', () => {
    expect(catalogHeadAt(CS_65_160_C.curve, 48)).toBeCloseTo(31.7, 5);
  });

  it('между точками интерполирует линейно, а не сглаживает', () => {
    // Ровно посередине между 42 → 32 и 48 → 31,7.
    expect(catalogHeadAt(CS_65_160_C.curve, 45)).toBeCloseTo(31.85, 5);
    // Четверть отрезка 54 → 31,5 … 60 → 31,2.
    expect(catalogHeadAt(CS_65_160_C.curve, 55.5)).toBeCloseTo(31.425, 5);
  });

  it('за пределами таблицы не экстраполирует', () => {
    expect(catalogHeadAt(CS_65_160_C.curve, 30)).toBeNull();
    expect(catalogHeadAt(CS_65_160_C.curve, 100)).toBeNull();
  });

  it('на краях диапазона отдаёт крайние точки', () => {
    expect(catalogHeadAt(CS_65_160_C.curve, 42)).toBe(32);
    expect(catalogHeadAt(CS_65_160_C.curve, 72)).toBe(30.2);
  });

  it('пустая кривая не ломает расчёт', () => {
    expect(catalogHeadAt([], 50)).toBeNull();
  });
});

describe('Подбор насосов под требуемую точку', () => {
  const pumps = [CS_65_160_C, TALL, SHORT];

  it('берёт насос, который даёт нужный напор с умеренным запасом', () => {
    const matches = selectCatalogPumps(pumps, { flowM3h: 50, headM: 30 });

    expect(matches.map((m) => m.pump.model)).toEqual(['CS 65-160 C']);
    expect(matches[0]!.headAtRequiredM).toBeCloseTo(31.63, 2);
    expect(matches[0]!.marginM).toBeCloseTo(1.63, 2);
  });

  it('слабый насос отсекается: напора не хватает', () => {
    const matches = selectCatalogPumps([SHORT], { flowM3h: 50, headM: 30 });
    expect(matches).toHaveLength(0);
  });

  it('избыточный по напору насос тоже отсекается', () => {
    // 85 м при требуемых 30 — это в 2,8 раза больше предела в 1,3.
    const matches = selectCatalogPumps([TALL], { flowM3h: 50, headM: 30 });
    expect(matches).toHaveLength(0);

    // С поднятым порогом тот же насос проходит — правило именно в пороге.
    const relaxed = selectCatalogPumps([TALL], { flowM3h: 50, headM: 30, maxOverhead: 3 });
    expect(relaxed).toHaveLength(1);
  });

  it('порог запаса — 30 %', () => {
    expect(PUMP_MAX_HEAD_OVERHEAD).toBe(1.3);

    const onLimit = selectCatalogPumps([CS_65_160_C], { flowM3h: 48, headM: 31.7 / 1.3 });
    expect(onLimit).toHaveLength(1);

    const overLimit = selectCatalogPumps([CS_65_160_C], { flowM3h: 48, headM: 31.7 / 1.31 });
    expect(overLimit).toHaveLength(0);
  });

  it('список идёт по возрастанию запаса', () => {
    const twin: CatalogPump = {
      ...CS_65_160_C,
      id: 4,
      model: 'Ближе к требуемому',
      curve: CS_65_160_C.curve.map((p) => ({ ...p, headM: p.headM - 1.2 })),
    };

    const matches = selectCatalogPumps([CS_65_160_C, twin], { flowM3h: 50, headM: 30 });
    expect(matches.map((m) => m.pump.model)).toEqual([
      'Ближе к требуемому',
      'CS 65-160 C',
    ]);
  });

  it('насос вне диапазона расхода не рассматривается', () => {
    const matches = selectCatalogPumps(pumps, { flowM3h: 200, headM: 20 });
    expect(matches).toHaveLength(0);
  });

  /*
   * Данные настоящие: LEO EVP6-6 (LEO_Industrial_Pumps_OCR_1.pdf, стр. 48) —
   * промышленный насос на 100 м³/ч и 22 кВт. При садовых 4 м³/ч он даёт почти
   * свой напор при нулевом расходе и формально «проходит по напору», хотя
   * работать будет у самого левого края кривой.
   */
  const INDUSTRIAL: CatalogPump = {
    ...CS_65_160_C,
    id: 9,
    brand: 'LEO',
    model: 'EVP6-6',
    powerKwMin: 22,
    powerKwMax: 22,
    sourceFile: 'LEO_Industrial_Pumps_OCR_1.pdf',
    sourcePage: 48,
    curve: [
      { flowM3h: 0, headM: 58 },
      { flowM3h: 16.7, headM: 54 },
      { flowM3h: 50, headM: 52 },
      { flowM3h: 66.7, headM: 51 },
      { flowM3h: 83.3, headM: 45 },
      { flowM3h: 100, headM: 40 },
    ],
  };

  const GARDEN: CatalogPump = {
    ...CS_65_160_C,
    id: 10,
    model: 'Условный бытовой',
    powerKwMin: 1.5,
    powerKwMax: 1.5,
    curve: [
      { flowM3h: 0, headM: 68 },
      { flowM3h: 2, headM: 64 },
      { flowM3h: 4, headM: 58 },
      { flowM3h: 6, headM: 48 },
      { flowM3h: 8, headM: 34 },
    ],
  };

  it('насос не своего класса отсеивается: расход у левого края кривой', () => {
    const matches = selectCatalogPumps([INDUSTRIAL, GARDEN], { flowM3h: 4, headM: 56.8 });

    // По напору проходят оба, но у промышленного 4 м³/ч — это 4 % его расхода.
    expect(catalogHeadAt(INDUSTRIAL.curve, 4)).toBeGreaterThan(56.8);
    expect(matches.map((m) => m.pump.model)).toEqual(['Условный бытовой']);
  });

  it('порог доли расхода можно задать явно', () => {
    const matches = selectCatalogPumps([INDUSTRIAL], {
      flowM3h: 4,
      headM: 56.8,
      minFlowShare: 0,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.flowShare).toBeCloseTo(0.04, 3);
  });

  it('доля расхода приходит вместе с насосом', () => {
    const matches = selectCatalogPumps([GARDEN], { flowM3h: 4, headM: 56.8 });
    expect(matches[0]!.flowShare).toBeCloseTo(0.5, 3);
    expect(matches[0]!.flowShare).toBeGreaterThanOrEqual(PUMP_MIN_FLOW_SHARE);
  });

  it('фильтр по типу применяется', () => {
    const submersible: CatalogPump = { ...CS_65_160_C, id: 5, type: 'submersible' };
    const matches = selectCatalogPumps([CS_65_160_C, submersible], {
      flowM3h: 50,
      headM: 30,
      type: 'submersible',
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]!.pump.type).toBe('submersible');
  });

  it('нулевой расход отвергается, а не считается', () => {
    expect(() => selectCatalogPumps(pumps, { flowM3h: 0, headM: 30 })).toThrow(
      /Требуемый расход/,
    );
  });
});

describe('Фактическая рабочая точка', () => {
  it('находится там, где кривая насоса пересекает характеристику системы', () => {
    // Статический напор 25 м, в расчётной точке 50 м³/ч потери 5 м.
    const system = buildSystemCurve(25, 50, 5);
    const point = catalogOperatingPoint(CS_65_160_C.curve, system)!;

    expect(point).not.toBeNull();
    // В точке пересечения обе кривые дают один напор.
    expect(catalogHeadAt(CS_65_160_C.curve, point.flowM3h)).toBeCloseTo(point.headM, 1);
    expect(point.flowM3h).toBeGreaterThan(42);
    expect(point.flowM3h).toBeLessThan(72);
  });

  it('в подборе рабочая точка приходит вместе с насосом', () => {
    const system = buildSystemCurve(25, 50, 5);
    const matches = selectCatalogPumps([CS_65_160_C], { flowM3h: 50, headM: 30, system });

    expect(matches[0]!.operatingPoint).not.toBeNull();
    expect(matches[0]!.operatingPoint!.headM).toBeGreaterThan(25);
  });

  it('если пересечения в пределах таблицы нет — возвращает null, а не край', () => {
    // Система требует 200 м статики: кривая насоса до неё не достаёт.
    const system = buildSystemCurve(200, 50, 5);
    expect(catalogOperatingPoint(CS_65_160_C.curve, system)).toBeNull();
  });

  it('кривая из одной точки рабочей точки не даёт', () => {
    expect(
      catalogOperatingPoint([{ flowM3h: 50, headM: 30 }], buildSystemCurve(25, 50, 5)),
    ).toBeNull();
  });
});
