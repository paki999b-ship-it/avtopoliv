/**
 * Сквозной расчёт участка — так, как его ведёт проектировщик по §4 уровень 4.
 *
 * Это контрольный пример приложения: он проходит через ET0 → норму → запас
 * влаги → интервал → PR → время полива → cycle & soak → водный баланс →
 * гидравлику ветки → напор насоса. Числа связаны между собой, поэтому тест
 * ловит рассогласование любой пары формул, а не только ошибку в одной.
 *
 * Исходные данные примера (метрика):
 *   газон 300 м², суглинок средний, ET0 в пик 5 мм/сут, Kc = 0,75,
 *   роторы с PR = 12 мм/ч, DU = 0,75, скважина 4 м³/ч, окно полива 6 ч.
 */

import { describe, expect, it } from 'vitest';
import { irrigationRequirement } from './agronomy/irrigation-requirement.js';
import { soilWaterHoldingNorm } from './agronomy/soil-water.js';
import { runTime } from './agronomy/runtime.js';
import { waterBalance } from './agronomy/water-balance.js';
import { zonePrecipitationRate } from './agronomy/precipitation-rate.js';
import { frictionLoss } from './hydraulics/friction.js';
import { minorLosses } from './hydraulics/minor-losses.js';
import { selectPipeDiameter } from './hydraulics/pipe-sizing.js';
import { pumpHead } from './pump/head.js';
import { zoneCheck } from './zone-check.js';
import { findSoil, soilAwcMmPerM, soilInfiltrationMmH } from './data/soils.js';
import { plantKc } from './data/plants.js';

const AREA_M2 = 300;
const ET0 = 5;
const DU = 0.75;
const SOIL = 'loam' as const;

