import { describe, expect, it } from 'vitest';
import {
  pumpHead,
  fitPumpCurve,
  pumpHeadAt,
  buildSystemCurve,
  systemHeadAt,
  findOperatingPoint,
} from './head.js';

describe('§5.11 Требуемый напор', () => {
  it('H = H_геод + hf + h_мест + P_дожд + запас', () => {
    const r = pumpHead({
      flowM3h: 5,
      staticLiftM: 10,
      frictionLossM: 8,
      minorLossM: 2,
      sprinklerPressureBar: 3,
      safetyMargin: 0.1,
    });
    // 10 + 8 + 2 + 30,6 = 50,6; с запасом 10 % → 55,66
    expect(r.values.sprinklerHeadM).toBeCloseTo(30.6, 2);
    expect(r.values.headBeforeMarginM).toBeCloseTo(50.6, 2);
    expect(r.values.requiredHeadM).toBeCloseTo(55.66, 2);
  });

  it('P = Q·H/(367·η)', () => {
    const r = pumpHead({
      flowM3h: 5,
      staticLiftM: 10,
      frictionLossM: 8,
      minorLossM: 2,
      sprinklerPressureBar: 3,
      efficiency: 0.6,
    });
    expect(r.values.shaftPowerKw).toBeCloseTo((5 * 55.66) / (367 * 0.6), 2);
  });

  it('возвращает рабочую точку (Q; H)', () => {
    const r = pumpHead({
      flowM3h: 4.5,
      staticLiftM: 5,
      frictionLossM: 6,
      sprinklerPressureBar: 2.5,
    });
    expect(r.values.dutyPoint.flowM3h).toBeCloseTo(4.5, 2);
    expect(r.values.dutyPoint.headM).toBe(r.values.requiredHeadM);
    expect(r.notes.some((n) => n.code === 'duty-point')).toBe(true);
  });

  it('разбирает напор на слагаемые: сумма сходится с итогом', () => {
    const r = pumpHead({
      flowM3h: 5,
      staticLiftM: 10,
      frictionLossM: 8,
      minorLossM: 2,
      sprinklerPressureBar: 3,
      safetyMargin: 0.1,
    });

    const sum = r.values.breakdown.reduce((acc, c) => acc + c.headM, 0);
    expect(sum).toBeCloseTo(r.values.requiredHeadM, 1);

    const shares = r.values.breakdown.reduce((acc, c) => acc + c.share, 0);
    expect(shares).toBeCloseTo(1, 2);

    // Самое крупное слагаемое стоит первым: у бытовой системы это почти
    // всегда рабочее давление дождевателя, и именно его нельзя урезать.
    expect(r.values.breakdown[0]!.key).toBe('sprinkler');
    expect(r.values.breakdown[0]!.headM).toBeCloseTo(30.6, 1);
  });

  it('не показывает нулевые слагаемые', () => {
    const r = pumpHead({
      flowM3h: 4,
      staticLiftM: 0,
      frictionLossM: 6,
      sprinklerPressureBar: 2.5,
    });
    expect(r.values.breakdown.some((c) => c.key === 'static')).toBe(false);
    expect(r.values.breakdown.some((c) => c.key === 'minor')).toBe(false);
    expect(r.values.breakdown.every((c) => c.headM > 0)).toBe(true);
  });

  it('всегда напоминает про NPSH и кавитацию', () => {
    const r = pumpHead({
      flowM3h: 4,
      staticLiftM: 3,
      frictionLossM: 5,
      sprinklerPressureBar: 2.5,
    });
    expect(r.notes.some((n) => n.code === 'npsh')).toBe(true);
  });

  it('предупреждает о недостижимой высоте всасывания', () => {
    const r = pumpHead({
      flowM3h: 4,
      staticLiftM: 12,
      frictionLossM: 5,
      sprinklerPressureBar: 2.5,
    });
    expect(r.notes.some((n) => n.code === 'high-lift')).toBe(true);
  });

  it('предупреждает о заниженном запасе', () => {
    const r = pumpHead({
      flowM3h: 4,
      staticLiftM: 3,
      frictionLossM: 5,
      sprinklerPressureBar: 2.5,
      safetyMargin: 0.02,
    });
    expect(r.notes.some((n) => n.code === 'margin-low')).toBe(true);
  });
});

describe('Кривая насоса и рабочая точка', () => {
  it('по двум точкам строит параболу H = a + c·Q²', () => {
    const curve = fitPumpCurve([
      { flowM3h: 0, headM: 60 },
      { flowM3h: 6, headM: 30 },
    ]);
    expect(pumpHeadAt(curve, 0)).toBeCloseTo(60, 6);
    expect(pumpHeadAt(curve, 6)).toBeCloseTo(30, 6);
    // Кривая насоса убывает с расходом.
    expect(pumpHeadAt(curve, 3)).toBeLessThan(60);
    expect(pumpHeadAt(curve, 3)).toBeGreaterThan(30);
  });

  it('по трём точкам проходит через все три', () => {
    const pts = [
      { flowM3h: 0, headM: 55 },
      { flowM3h: 3, headM: 48 },
      { flowM3h: 6, headM: 30 },
    ];
    const curve = fitPumpCurve(pts);
    for (const p of pts) {
      expect(pumpHeadAt(curve, p.flowM3h)).toBeCloseTo(p.headM, 6);
    }
  });

  it('требует минимум две точки', () => {
    expect(() => fitPumpCurve([{ flowM3h: 1, headM: 10 }])).toThrow(/минимум две точки/);
  });

  it('характеристика системы растёт от расхода в степени 1,852', () => {
    const sys = buildSystemCurve(20, 5, 10);
    expect(systemHeadAt(sys, 0)).toBeCloseTo(20, 6);
    expect(systemHeadAt(sys, 5)).toBeCloseTo(30, 6);
    expect(systemHeadAt(sys, 10)).toBeGreaterThan(systemHeadAt(sys, 5));
  });

  it('находит пересечение кривой насоса и системы', () => {
    const pump = fitPumpCurve([
      { flowM3h: 0, headM: 60 },
      { flowM3h: 4, headM: 50 },
      { flowM3h: 8, headM: 28 },
    ]);
    const sys = buildSystemCurve(20, 5, 12);
    const op = findOperatingPoint(pump, sys);
    expect(op.found).toBe(true);
    // В точке пересечения напоры совпадают.
    expect(pumpHeadAt(pump, op.flowM3h)).toBeCloseTo(systemHeadAt(sys, op.flowM3h), 2);
    expect(op.flowM3h).toBeGreaterThan(0);
    expect(op.flowM3h).toBeLessThan(8);
  });

  it('сообщает, если насос не поднимает даже статический напор', () => {
    const pump = fitPumpCurve([
      { flowM3h: 0, headM: 10 },
      { flowM3h: 4, headM: 5 },
    ]);
    const sys = buildSystemCurve(40, 5, 10);
    const op = findOperatingPoint(pump, sys);
    expect(op.found).toBe(false);
    expect(op.flowM3h).toBe(0);
  });

  it('более крутая характеристика системы сдвигает рабочую точку влево', () => {
    const pump = fitPumpCurve([
      { flowM3h: 0, headM: 60 },
      { flowM3h: 8, headM: 28 },
    ]);
    const easy = findOperatingPoint(pump, buildSystemCurve(20, 5, 6));
    const hard = findOperatingPoint(pump, buildSystemCurve(20, 5, 20));
    expect(hard.flowM3h).toBeLessThan(easy.flowM3h);
  });
});
