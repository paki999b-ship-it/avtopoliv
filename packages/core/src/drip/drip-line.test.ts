import { describe, expect, it } from 'vitest';
import {
  dripLine,
  dripZonePrecipitationRate,
  christiansenF,
  DRIP_LINE_VARIATION_LIMIT,
} from './drip-line.js';

const base = {
  emitterFlowLph: 1.6,
  emitterSpacingM: 0.33,
  innerDiameterMm: 13.6,
  inletPressureBar: 1.0,
  nominalPressureBar: 1.0,
};

describe('Поправка Кристиансена', () => {
  it('при большом числе водовыпусков стремится к 1/(m+1) ≈ 0,35', () => {
    expect(christiansenF(1000)).toBeCloseTo(0.351, 2);
  });

  it('убывает с ростом числа водовыпусков', () => {
    expect(christiansenF(10)).toBeGreaterThan(christiansenF(100));
  });

  it('отклоняет ноль водовыпусков', () => {
    expect(() => christiansenF(0)).toThrow();
  });
});

describe('§5.14 Капельная линия', () => {
  it('число капельниц и расход линии', () => {
    const r = dripLine({ ...base, lineLengthM: 33 });
    expect(r.values.emitterCount).toBe(100);
    expect(r.values.lineFlowLph).toBeCloseTo(160, 1);
  });

  it('короткая линия укладывается в предел разброса 10 %', () => {
    const r = dripLine({ ...base, lineLengthM: 30 });
    expect(r.values.flowVariation).toBeLessThanOrEqual(DRIP_LINE_VARIATION_LIMIT);
    expect(r.values.acceptable).toBe(true);
  });

  it('типовая ошибка из §3.5: некомпенсированная лента 120 м не проходит по равномерности', () => {
    const r = dripLine({ ...base, lineLengthM: 120 });
    expect(r.values.acceptable).toBe(false);
    const err = r.notes.find((n) => n.code === 'drip-variation-high');
    expect(err?.severity).toBe('error');
    expect(err?.fix).toBeTruthy();
  });

  it('давление в конце линии ниже, чем на входе (на ровном участке)', () => {
    const r = dripLine({ ...base, lineLengthM: 60 });
    expect(r.values.endPressureBar).toBeLessThan(r.values.inletPressureBar);
    expect(r.values.minPressureBar).toBe(r.values.endPressureBar);
  });

  it('расход первой капельницы выше расхода последней', () => {
    const r = dripLine({ ...base, lineLengthM: 60 });
    expect(r.values.flowFirstLph).toBeGreaterThan(r.values.flowLastLph);
  });

  it('уклон вниз по потоку компенсирует потери', () => {
    const flat = dripLine({ ...base, lineLengthM: 60, slopePercent: 0 });
    const down = dripLine({ ...base, lineLengthM: 60, slopePercent: -2 });
    expect(down.values.endPressureBar).toBeGreaterThan(flat.values.endPressureBar);
    expect(down.values.flowVariation).toBeLessThan(flat.values.flowVariation);
  });

  it('уклон вверх ухудшает равномерность', () => {
    const flat = dripLine({ ...base, lineLengthM: 60, slopePercent: 0 });
    const up = dripLine({ ...base, lineLengthM: 60, slopePercent: 2 });
    expect(up.values.flowVariation).toBeGreaterThan(flat.values.flowVariation);
  });

  it('труба большего диаметра допускает более длинную линию', () => {
    const thin = dripLine({ ...base, lineLengthM: 60, innerDiameterMm: 13.6 });
    const thick = dripLine({ ...base, lineLengthM: 60, innerDiameterMm: 17.0 });
    expect(thick.values.maxLineLengthM).toBeGreaterThan(thin.values.maxLineLengthM);
  });

  it('на максимальной расчётной длине разброс ещё в пределах нормы', () => {
    const r = dripLine({ ...base, lineLengthM: 60 });
    const atMax = dripLine({ ...base, lineLengthM: r.values.maxLineLengthM });
    expect(atMax.values.flowVariation).toBeLessThanOrEqual(DRIP_LINE_VARIATION_LIMIT + 1e-9);
  });

  it('компенсированная линия в рабочем диапазоне держит одинаковый расход', () => {
    const r = dripLine({
      ...base,
      lineLengthM: 80,
      inletPressureBar: 1.5,
      compensating: true,
      compensationRangeBar: { min: 0.6, max: 3.5 },
    });
    expect(r.values.flowVariation).toBe(0);
    expect(r.values.flowFirstLph).toBeCloseTo(r.values.flowLastLph, 6);
    expect(r.notes.some((n) => n.code === 'compensation-ok')).toBe(true);
  });

  it('компенсированная линия вне диапазона — ошибка', () => {
    const r = dripLine({
      ...base,
      lineLengthM: 200,
      inletPressureBar: 1.0,
      compensating: true,
      compensationRangeBar: { min: 0.8, max: 3.5 },
    });
    expect(r.notes.some((n) => n.code === 'compensation-out-of-range')).toBe(true);
  });

  it('требует паспортный диапазон для компенсированных капельниц', () => {
    const r = dripLine({ ...base, lineLengthM: 60, compensating: true });
    const note = r.notes.find((n) => n.code === 'compensation-range-missing');
    expect(note?.fix).toMatch(/техкарт/i);
  });

  it('всегда напоминает про фильтрацию и промывочный клапан', () => {
    const r = dripLine({ ...base, lineLengthM: 40 });
    const note = r.notes.find((n) => n.code === 'drip-filtration');
    expect(note).toBeDefined();
    expect(note!.fix).toMatch(/промывочн/i);
  });

  it('сообщает, если давления не хватает до конца линии', () => {
    const r = dripLine({ ...base, lineLengthM: 350, inletPressureBar: 0.4 });
    expect(r.notes.some((n) => n.code === 'drip-no-pressure')).toBe(true);
  });
});

describe('§5.14 PR капельной зоны', () => {
  it('считается по площади посадок', () => {
    const r = dripZonePrecipitationRate({ totalFlowLph: 480, plantedAreaM2: 60 });
    expect(r.values.precipitationRateMmH).toBeCloseTo(8, 6);
  });

  it('поясняет, почему берётся площадь посадок, а не участка', () => {
    const r = dripZonePrecipitationRate({ totalFlowLph: 480, plantedAreaM2: 60 });
    expect(r.notes.some((n) => n.code === 'drip-pr-meaning')).toBe(true);
  });
});
