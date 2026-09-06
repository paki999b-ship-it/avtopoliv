import { describe, expect, it } from 'vitest';
import {
  valveCableDrop,
  voltageDropV,
  commonWireAndTransformer,
  cableLengthTable,
} from './voltage-drop.js';
import { VALVE_CABLE } from '../constants.js';

describe('§5.12 Падение напряжения на клапанном кабеле', () => {
  it('ΔU = 2·L·I·ρ/S', () => {
    // 2 · 100 · 0,35 · 0,0175 / 1,5 = 0,8167 В
    expect(voltageDropV(100, 0.35, 1.5)).toBeCloseTo(0.8167, 3);
  });

  it('типовая ошибка из §11: кабель 0,5 мм² на 150 м не работает', () => {
    const r = valveCableDrop({ lengthM: 150, crossSectionMm2: 0.5, currentA: 0.35 });
    expect(r.values.acceptable).toBe(false);
    const err = r.notes.find((n) => n.code === 'drop-too-high');
    expect(err?.severity).toBe('error');
    expect(err?.why).toMatch(/соленоид/i);
  });

  it('1,5 мм² на 100 м проходит с запасом', () => {
    const r = valveCableDrop({ lengthM: 100, crossSectionMm2: 1.5, currentA: 0.35 });
    expect(r.values.acceptable).toBe(true);
    expect(r.values.dropV).toBeLessThan(VALVE_CABLE.maxDropV);
    expect(r.values.maxLengthM).toBeGreaterThan(100);
  });

  it('допуск — 2,4 В, то есть 10 % от 24 В', () => {
    const r = valveCableDrop({ lengthM: 200, crossSectionMm2: 1.0, currentA: 0.35 });
    // На границе: проверяем, что порог именно 2,4 В.
    const atLimit = valveCableDrop({
      lengthM: r.values.maxLengthM,
      crossSectionMm2: 1.0,
      currentA: 0.35,
    });
    expect(atLimit.values.dropV).toBeLessThanOrEqual(2.4001);
    expect(atLimit.values.acceptable).toBe(true);
  });

  it('считает минимальное сечение для заданной длины', () => {
    const r = valveCableDrop({ lengthM: 150, crossSectionMm2: 0.5, currentA: 0.35 });
    const fixed = valveCableDrop({
      lengthM: 150,
      crossSectionMm2: Math.ceil(r.values.requiredCrossSectionMm2 * 10) / 10,
      currentA: 0.35,
    });
    expect(fixed.values.acceptable).toBe(true);
  });

  it('падение пропорционально длине и обратно пропорционально сечению', () => {
    const a = valveCableDrop({ lengthM: 50, crossSectionMm2: 1.5 });
    const b = valveCableDrop({ lengthM: 100, crossSectionMm2: 1.5 });
    const c = valveCableDrop({ lengthM: 50, crossSectionMm2: 3.0 });
    expect(b.values.dropV).toBeCloseTo(a.values.dropV * 2, 2);
    expect(c.values.dropV).toBeCloseTo(a.values.dropV / 2, 2);
  });

  it('напоминает считать по пусковому току, а не по току удержания', () => {
    const r = valveCableDrop({ lengthM: 50, crossSectionMm2: 1.5 });
    expect(r.notes.some((n) => n.code === 'inrush-vs-holding')).toBe(true);
  });
});

describe('§5.12 Общий провод и трансформатор', () => {
  it('суммирует токи одновременно открытых клапанов', () => {
    const r = commonWireAndTransformer({
      simultaneousValves: [
        { name: 'Зона 1', lengthM: 60, currentA: 0.35 },
        { name: 'Зона 2', lengthM: 80, currentA: 0.35 },
      ],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 80,
    });
    expect(r.values.totalCurrentA).toBeCloseTo(0.7, 3);
  });

  it('учитывает мастер-клапан в постоянной нагрузке', () => {
    const without = commonWireAndTransformer({
      simultaneousValves: [{ name: 'Зона 1', lengthM: 60, currentA: 0.35 }],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 60,
    });
    const with_ = commonWireAndTransformer({
      simultaneousValves: [{ name: 'Зона 1', lengthM: 60, currentA: 0.35 }],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 60,
      masterValve: true,
    });
    expect(with_.values.totalCurrentA).toBeCloseTo(0.7, 3);
    expect(with_.values.transformerVa).toBeGreaterThan(without.values.transformerVa);
    expect(with_.notes.some((n) => n.code === 'master-valve-load')).toBe(true);
  });

  it('трансформатор подбирается с запасом 30 %', () => {
    const r = commonWireAndTransformer({
      simultaneousValves: [
        { name: 'Зона 1', lengthM: 40, currentA: 0.35 },
        { name: 'Зона 2', lengthM: 40, currentA: 0.35 },
      ],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 40,
    });
    expect(r.values.transformerVa).toBeCloseTo(0.7 * 24, 2);
    expect(r.values.transformerWithReserveVa).toBeCloseTo(0.7 * 24 * 1.3, 1);
  });

  it('находит худший клапан по суммарному падению', () => {
    const r = commonWireAndTransformer({
      simultaneousValves: [
        { name: 'Ближняя', lengthM: 20, currentA: 0.35 },
        { name: 'Дальняя', lengthM: 180, currentA: 0.35 },
      ],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 180,
    });
    expect(r.values.worstValveName).toBe('Дальняя');
  });

  it('ловит перегрузку общего провода', () => {
    const r = commonWireAndTransformer({
      simultaneousValves: [
        { name: 'Зона 1', lengthM: 200, currentA: 0.35 },
        { name: 'Зона 2', lengthM: 200, currentA: 0.35 },
      ],
      commonCrossSectionMm2: 0.5,
      commonLengthM: 200,
    });
    expect(r.values.acceptable).toBe(false);
    expect(r.notes.some((n) => n.code === 'common-drop-high')).toBe(true);
  });

  it('всегда указывает границу ответственности по электрике (§10 п.3)', () => {
    const r = commonWireAndTransformer({
      simultaneousValves: [{ name: 'Зона 1', lengthM: 30 }],
      commonCrossSectionMm2: 1.5,
      commonLengthM: 30,
    });
    const note = r.notes.find((n) => n.code === 'electrical-scope');
    expect(note).toBeDefined();
    expect(note!.fix).toMatch(/не заменяет электрика/i);
  });

  it('отклоняет пустой список клапанов', () => {
    expect(() =>
      commonWireAndTransformer({
        simultaneousValves: [],
        commonCrossSectionMm2: 1.5,
        commonLengthM: 30,
      }),
    ).toThrow();
  });
});

describe('Таблица максимальных длин кабеля (§7 cable_table)', () => {
  it('строится из той же формулы и монотонна', () => {
    const rows = cableLengthTable([0.5, 1.0, 1.5], [0.25, 0.35]);
    expect(rows).toHaveLength(6);
    const at05 = rows.filter((r) => r.crossSectionMm2 === 0.5);
    const at15 = rows.filter((r) => r.crossSectionMm2 === 1.5);
    // Больше сечение — больше допустимая длина.
    expect(at15[0]!.maxLengthM).toBeGreaterThan(at05[0]!.maxLengthM);
    // Больше ток — меньше допустимая длина.
    expect(at05[1]!.maxLengthM).toBeLessThan(at05[0]!.maxLengthM);
  });

  it('значения совпадают с расчётом по формуле', () => {
    const rows = cableLengthTable([1.5], [0.35]);
    const expected = (2.4 * 1.5) / (2 * 0.35 * 0.0175);
    expect(rows[0]!.maxLengthM).toBe(Math.floor(expected));
  });
});
