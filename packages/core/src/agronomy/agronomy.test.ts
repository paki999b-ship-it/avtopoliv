import { describe, expect, it } from 'vitest';
import {
  headPrecipitationRate,
  zonePrecipitationRate,
  catalogPrForSector,
  TRIANGULAR_FACTOR,
} from './precipitation-rate.js';
import { irrigationRequirement } from './irrigation-requirement.js';
import { runTime } from './runtime.js';
import { soilWaterHoldingNorm } from './soil-water.js';
import { waterBalance } from './water-balance.js';
import { SOILS, findSoil, soilInfiltrationMmH, type SoilType } from '../data/soils.js';
import { PLANTS, findPlant } from '../data/plants.js';

describe('§5.6 Интенсивность дождя', () => {
  it('квадратная раскладка: q/(S·L)', () => {
    // 4 голов на 25 м², 500 л/ч на голову при шаге 5×5 → 20 мм/ч
    const r = headPrecipitationRate({ flowLph: 500, spacingM: 5, rowSpacingM: 5 });
    expect(r.values.areaPerHeadM2).toBeCloseTo(25, 6);
    expect(r.values.precipitationRateMmH).toBeCloseTo(20, 6);
  });

  it('треугольная раскладка использует множитель 0,866', () => {
    const sq = headPrecipitationRate({ flowLph: 500, spacingM: 5, pattern: 'square' });
    const tri = headPrecipitationRate({ flowLph: 500, spacingM: 5, pattern: 'triangular' });
    expect(tri.values.areaPerHeadM2).toBeCloseTo(25 * TRIANGULAR_FACTOR, 4);
    // Треугольник даёт меньшую площадь на голову → выше интенсивность.
    expect(tri.values.precipitationRateMmH).toBeGreaterThan(sq.values.precipitationRateMmH);
  });

  it('согласованные сопла дают одинаковую PR для 90° и 360°', () => {
    const full = headPrecipitationRate({ flowLph: 800, spacingM: 5, sectorDeg: 360 });
    const quarter = headPrecipitationRate({ flowLph: 200, spacingM: 5, sectorDeg: 90 });
    expect(quarter.values.precipitationRateMmH).toBeCloseTo(full.values.precipitationRateMmH, 6);
  });

  it('несогласованное сопло на угловой голове даёт вчетверо большую PR', () => {
    const full = headPrecipitationRate({ flowLph: 800, spacingM: 5, sectorDeg: 360 });
    const wrong = headPrecipitationRate({ flowLph: 800, spacingM: 5, sectorDeg: 90 });
    expect(wrong.values.precipitationRateMmH / full.values.precipitationRateMmH).toBeCloseTo(4, 6);
  });

  it('PR зоны по факту: суммарный расход / площадь', () => {
    const r = zonePrecipitationRate({ totalFlowLph: 3600, zoneAreaM2: 120 });
    expect(r.values.precipitationRateMmH).toBeCloseTo(30, 6);
  });

  it('предупреждает, когда PR выше впитывания почвы', () => {
    const r = zonePrecipitationRate({
      totalFlowLph: 3600,
      zoneAreaM2: 120,
      soilInfiltrationMmH: 10,
    });
    expect(r.values.infiltrationRatio).toBeCloseTo(3, 6);
    expect(r.notes.some((n) => n.code === 'pr-over-infiltration')).toBe(true);
  });

  it('замечает нетипичную PR для класса оборудования', () => {
    const r = zonePrecipitationRate({
      totalFlowLph: 12_000,
      zoneAreaM2: 100,
      emitterClass: 'rotor',
    });
    expect(r.notes.some((n) => n.code === 'pr-atypical')).toBe(true);
  });

  it('правило каталога Hunter: PR дана для 180°, для 360° делится на 2', () => {
    expect(catalogPrForSector(20, 360)).toBeCloseTo(10, 6);
    expect(catalogPrForSector(20, 180)).toBeCloseTo(20, 6);
    expect(catalogPrForSector(20, 90)).toBeCloseTo(40, 6);
  });
});

