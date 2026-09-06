import { describe, expect, it } from 'vitest';
import { zoneCheck, type ZoneCheckInput, type ZoneHead } from './zone-check.js';

const rotor = (name: string, flowLph = 600, sectorDeg = 180, pr = 12): ZoneHead => ({
  name,
  emitterClass: 'rotor',
  flowLph,
  sectorDeg,
  precipitationRateMmH: pr,
});

/** Здоровая зона: 6 роторов, ПНД 32 (внутр. 26 мм), дебит с запасом. */
const healthy: ZoneCheckInput = {
  zoneName: 'Зона 1 — газон перед домом',
  heads: [1, 2, 3, 4, 5, 6].map((i) => rotor(`Ротор ${i}`)),
  zoneAreaM2: 300,
  sourceFlowM3h: 6,
  inletPressureBar: 3.5,
  requiredHeadPressureBar: 2.5,
  pipeInnerDiameterMm: 32.6,
  pipeLengthM: 40,
  pipeMaterial: 'pe_new',
  soilInfiltrationMmH: 15,
  cableLengthM: 60,
  cableCrossSectionMm2: 1.5,
};

describe('§5.16 Проверка зоны — здоровая зона', () => {
  it('проходит все проверки', () => {
    const r = zoneCheck(healthy);
    expect(r.values.passed).toBe(true);
    expect(r.values.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('считает расход зоны и использование источника', () => {
    const r = zoneCheck(healthy);
    expect(r.values.zoneFlowLph).toBe(3600);
    expect(r.values.zoneFlowM3h).toBeCloseTo(3.6, 3);
    expect(r.values.sourceUtilisation).toBeCloseTo(0.6, 3);
  });

  it('считает PR зоны по фактической площади', () => {
    const r = zoneCheck(healthy);
    expect(r.values.precipitationRateMmH).toBeCloseTo(12, 2);
  });

  it('показывает формулу и подстановку на каждом шаге', () => {
    const r = zoneCheck(healthy);
    expect(r.steps.length).toBeGreaterThanOrEqual(7);
    for (const s of r.steps) {
      expect(s.formula).not.toBe('');
      expect(s.substitution).not.toBe('');
    }
  });
});

describe('§5.16 Проверка зоны — типовые ошибки §11', () => {
  it('ошибка 1: зона собрана без проверки против дебита источника', () => {
    const r = zoneCheck({ ...healthy, sourceFlowM3h: 2 });
    const issue = r.values.issues.find((i) => i.code === 'flow-over-source');
    expect(issue?.severity).toBe('error');
    expect(issue!.why).toMatch(/дебит|скважин|воздух/i);
    expect(issue!.fix).toBeTruthy();
    expect(r.values.passed).toBe(false);
  });

  it('предупреждает при отборе выше 80 % дебита', () => {
    const r = zoneCheck({ ...healthy, sourceFlowM3h: 4.0 });
    expect(r.values.sourceUtilisation).toBeCloseTo(0.9, 2);
    expect(r.values.issues.some((i) => i.code === 'flow-over-80')).toBe(true);
  });

  it('ошибка 2: смешаны роторы и спреи в одной зоне', () => {
    const r = zoneCheck({
      ...healthy,
      heads: [
        rotor('Ротор 1'),
        rotor('Ротор 2'),
        { name: 'Спрей 1', emitterClass: 'spray', flowLph: 400, sectorDeg: 180, precipitationRateMmH: 35 },
      ],
    });
    const issue = r.values.issues.find((i) => i.code === 'mixed-emitter-classes');
    expect(issue?.severity).toBe('error');
    expect(issue!.why).toMatch(/интенсивност/i);
    expect(r.values.emitterClassesUsed).toContain('rotor');
    expect(r.values.emitterClassesUsed).toContain('spray');
  });

  it('несогласованные сопла: сектор 90° с расходом от 360°', () => {
    const r = zoneCheck({
      ...healthy,
      heads: [
        rotor('Ротор 360', 600, 360, 12),
        rotor('Ротор 90 с неверным соплом', 600, 90, 48),
        rotor('Ротор 180', 600, 180, 12),
      ],
    });
    const issue = r.values.issues.find((i) => i.code === 'unmatched-pr');
    expect(issue?.severity).toBe('error');
    expect(r.values.prSpreadPercent).toBeGreaterThan(20);
  });

  it('ошибка 4: не учтён геодезический перепад — не хватает давления', () => {
    const r = zoneCheck({ ...healthy, elevationGainM: 15, inletPressureBar: 3.0 });
    expect(r.values.elevationLossM).toBe(15);
    expect(r.values.issues.some((i) => i.code === 'pressure-short-at-head')).toBe(true);
  });

  it('ошибка: труба мала — скорость выше предела', () => {
    const r = zoneCheck({ ...healthy, pipeInnerDiameterMm: 21.2 });
    expect(r.values.velocityMs).toBeGreaterThan(2.0);
    expect(r.values.issues.some((i) => i.code === 'zone-velocity-over-limit')).toBe(true);
  });

  it('ошибка: потери съедают больше 25 % рабочего давления', () => {
    const r = zoneCheck({ ...healthy, pipeInnerDiameterMm: 21.2, pipeLengthM: 90 });
    expect(r.values.lossShareOfWorkingPressure).toBeGreaterThan(0.25);
    const issue = r.values.issues.find((i) => i.code === 'loss-budget-exceeded');
    expect(issue?.severity).toBe('error');
  });

  it('ошибка 6: кабель 0,5 мм² на 160 м', () => {
    const r = zoneCheck({ ...healthy, cableLengthM: 160, cableCrossSectionMm2: 0.5 });
    expect(r.values.cableDropV).toBeGreaterThan(2.4);
    const issue = r.values.issues.find((i) => i.code === 'cable-drop-high');
    expect(issue?.severity).toBe('error');
    expect(issue!.fix).toMatch(/мм²/);
  });

  it('PR выше впитывания почвы — предупреждение с cycle & soak', () => {
    const r = zoneCheck({
      ...healthy,
      heads: [1, 2, 3, 4, 5, 6].map((i) => ({
        name: `Спрей ${i}`,
        emitterClass: 'spray' as const,
        flowLph: 600,
        sectorDeg: 180,
        precipitationRateMmH: 35,
      })),
      zoneAreaM2: 100,
      soilInfiltrationMmH: 10,
    });
    const issue = r.values.issues.find((i) => i.code === 'pr-over-infiltration');
    expect(issue?.severity).toBe('warning');
    expect(issue!.fix).toMatch(/цикл/i);
  });

  it('каждое замечание оформлено как «что не так → почему → как исправить»', () => {
    const r = zoneCheck({
      ...healthy,
      sourceFlowM3h: 2,
      pipeInnerDiameterMm: 21.2,
      cableLengthM: 200,
      cableCrossSectionMm2: 0.5,
    });
    expect(r.values.issues.length).toBeGreaterThanOrEqual(3);
    for (const i of r.values.issues) {
      expect(i.what.trim()).not.toBe('');
      expect(i.why.trim()).not.toBe('');
      expect(i.fix.trim()).not.toBe('');
      expect(i.code.trim()).not.toBe('');
    }
  });

  it('отклоняет зону без голов', () => {
    expect(() => zoneCheck({ ...healthy, heads: [] })).toThrow();
  });

  it('электрика не проверяется, если кабель не задан', () => {
    const noCable = { ...healthy };
    delete (noCable as Partial<ZoneCheckInput>).cableLengthM;
    delete (noCable as Partial<ZoneCheckInput>).cableCrossSectionMm2;
    const r = zoneCheck(noCable);
    expect(r.values.cableDropV).toBeNull();
  });
});