describe('Сквозной расчёт участка: газон 300 м² на суглинке', () => {
  const kc = plantKc('lawn'); // (0,7 + 0,8) / 2 = 0,75

  it('шаг 1: Kc газона из справочника равен 0,75', () => {
    expect(kc).toBeCloseTo(0.75, 6);
  });

  const requirement = irrigationRequirement({ et0MmDay: ET0, kc, du: DU });

  it('шаг 2: суточная норма нетто 3,75 мм, брутто 5,0 мм', () => {
    expect(requirement.values.nettoMm).toBeCloseTo(3.75, 2);
    expect(requirement.values.bruttoMm).toBeCloseTo(5.0, 2);
    // Неравномерность стоит 1,25 мм воды каждые сутки.
    expect(requirement.values.uniformityLossMm).toBeCloseTo(1.25, 2);
  });

  // UC ANR для суглинка (loams, silt loams): 1,50–2,30 in/ft = 125–192 мм/м.
  const awc = soilAwcMmPerM(SOIL); // (125 + 192) / 2 = 158,5 мм/м
  const norm = soilWaterHoldingNorm({
    rootDepthM: 0.175,
    awcMmPerM: awc,
    mad: 0.5,
    du: DU,
    dailyNetDemandMmDay: requirement.values.nettoMm,
  });

  it('шаг 3: норма за один полив и интервал между поливами', () => {
    expect(awc).toBeCloseTo(158.5, 6);
    // 0,175 · 158,5 · 0,5 = 13,87 мм нетто
    expect(norm.values.netDepthMm).toBeCloseTo(13.87, 2);
    expect(norm.values.grossDepthMm).toBeCloseTo(18.49, 2);
    // 13,87 / 3,75 ≈ 3,7 сут — поливаем примерно раз в четыре дня
    expect(norm.values.intervalDays).toBeCloseTo(3.7, 1);
  });

  it('шаг 4: норма за полив согласована с суточной нормой и интервалом', () => {
    const perDay = norm.values.netDepthMm / norm.values.intervalDays!;
    expect(perDay).toBeCloseTo(requirement.values.nettoMm, 2);
  });

  const zonePr = zonePrecipitationRate({
    totalFlowLph: 3600,
    zoneAreaM2: AREA_M2,
    emitterClass: 'rotor',
    soilInfiltrationMmH: soilInfiltrationMmH(SOIL),
  });

  it('шаг 5: PR зоны 12 мм/ч — типично для роторов', () => {
    expect(zonePr.values.precipitationRateMmH).toBeCloseTo(12, 2);
    expect(zonePr.notes.some((n) => n.code === 'pr-typical')).toBe(true);
  });

  const schedule = runTime({
    grossDepthMm: norm.values.grossDepthMm!,
    precipitationRateMmH: zonePr.values.precipitationRateMmH,
    soilInfiltrationMmH: soilInfiltrationMmH(SOIL),
  });

  it('шаг 6: время полива около 92 минут, роторам на суглинке циклы не нужны', () => {
    // 60 · 18,49 / 12 = 92,4 мин
    expect(schedule.values.totalRunMinutes).toBeCloseTo(92.4, 0);
    // FAO Table 7 для суглинка: 10–20 мм/ч, среднее 15 — выше PR роторов 12 мм/ч.
    expect(soilInfiltrationMmH(SOIL)).toBeCloseTo(15, 2);
    expect(schedule.values.cycleAndSoakRequired).toBe(false);
    expect(schedule.values.cycles).toHaveLength(1);
  });

  it('шаг 6б: спреи на той же почве уже требуют разбивки на циклы', () => {
    const sprays = runTime({
      grossDepthMm: norm.values.grossDepthMm!,
      precipitationRateMmH: 35,
      soilInfiltrationMmH: soilInfiltrationMmH(SOIL),
    });
    expect(sprays.values.cycleAndSoakRequired).toBe(true);
    expect(sprays.values.cycles).toHaveLength(3);
    expect(sprays.values.totalElapsedMinutes).toBeGreaterThan(sprays.values.totalRunMinutes);
  });

  const balance = waterBalance({
    grossDepthMm: norm.values.grossDepthMm!,
    irrigatedAreaM2: AREA_M2,
    sourceFlowM3h: 4,
    windowHours: 6,
    sourceKind: 'borehole',
  });

  it('шаг 7: водный баланс сходится при дебите 4 м³/ч и окне 6 ч', () => {
    // 18,49 мм · 300 м² = 5547 л за полив
    expect(balance.values.demandLPerDay).toBeCloseTo(5547, 0);
    expect(balance.values.availableLPerDay).toBe(19_200);
    expect(balance.values.balanceOk).toBe(true);
    expect(balance.values.tankVolumeWithReserveL).toBe(0);
  });

  it('шаг 7б: на слабой скважине 1 м³/ч тот же участок требует буферной ёмкости', () => {
    const weak = waterBalance({
      grossDepthMm: norm.values.grossDepthMm!,
      irrigatedAreaM2: AREA_M2,
      sourceFlowM3h: 1,
      windowHours: 4,
      sourceKind: 'borehole',
    });
    expect(weak.values.balanceOk).toBe(false);
    expect(weak.values.tankVolumeWithReserveL).toBeGreaterThan(2000);
    expect(weak.values.suggestions.length).toBeGreaterThanOrEqual(4);
    expect(weak.notes.some((n) => n.code === 'well-limit')).toBe(true);
  });

  const sizing = selectPipeDiameter({ flowM3h: 3.6, standard: 'PE100 SDR11', lengthM: 40 });

  it('шаг 8: под 3,6 м³/ч подбирается ПНД 40 мм', () => {
    // Требуемый внутренний диаметр при цели 1,5 м/с — 29,1 мм.
    // ПНД 32 SDR11 даёт внутренний 26 мм: формально в предел 2,0 м/с попадает,
    // но целевого диапазона не держит, поэтому идёт в «вариант дешевле».
    expect(sizing.values.recommended).not.toBeNull();
    expect(sizing.values.requiredIdMm).toBeCloseTo(29.1, 0);
    expect(sizing.values.recommended!.odMm).toBe(40);
    expect(sizing.values.recommended!.velocityMs).toBeLessThanOrEqual(1.5);
    expect(sizing.values.smaller!.odMm).toBe(32);
    expect(sizing.values.smaller!.velocityMs).toBeGreaterThan(1.5);
    expect(sizing.values.smaller!.velocityMs).toBeLessThan(2.0);
  });

  const friction = frictionLoss({
    flowM3h: 3.6,
    innerDiameterMm: sizing.values.recommended!.idMm,
    lengthM: 40,
    material: 'pe_new',
  });
  const minor = minorLosses({
    frictionLossM: friction.values.headLossM,
    fittingsShare: 0.15,
    devices: [
      { name: 'Дисковый фильтр 1"', kind: 'filter', lossBar: 0.25, source: 'техкарта' },
      { name: 'Клапан зоны 1"', kind: 'valve', lossBar: 0.2, source: 'график потерь' },
    ],
  });

  it('шаг 9: потери ветки согласованы между модулями', () => {
    expect(friction.values.headLossM).toBeGreaterThan(0);
    // Подбор диаметра и прямой расчёт потерь дают одно и то же число.
    expect(sizing.values.recommended!.headLossM).toBeCloseTo(friction.values.headLossM, 2);
    expect(minor.values.grandTotalM).toBeGreaterThan(friction.values.headLossM);
  });

  const pump = pumpHead({
    flowM3h: 3.6,
    staticLiftM: 6,
    frictionLossM: friction.values.headLossM,
    minorLossM: minor.values.totalMinorLossM,
    sprinklerPressureBar: 2.5,
    safetyMargin: 0.1,
    efficiency: 0.6,
  });

  it('шаг 10: требуемый напор насоса складывается из посчитанных ранее слагаемых', () => {
    const expected =
      (6 + friction.values.headLossM + minor.values.totalMinorLossM + 2.5 * 10.2) * 1.1;
    expect(pump.values.requiredHeadM).toBeCloseTo(expected, 1);
    expect(pump.values.shaftPowerKw).toBeGreaterThan(0);
    expect(pump.values.shaftPowerKw).toBeLessThan(2);
  });

  it('шаг 11: сводная проверка зоны подтверждает, что проект собран верно', () => {
    const check = zoneCheck({
      zoneName: 'Газон перед домом',
      heads: [1, 2, 3, 4, 5, 6].map((i) => ({
        name: `Ротор ${i}`,
        emitterClass: 'rotor' as const,
        flowLph: 600,
        sectorDeg: 180,
        precipitationRateMmH: 12,
      })),
      zoneAreaM2: AREA_M2,
      sourceFlowM3h: 6,
      inletPressureBar: 3.5,
      requiredHeadPressureBar: 2.5,
      pipeInnerDiameterMm: sizing.values.recommended!.idMm,
      pipeLengthM: 40,
      pipeMaterial: 'pe_new',
      elevationGainM: 0,
      soilInfiltrationMmH: soilInfiltrationMmH(SOIL),
      cableLengthM: 60,
      cableCrossSectionMm2: 1.5,
    });

    expect(check.values.passed).toBe(true);
    // Расход и PR совпадают с тем, что считали по отдельности.
    expect(check.values.zoneFlowM3h).toBeCloseTo(3.6, 3);
    expect(check.values.precipitationRateMmH).toBeCloseTo(
      zonePr.values.precipitationRateMmH,
      2,
    );
    expect(check.values.frictionLossM).toBeCloseTo(friction.values.headLossM, 2);
  });

  it('справочник почв даёт ожидаемые характеристики суглинка', () => {
    const soil = findSoil(SOIL);
    expect(soil.titleRu).toBe('Суглинок средний');
    // FAO Table 7, строка «loam».
    expect(soil.infiltrationMinMmH).toBe(10);
    expect(soil.infiltrationMaxMmH).toBe(20);
    expect(soil.sourceStatus).toBe('verified');
  });
});