describe('§5.7 Норма полива', () => {
  it('нетто = ET0·Kc − осадки, брутто = нетто/DU', () => {
    const r = irrigationRequirement({ et0MmDay: 5, kc: 0.75, effectiveRainMm: 0, du: 0.75 });
    expect(r.values.etcMm).toBeCloseTo(3.75, 6);
    expect(r.values.nettoMm).toBeCloseTo(3.75, 6);
    expect(r.values.bruttoMm).toBeCloseTo(5.0, 6);
    expect(r.values.scheduleMultiplier).toBeCloseTo(1.3333, 3);
  });

  it('вычитает эффективные осадки', () => {
    const r = irrigationRequirement({ et0MmDay: 5, kc: 0.8, effectiveRainMm: 2, du: 0.8 });
    expect(r.values.nettoMm).toBeCloseTo(2, 6);
    expect(r.values.bruttoMm).toBeCloseTo(2.5, 6);
  });

  it('не уходит в минус, когда осадки перекрывают потребность', () => {
    const r = irrigationRequirement({ et0MmDay: 3, kc: 0.7, effectiveRainMm: 20, du: 0.75 });
    expect(r.values.nettoMm).toBe(0);
    expect(r.notes.some((n) => n.code === 'rain-covers')).toBe(true);
  });

  it('считает за период из нескольких суток', () => {
    const r = irrigationRequirement({ et0MmDay: 5, kc: 0.8, periodDays: 7, du: 0.8 });
    expect(r.values.etcMm).toBeCloseTo(28, 6);
  });

  it('DU ниже 0,60 — ошибка «переделывать раскладку»', () => {
    const r = irrigationRequirement({ et0MmDay: 5, kc: 0.8, du: 0.55 });
    const note = r.notes.find((n) => n.code === 'du-poor');
    expect(note?.severity).toBe('error');
    expect(note?.fix).toMatch(/раскладк/i);
  });

  it('DU между 0,60 и 0,70 — предупреждение', () => {
    const r = irrigationRequirement({ et0MmDay: 5, kc: 0.8, du: 0.65 });
    expect(r.notes.some((n) => n.code === 'du-low' && n.severity === 'warning')).toBe(true);
  });

  it('капельный пресет даёт меньшую норму брутто, чем спреи', () => {
    const spray = irrigationRequirement({ et0MmDay: 5, kc: 0.8, duPreset: 'spray' });
    const drip = irrigationRequirement({ et0MmDay: 5, kc: 0.8, duPreset: 'drip' });
    expect(drip.values.bruttoMm).toBeLessThan(spray.values.bruttoMm);
  });

  it('отклоняет Kc за пределами разумного', () => {
    expect(() => irrigationRequirement({ et0MmDay: 5, kc: 5 })).toThrow();
  });
});

describe('§5.8 Время полива и cycle & soak', () => {
  it('t = 60 · брутто / PR', () => {
    const r = runTime({ grossDepthMm: 17.5, precipitationRateMmH: 35 });
    expect(r.values.totalRunMinutes).toBeCloseTo(30, 6);
  });

  it('без данных о почве цикл не разбивается', () => {
    const r = runTime({ grossDepthMm: 10, precipitationRateMmH: 30 });
    expect(r.values.cycleAndSoakRequired).toBe(false);
    expect(r.values.cycles).toHaveLength(1);
    expect(r.notes.some((n) => n.code === 'no-soil-data')).toBe(true);
  });

  it('разбивает на циклы, когда PR выше впитывания', () => {
    const r = runTime({
      grossDepthMm: 17.5,
      precipitationRateMmH: 35,
      soilInfiltrationMmH: 11.5,
    });
    expect(r.values.cycleAndSoakRequired).toBe(true);
    expect(r.values.cycles.length).toBeGreaterThanOrEqual(2);
    expect(r.values.cycles.length).toBeLessThanOrEqual(3);
    // Суммарное время работы сохраняется.
    const sum = r.values.cycles.reduce((s, c) => s + c.runMinutes, 0);
    expect(sum).toBeCloseTo(r.values.totalRunMinutes, 1);
    // Сумма норм по циклам равна общей норме.
    const depth = r.values.cycles.reduce((s, c) => s + c.depthMm, 0);
    expect(depth).toBeCloseTo(17.5, 1);
    // У последнего цикла паузы нет.
    expect(r.values.cycles.at(-1)!.soakMinutes).toBe(0);
  });

  it('не разбивает, когда впитывание выше интенсивности', () => {
    const r = runTime({
      grossDepthMm: 10,
      precipitationRateMmH: 10,
      soilInfiltrationMmH: 25,
    });
    expect(r.values.cycleAndSoakRequired).toBe(false);
  });

  it('уклон выше 5 % снижает эффективное впитывание', () => {
    const flat = runTime({ grossDepthMm: 10, precipitationRateMmH: 20, soilInfiltrationMmH: 25 });
    const slope = runTime({
      grossDepthMm: 10,
      precipitationRateMmH: 20,
      soilInfiltrationMmH: 25,
      slopePercent: 12,
      slopeReduction: 0.5,
    });
    expect(flat.values.effectiveInfiltrationMmH).toBeCloseTo(25, 6);
    expect(slope.values.effectiveInfiltrationMmH).toBeCloseTo(12.5, 6);
    expect(slope.values.cycleAndSoakRequired).toBe(true);
  });

  it('уклон до 5 % поправку не включает', () => {
    const r = runTime({
      grossDepthMm: 10,
      precipitationRateMmH: 20,
      soilInfiltrationMmH: 25,
      slopePercent: 3,
      slopeReduction: 0.5,
    });
    expect(r.values.effectiveInfiltrationMmH).toBeCloseTo(25, 6);
  });

  it('полная длительность включает паузы', () => {
    const r = runTime({
      grossDepthMm: 20,
      precipitationRateMmH: 40,
      soilInfiltrationMmH: 8,
      soakMinutes: 45,
    });
    expect(r.values.totalElapsedMinutes).toBeGreaterThan(r.values.totalRunMinutes);
  });
});

