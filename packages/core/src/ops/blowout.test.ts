import { describe, expect, it } from 'vitest';
import { blowoutPlan, BLOWOUT_LPM_TO_M3MIN_DIVISOR } from './blowout.js';
import { m3hToGpm } from '../units.js';

const zones = [
  { name: 'Зона 1 (газон, роторы)', flowM3h: 2.4, emitterClass: 'rotor' as const, distanceM: 15 },
  { name: 'Зона 2 (спреи у дома)', flowM3h: 1.8, emitterClass: 'spray' as const, distanceM: 40 },
  { name: 'Зона 3 (капля, кустарники)', flowM3h: 0.6, emitterClass: 'drip' as const, distanceM: 55 },
];

describe('§5.15 Продувка на зиму', () => {
  it('CFM = GPM / 7,5 по самой расходной зоне', () => {
    const r = blowoutPlan({ zones });
    const gpm = m3hToGpm(2.4);
    expect(r.values.requiredCfm).toBeCloseTo(gpm / 7.5, 2);
  });

  it('метрический пересчёт согласован с правилом CFM = GPM/7,5', () => {
    // 1 CFM = 0,0283 м³/мин; делитель должен получиться около 1000, а не 283.
    expect(BLOWOUT_LPM_TO_M3MIN_DIVISOR).toBeGreaterThan(950);
    expect(BLOWOUT_LPM_TO_M3MIN_DIVISOR).toBeLessThan(1050);
  });

  it('м³/мин и CFM описывают одну и ту же производительность', () => {
    const r = blowoutPlan({ zones });
    // 1 CFM = 0,0283168 м³/мин
    expect(r.values.requiredM3Min).toBeCloseTo(r.values.requiredCfm * 0.0283168, 3);
  });

  it('порядок обхода — от самой дальней зоны', () => {
    const r = blowoutPlan({ zones });
    expect(r.values.plan[0]!.name).toContain('Зона 3');
    expect(r.values.plan.at(-1)!.name).toContain('Зона 1');
    expect(r.values.plan.map((p) => p.order)).toEqual([1, 2, 3]);
  });

  it('капельной зоне назначает 1,5–2 бар', () => {
    const r = blowoutPlan({ zones });
    const drip = r.values.plan.find((p) => p.name.includes('капля'))!;
    expect(drip.maxPressureBar).toBeLessThanOrEqual(2.0);
    expect(drip.note).toMatch(/самотёчн|1,5/);
  });

  it('при неизвестном материале держится нижней границы 3,5 бар', () => {
    const r = blowoutPlan({ zones });
    expect(r.values.maxPressureBar).toBe(3.5);
    expect(r.notes.some((n) => n.code === 'blowout-material-unknown')).toBe(true);
  });

  it('для ПВХ допускает до 5,5 бар', () => {
    const r = blowoutPlan({ zones, pipeMaterial: 'pvc' });
    expect(r.values.maxPressureBar).toBe(5.5);
    expect(r.notes.some((n) => n.code === 'blowout-material-unknown')).toBe(false);
  });

  it('для полиэтилена ограничивает 3,5 бар', () => {
    const r = blowoutPlan({ zones, pipeMaterial: 'pe' });
    expect(r.values.maxPressureBar).toBe(3.5);
  });

  it('спреи ограничены нижней границей даже на ПВХ', () => {
    const r = blowoutPlan({ zones, pipeMaterial: 'pvc' });
    const spray = r.values.plan.find((p) => p.name.includes('спреи'))!;
    expect(spray.maxPressureBar).toBe(3.5);
  });

  it('считает общую длительность по проходам', () => {
    const r = blowoutPlan({ zones, passMinutes: 2, passes: 3 });
    expect(r.values.totalMinutes).toBe(3 * 2 * 3);
  });

  it('всегда выдаёт предупреждение по безопасности', () => {
    const r = blowoutPlan({ zones });
    const safety = r.notes.find((n) => n.code === 'blowout-safety');
    expect(safety?.severity).toBe('warning');
    expect(safety!.fix).toMatch(/очк/i);
  });

  it('предупреждает про роторы и сухие подшипники', () => {
    const r = blowoutPlan({ zones });
    const rotor = r.values.plan.find((p) => p.name.includes('роторы'))!;
    expect(rotor.note).toMatch(/подшипник/i);
  });

  it('отклоняет пустой список зон', () => {
    expect(() => blowoutPlan({ zones: [] })).toThrow();
  });
});
