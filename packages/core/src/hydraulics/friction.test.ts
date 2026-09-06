import { describe, expect, it } from 'vitest';
import {
  frictionLoss,
  hazenWilliamsLossM,
  swameeJainFrictionFactor,
  darcyWeisbachLossM,
} from './friction.js';
import { m3hToM3s } from '../units.js';
import { findPipe } from '../data/pipes.js';

describe('§5.2 Хазен–Вильямс', () => {
  it('контрольный пример ТЗ: ПНД 63 SDR17, Q = 13 м³/ч, C = 150 → около 3,9 м на 100 м', () => {
    const pipe = findPipe('pe100-sdr17-63');
    expect(pipe).toBeDefined();
    expect(pipe!.idMm).toBeCloseTo(55.4, 1);

    const hf = hazenWilliamsLossM(m3hToM3s(13), pipe!.idMm / 1000, 100, 150);
    // Точное значение формулы — 3,927 м; ТЗ округляет до «около 3,9».
    expect(hf).toBeCloseTo(3.93, 2);
    expect(hf).toBeGreaterThan(3.85);
    expect(hf).toBeLessThan(4.0);
  });

  it('тот же пример через публичный расчёт с шагами', () => {
    const r = frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: 100, material: 'pe_new' });
    expect(r.values.headLossM).toBeCloseTo(3.93, 2);
    expect(r.values.headLossPer100mM).toBeCloseTo(3.93, 2);
    expect(r.values.hazenWilliamsC).toBe(150);
    // Скорость в этом примере близка к целевым 1,5 м/с.
    expect(r.values.velocityMs).toBeCloseTo(1.5, 1);
  });

  it('показывает формулу, подстановку и результат для каждого шага (§3.2)', () => {
    const r = frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: 100 });
    expect(r.steps.length).toBeGreaterThanOrEqual(5);
    for (const s of r.steps) {
      expect(s.label).not.toBe('');
      expect(s.formula).not.toBe('');
      expect(s.substitution).not.toBe('');
      expect(s.result).not.toBe('');
    }
    const hw = r.steps.find((s) => s.formula.includes('10,67'));
    expect(hw).toBeDefined();
    expect(hw!.result).toContain('м вод. ст.');
  });

  it('потери растут почти как квадрат расхода', () => {
    const a = hazenWilliamsLossM(m3hToM3s(5), 0.0554, 100, 150);
    const b = hazenWilliamsLossM(m3hToM3s(10), 0.0554, 100, 150);
    expect(b / a).toBeCloseTo(2 ** 1.852, 3);
  });

  it('потери линейны по длине', () => {
    const a = hazenWilliamsLossM(m3hToM3s(13), 0.0554, 50, 150);
    const b = hazenWilliamsLossM(m3hToM3s(13), 0.0554, 100, 150);
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('старая сталь (C = 95) даёт заметно большие потери, чем новый ПНД', () => {
    const pe = frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: 100, material: 'pe_new' });
    const steel = frictionLoss({
      flowM3h: 13,
      innerDiameterMm: 55.4,
      lengthM: 100,
      material: 'steel_old',
    });
    expect(steel.values.headLossM).toBeGreaterThan(pe.values.headLossM * 2);
  });

  it('отклоняет нефизичный вход', () => {
    expect(() => frictionLoss({ flowM3h: 0, innerDiameterMm: 55.4, lengthM: 100 })).toThrow();
    expect(() => frictionLoss({ flowM3h: 13, innerDiameterMm: -5, lengthM: 100 })).toThrow();
    expect(() => frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: -1 })).toThrow();
  });
});

describe('§5.2 Дарси–Вейсбах и Свейми–Джейн', () => {
  it('на контрольном примере даёт результат того же порядка, что Хазен–Вильямс', () => {
    const r = frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: 100, material: 'pe_new' });
    expect(r.values.darcyHeadLossM).toBeGreaterThan(3.5);
    expect(r.values.darcyHeadLossM).toBeLessThan(4.5);
    expect(Math.abs(r.values.methodDeltaPercent)).toBeLessThan(15);
  });

  it('коэффициент трения для гладкой трубы в турбулентном режиме лежит в 0,015…0,03', () => {
    const f = swameeJainFrictionFactor(82_000, 7e-6, 0.0554);
    expect(f).toBeGreaterThan(0.015);
    expect(f).toBeLessThan(0.03);
  });

  it('в ламинарном режиме переходит на f = 64/Re', () => {
    expect(swameeJainFrictionFactor(1000, 7e-6, 0.05)).toBeCloseTo(64 / 1000, 10);
  });

  it('шероховатая труба даёт больший коэффициент трения', () => {
    const smooth = swameeJainFrictionFactor(100_000, 7e-6, 0.055);
    const rough = swameeJainFrictionFactor(100_000, 5e-4, 0.055);
    expect(rough).toBeGreaterThan(smooth);
  });

  it('потери по Дарси–Вейсбаху растут как квадрат скорости', () => {
    const a = darcyWeisbachLossM(0.02, 100, 0.0554, 1);
    const b = darcyWeisbachLossM(0.02, 100, 0.0554, 2);
    expect(b / a).toBeCloseTo(4, 6);
  });

  it('оба метода показаны в шагах — расхождение видно пользователю', () => {
    const r = frictionLoss({ flowM3h: 13, innerDiameterMm: 55.4, lengthM: 100 });
    expect(r.steps.some((s) => s.formula.includes('f · (L/D)'))).toBe(true);
    expect(r.notes.some((n) => n.code === 'method-comparison')).toBe(true);
  });
});