describe('§5.9 Норма по запасу влаги', () => {
  it('норма = глубина · влагоёмкость · MAD', () => {
    const r = soilWaterHoldingNorm({ rootDepthM: 0.175, awcMmPerM: 150, mad: 0.5 });
    expect(r.values.totalAvailableMm).toBeCloseTo(26.25, 2);
    expect(r.values.netDepthMm).toBeCloseTo(13.1, 1);
  });

  it('интервал = норма / суточная потребность', () => {
    const r = soilWaterHoldingNorm({
      rootDepthM: 0.175,
      awcMmPerM: 150,
      mad: 0.5,
      dailyNetDemandMmDay: 3.75,
    });
    expect(r.values.intervalDays).toBeCloseTo(3.5, 1);
  });

  it('переводит норму в брутто по DU', () => {
    const r = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150, mad: 0.5, du: 0.75 });
    expect(r.values.grossDepthMm).toBeCloseTo(20, 1);
  });

  it('поправка FAO-56 снижает MAD в жару и повышает в прохладу', () => {
    const base = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150 });
    const hot = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150, etcMmDay: 8 });
    const cool = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150, etcMmDay: 2 });
    // p = 0,5 + 0,04 · (5 − ETc)
    expect(base.values.mad).toBe(0.5);
    expect(base.values.madAdjusted).toBe(false);
    expect(hot.values.mad).toBeCloseTo(0.38, 2);
    expect(cool.values.mad).toBeCloseTo(0.62, 2);
    expect(hot.values.madAdjusted).toBe(true);
    // В жару поливаем чаще и меньшей нормой.
    expect(hot.values.netDepthMm).toBeLessThan(base.values.netDepthMm);
  });

  it('поправка MAD ограничена диапазоном 0,1…0,8', () => {
    const veryHot = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150, etcMmDay: 25 });
    const veryCool = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150, etcMmDay: 0.1 });
    expect(veryHot.values.mad).toBeGreaterThanOrEqual(0.1);
    expect(veryCool.values.mad).toBeLessThanOrEqual(0.8);
  });

  it('MAD по умолчанию 0,5 для декоративного ландшафта', () => {
    const r = soilWaterHoldingNorm({ rootDepthM: 0.2, awcMmPerM: 150 });
    expect(r.values.mad).toBe(0.5);
  });

  it('предупреждает об интервале меньше суток', () => {
    const r = soilWaterHoldingNorm({
      rootDepthM: 0.1,
      awcMmPerM: 70,
      mad: 0.4,
      dailyNetDemandMmDay: 6,
    });
    expect(r.notes.some((n) => n.code === 'interval-under-day')).toBe(true);
  });

  it('деревья на суглинке дают заметно более редкий полив, чем газон', () => {
    const lawn = soilWaterHoldingNorm({ rootDepthM: 0.175, awcMmPerM: 165, dailyNetDemandMmDay: 4 });
    const tree = soilWaterHoldingNorm({ rootDepthM: 0.65, awcMmPerM: 165, dailyNetDemandMmDay: 4 });
    expect(tree.values.intervalDays!).toBeGreaterThan(lawn.values.intervalDays! * 3);
  });
});