describe('Плохой проект даёт ошибки на каждом шаге', () => {
  it('перегруженная зона на глине с тонкой трубой и тонким кабелем', () => {
    const check = zoneCheck({
      zoneName: 'Зона «сколько влезет»',
      heads: [
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
          name: `Спрей ${i}`,
          emitterClass: 'spray' as const,
          flowLph: 700,
          sectorDeg: 180,
          precipitationRateMmH: 35,
        })),
        {
          name: 'Ротор, забытый в этой зоне',
          emitterClass: 'rotor' as const,
          flowLph: 600,
          sectorDeg: 180,
          precipitationRateMmH: 12,
        },
      ],
      zoneAreaM2: 160,
      sourceFlowM3h: 3,
      inletPressureBar: 3.0,
      requiredHeadPressureBar: 2.1,
      pipeInnerDiameterMm: 21.2,
      pipeLengthM: 70,
      pipeMaterial: 'pe_new',
      elevationGainM: 4,
      soilInfiltrationMmH: soilInfiltrationMmH('clay'),
      cableLengthM: 160,
      cableCrossSectionMm2: 0.5,
    });

    expect(check.values.passed).toBe(false);
    const codes = check.values.issues.map((i) => i.code);
    expect(codes).toContain('flow-over-source');
    expect(codes).toContain('mixed-emitter-classes');
    expect(codes).toContain('unmatched-pr');
    expect(codes).toContain('zone-velocity-over-limit');
    expect(codes).toContain('pr-over-infiltration');
    expect(codes).toContain('cable-drop-high');
  });
});