describe('§5.10 Водный баланс', () => {
  it('потребность = норма брутто · площадь', () => {
    const r = waterBalance({
      grossDepthMm: 5,
      irrigatedAreaM2: 600,
      sourceFlowM3h: 3,
      windowHours: 6,
    });
    expect(r.values.demandLPerDay).toBe(3000);
  });

  it('доступно = дебит · окно · 1000 · 0,8', () => {
    const r = waterBalance({
      grossDepthMm: 5,
      irrigatedAreaM2: 600,
      sourceFlowM3h: 3,
      windowHours: 6,
    });
    expect(r.values.rawAvailableLPerDay).toBe(18_000);
    expect(r.values.availableLPerDay).toBe(14_400);
    expect(r.values.balanceOk).toBe(true);
  });

  it('при дефиците предлагает варианты решения', () => {
    const r = waterBalance({
      grossDepthMm: 6,
      irrigatedAreaM2: 1500,
      sourceFlowM3h: 1.2,
      windowHours: 6,
    });
    expect(r.values.balanceOk).toBe(false);
    expect(r.values.deficitLPerDay).toBeGreaterThan(0);
    expect(r.values.suggestions.length).toBeGreaterThanOrEqual(4);
    expect(r.values.suggestions.some((s) => /ёмкост/i.test(s.title))).toBe(true);
    expect(r.values.suggestions.some((s) => /капельн/i.test(s.title))).toBe(true);
  });

  it('считает буферную ёмкость в двух вариантах: строгом и с запасом 0,8', () => {
    const r = waterBalance({
      grossDepthMm: 6,
      irrigatedAreaM2: 1500,
      sourceFlowM3h: 1.2,
      windowHours: 6,
    });
    // Потребность 9000 л, физически доступно 7200 л, с запасом 5760 л.
    expect(r.values.tankVolumeStrictL).toBe(1800);
    expect(r.values.tankVolumeWithReserveL).toBe(3240);
    expect(r.values.tankVolumeWithReserveL).toBeGreaterThan(r.values.tankVolumeStrictL);
  });

  it('время наполнения = объём / дебит', () => {
    const r = waterBalance({
      grossDepthMm: 6,
      irrigatedAreaM2: 1500,
      sourceFlowM3h: 1.2,
      windowHours: 6,
    });
    expect(r.values.refillHours).toBeCloseTo(3.24 / 1.2, 2);
  });

  it('блокирует отбор выше дебита скважины (§10 п.5)', () => {
    const r = waterBalance({
      grossDepthMm: 8,
      irrigatedAreaM2: 2000,
      sourceFlowM3h: 1,
      windowHours: 6,
      sourceKind: 'borehole',
    });
    expect(r.values.utilisation).toBeGreaterThan(1);
    const err = r.notes.find((n) => n.code === 'over-source-capacity');
    expect(err?.severity).toBe('error');
    expect(r.notes.some((n) => n.code === 'well-limit')).toBe(true);
  });

  it('считает требуемое окно полива', () => {
    const r = waterBalance({
      grossDepthMm: 6,
      irrigatedAreaM2: 1500,
      sourceFlowM3h: 1.2,
      windowHours: 6,
    });
    expect(r.values.requiredWindowHours).toBeCloseTo(9000 / (1.2 * 1000 * 0.8), 1);
  });
});

describe('Справочные данные: почвы и растения', () => {
  it('у каждой почвы диапазоны непротиворечивы и есть источник', () => {
    for (const s of SOILS) {
      expect(s.infiltrationMinMmH).toBeLessThanOrEqual(s.infiltrationMaxMmH);
      expect(s.awcMinMmPerM).toBeLessThanOrEqual(s.awcMaxMmPerM);
      expect(s.infiltrationMinMmH).toBeGreaterThan(0);
      expect(s.source.trim()).not.toBe('');
      expect(s.titleRu.trim()).not.toBe('');
    }
  });

  it('песок впитывает быстрее глины, а глина держит больше влаги', () => {
    const sand = findSoil('sand');
    const clay = findSoil('clay');
    expect(sand.infiltrationMinMmH).toBeGreaterThan(clay.infiltrationMaxMmH);
    expect(clay.awcMinMmPerM).toBeGreaterThan(sand.awcMaxMmPerM);
  });

  it('среднее по диапазону лежит внутри диапазона', () => {
    for (const s of SOILS) {
      const mid = soilInfiltrationMmH(s.type);
      expect(mid).toBeGreaterThanOrEqual(s.infiltrationMinMmH);
      expect(mid).toBeLessThanOrEqual(s.infiltrationMaxMmH);
    }
  });

  it('Kc газона выше, чем у кустарников (§4 уровень 2)', () => {
    expect(findPlant('lawn').kcMin).toBeGreaterThan(findPlant('shrubs').kcMax);
  });

  it('глубина корневой зоны растёт от газона к деревьям', () => {
    expect(findPlant('trees').rootDepthMinM).toBeGreaterThan(findPlant('lawn').rootDepthMaxM);
    expect(findPlant('shrubs').rootDepthMinM).toBeGreaterThan(findPlant('lawn').rootDepthMaxM);
  });

  it('значения Kc из ТЗ §5.7 воспроизведены точно', () => {
    expect(findPlant('lawn').kcMin).toBe(0.7);
    expect(findPlant('lawn').kcMax).toBe(0.8);
    expect(findPlant('vegetables').kcMax).toBe(1.15);
    expect(findPlant('greenhouse').kcMax).toBe(1.2);
  });

  it('скорость впитывания почв соответствует FAO Table 7', () => {
    // FAO, Irrigation Methods, Annex 2, Table 7.
    expect(findSoil('sandy_loam').infiltrationMinMmH).toBe(20);
    expect(findSoil('sandy_loam').infiltrationMaxMmH).toBe(30);
    expect(findSoil('loam').infiltrationMinMmH).toBe(10);
    expect(findSoil('loam').infiltrationMaxMmH).toBe(20);
    expect(findSoil('clay_loam').infiltrationMinMmH).toBe(5);
    expect(findSoil('clay_loam').infiltrationMaxMmH).toBe(10);
    expect(findSoil('clay').infiltrationMinMmH).toBe(1);
    expect(findSoil('clay').infiltrationMaxMmH).toBe(5);
  });

  it('ряд впитывания монотонно убывает от песка к глине', () => {
    // Именно это свойство нарушала строка «sand: less than 30» в FAO Table 7.
    const order: SoilType[] = ['sand', 'sandy_loam', 'loam', 'clay_loam', 'clay'];
    for (let i = 1; i < order.length; i++) {
      expect(soilInfiltrationMmH(order[i]!)).toBeLessThan(soilInfiltrationMmH(order[i - 1]!));
    }
  });

  it('у каждой почвы, кроме торфа, источник подтверждён', () => {
    for (const s of SOILS) {
      if (s.type === 'peat') continue;
      expect(s.sourceStatus).toBe('verified');
      expect(s.sourceInfiltration).toMatch(/FAO/);
      expect(s.sourceAwc).toMatch(/UC ANR/);
    }
  });

  it('у каждой культуры заполнен источник', () => {
    for (const p of PLANTS) {
      expect(p.source.trim()).not.toBe('');
    }
  });
});

describe('Сверка §5.6 с каталогом Hunter Vol. 41 (RU)', () => {
  // Каталожные строки взяты из content/reference/hunter-nozzles.json,
  // извлечённого скриптом scripts/extract-hunter-catalog.ts.
  // Каталог печатает интенсивность при шаге «радиус в радиус» (S = R) для
  // сектора 180°: движок обязан воспроизводить эти значения без поправок.
  const catalogRows = [
    // модель, стр., радиус м, расход л/ч, PR квадрат, PR треугольник
    ['PGP-ADJ 1.5 синяя, 1,7 бар', 8.8, 270, 7, 8],
    ['PGP-ADJ 1.5 синяя, 3,0 бар', 9.8, 350, 7, 9],
    ['PGP Ultra 6.0 синяя, 4,5 бар', 12.8, 1890, 23, 27],
    ['I-40 15 серая, 6,0 бар', 16.5, 4344, 32, 37],
  ] as const;

  it.each(catalogRows)(
    'воспроизводит каталожную интенсивность: %s',
    (_name, radiusM, flowLph, prSquare, prTriangle) => {
      const sq = headPrecipitationRate({
        flowLph,
        spacingM: radiusM,
        pattern: 'square',
        sectorDeg: 180,
      });
      const tri = headPrecipitationRate({
        flowLph,
        spacingM: radiusM,
        pattern: 'triangular',
        sectorDeg: 180,
      });
      // Каталог печатает интенсивность целыми числами.
      expect(Math.abs(sq.values.precipitationRateMmH - prSquare)).toBeLessThanOrEqual(0.6);
      expect(Math.abs(tri.values.precipitationRateMmH - prTriangle)).toBeLessThanOrEqual(0.6);
      // Треугольная раскладка всегда интенсивнее квадратной в 1/0,866 раза.
      expect(tri.values.precipitationRateMmH / sq.values.precipitationRateMmH).toBeCloseTo(
        1 / TRIANGULAR_FACTOR,
        3,
      );
    },
  );

  it('правило «для 360° делить на 2» согласовано с каталогом', () => {
    // Каталожная PR□ для PGP-ADJ 1.5 при 1,7 бар — 7 мм/ч (сектор 180°).
    expect(catalogPrForSector(7, 360)).toBeCloseTo(3.5, 2);
    // Тот же результат через прямой расчёт полнокруговой головы.
    const full = headPrecipitationRate({ flowLph: 270, spacingM: 8.8, sectorDeg: 360 });
    expect(full.values.precipitationRateMmH).toBeCloseTo(3.49, 1);
  });
});
