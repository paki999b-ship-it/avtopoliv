/**
 * §5.15. Продувка на зиму.
 *
 * Правило подбора компрессора (ТЗ):
 *   CFM ≈ (расход зоны в GPM) / 7,5
 *
 * ПРИМЕЧАНИЕ О МЕТРИЧЕСКОЙ ФОРМЕ (см. DECISIONS.md):
 * в ТЗ приведено «м³/мин ≈ (л/мин) / 283», что не согласуется с правилом
 * CFM = GPM/7,5. Проверка цепочки:
 *   GPM = л/мин / 3,7854;  CFM = GPM / 7,5;  1 CFM = 0,0283 м³/мин
 *   → м³/мин = л/мин · 0,0283 / (3,7854 · 7,5) = л/мин / 1003
 * Число 283 — это множитель 0,0283, попавший в знаменатель без пересчёта.
 * Реализован согласованный вариант: м³/мин ≈ (л/мин) / 1000.
 *
 * Ограничения давления (ТЗ): полиэтилен — до ~3,5 бар, ПВХ — до ~5,5 бар;
 * при сомнениях в материале держаться нижней границы. Спреи — по нижней
 * границе, капельные зоны — 1,5–2 бар или самотёчный слив.
 */

import { BLOWOUT_PRESSURE_LIMIT_BAR } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange } from '../internal/build.js';
import type { CalcResult, EmitterClass } from '../types.js';
import { m3hToGpm, m3hToLmin } from '../units.js';

/** Точный коэффициент метрического пересчёта: л/мин → м³/мин при CFM = GPM/7,5. */
export const BLOWOUT_LPM_TO_M3MIN_DIVISOR = 3.785411784 * 7.5 * (1 / 0.0283168466);

export type BlowoutPipeMaterial = 'pe' | 'pvc' | 'unknown';

export interface BlowoutZone {
  name: string;
  /** Расход зоны, м³/ч. */
  flowM3h: number;
  emitterClass: EmitterClass;
  /** Расстояние от точки продувки, м — определяет порядок обхода. */
  distanceM?: number;
}

export interface BlowoutInput {
  zones: BlowoutZone[];
  pipeMaterial?: BlowoutPipeMaterial;
  /** Длительность одного прохода на зону, мин (1–2). По умолчанию 1,5. */
  passMinutes?: number;
  /** Число проходов. По умолчанию 2. */
  passes?: number;
}

export interface BlowoutZonePlan {
  order: number;
  name: string;
  flowM3h: number;
  requiredCfm: number;
  requiredM3Min: number;
  maxPressureBar: number;
  passMinutes: number;
  passes: number;
  note: string;
}

export interface BlowoutValues {
  /** Компрессор подбирается по самой «расходной» зоне. */
  requiredCfm: number;
  requiredM3Min: number;
  requiredLMin: number;
  maxPressureBar: number;
  materialNote: string;
  totalMinutes: number;
  plan: BlowoutZonePlan[];
}

function zonePressureLimit(material: BlowoutPipeMaterial, emitter: EmitterClass): number {
  const base =
    material === 'pvc'
      ? BLOWOUT_PRESSURE_LIMIT_BAR.pvc
      : BLOWOUT_PRESSURE_LIMIT_BAR.pe; // 'unknown' → нижняя граница
  if (emitter === 'drip') return BLOWOUT_PRESSURE_LIMIT_BAR.dripZone.max;
  if (emitter === 'spray' || emitter === 'strip' || emitter === 'micro_spray' || emitter === 'bubbler') {
    return Math.min(base, BLOWOUT_PRESSURE_LIMIT_BAR.pe);
  }
  return base;
}

export function blowoutPlan(input: BlowoutInput): CalcResult<BlowoutValues> {
  if (input.zones.length === 0) throw new Error('Не задана ни одна зона');
  const material: BlowoutPipeMaterial = input.pipeMaterial ?? 'unknown';
  const passMin = requireRange(input.passMinutes ?? 1.5, 0.5, 5, 'Длительность прохода');
  const passes = requireRange(input.passes ?? 2, 1, 5, 'Число проходов');

  const log = new StepLog();

  const worst = input.zones.reduce((a, b) => (b.flowM3h > a.flowM3h ? b : a));
  requirePositive(worst.flowM3h, 'Расход зоны');
  const gpm = m3hToGpm(worst.flowM3h);
  const cfm = gpm / 7.5;
  const lpm = m3hToLmin(worst.flowM3h);
  const m3min = lpm / BLOWOUT_LPM_TO_M3MIN_DIVISOR;

  log.step(
    'Самая расходная зона',
    'компрессор подбирается по максимуму, а не по средней зоне',
    `«${worst.name}»`,
    `${fmt(worst.flowM3h, 2)} м³/ч`,
  );
  log.step(
    'Расход зоны в GPM',
    'GPM = Q [м³/ч] · 1000 / 3,7854 / 60',
    `${fmt(worst.flowM3h, 2)} · 1000 / 3,7854 / 60`,
    `${fmt(gpm, 1)} GPM`,
  );
  log.step(
    'Производительность компрессора',
    'CFM ≈ GPM / 7,5',
    `${fmt(gpm, 1)} / 7,5`,
    `${fmt(cfm, 2)} CFM`,
  );
  log.step(
    'То же в метрике',
    'м³/мин ≈ (л/мин) / 1000',
    `${fmt(lpm, 1)} / ${fmt(BLOWOUT_LPM_TO_M3MIN_DIVISOR, 0)}`,
    `${fmt(m3min, 3)} м³/мин (${fmt(m3min * 1000, 0)} л/мин)`,
  );

  // Предел по материалу трубопровода — общий для системы. Более жёсткие
  // ограничения по типу дождевателя применяются к каждой зоне отдельно.
  const limit =
    material === 'pvc' ? BLOWOUT_PRESSURE_LIMIT_BAR.pvc : BLOWOUT_PRESSURE_LIMIT_BAR.pe;
  const materialNote =
    material === 'pvc'
      ? 'ПВХ: до ~5,5 бар'
      : material === 'pe'
        ? 'полиэтилен: до ~3,5 бар'
        : 'материал не определён — держимся нижней границы, ~3,5 бар';

  log.step(
    'Предельное давление продувки',
    'по материалу трубы, при сомнениях — нижняя граница',
    materialNote,
    `не выше ${fmt(limit, 1)} бар`,
  );

  const sorted = [...input.zones].sort((a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0));
  const plan: BlowoutZonePlan[] = sorted.map((z, i) => {
    const zGpm = m3hToGpm(z.flowM3h);
    const zLimit = zonePressureLimit(material, z.emitterClass);
    let note: string;
    if (z.emitterClass === 'drip') {
      note = 'Капельная зона: 1,5–2 бар, а лучше самотёчный слив через концевые заглушки.';
    } else if (z.emitterClass === 'rotor') {
      note = 'Ротор: не гоняйте воздух дольше нужного — сухие подшипники редуктора перегреваются.';
    } else if (z.emitterClass === 'spray') {
      note = 'Спреи: по нижней границе давления, штоки поднимутся сами.';
    } else {
      note = 'Продувайте короткими порциями, следите за выходом тумана.';
    }
    return {
      order: i + 1,
      name: z.name,
      flowM3h: round(z.flowM3h, 2),
      requiredCfm: round(zGpm / 7.5, 2),
      requiredM3Min: round(m3hToLmin(z.flowM3h) / BLOWOUT_LPM_TO_M3MIN_DIVISOR, 3),
      maxPressureBar: zLimit,
      passMinutes: passMin,
      passes,
      note,
    };
  });

  const totalMinutes = plan.length * passMin * passes;
  log.step(
    'Порядок обхода',
    'от самой дальней зоны к ближней',
    plan.map((p) => p.name).join(' → '),
    `${plan.length} зон`,
  );
  log.step(
    'Общая длительность',
    'T = зоны · проходы · время прохода',
    `${plan.length} · ${fmt(passes, 0)} · ${fmt(passMin, 1)}`,
    `${fmt(totalMinutes, 0)} мин`,
  );

  log.warn(
    'blowout-safety',
    'Продувка — самая травмоопасная операция сезона',
    'Голова дождевателя под воздухом может выстрелить из грунта, а вылетающая струя воды с мусором бьёт в лицо. Превышение давления выбивает уплотнения клапанов и рвёт мембраны.',
    'Защитные очки обязательны. Никто не стоит над головами во время продувки. Давление поднимается плавно, порциями по 1–2 минуты, несколько проходов.',
  );
  log.info(
    'blowout-portions',
    `Продувайте порциями по ${fmt(passMin, 1)} мин на зону, ${fmt(passes, 0)} прохода`,
    'За один длинный проход вода из тупиков всё равно не уйдёт, а оборудование перегреется. Несколько коротких проходов эффективнее и безопаснее.',
  );
  if (material === 'unknown') {
    log.warn(
      'blowout-material-unknown',
      'Материал трубопровода не указан',
      'Давление, безопасное для ПВХ, может разрушить полиэтиленовые фитинги.',
      'Уточните материал по исполнительной схеме; до выяснения не поднимайте давление выше 3,5 бар.',
    );
  }
  log.info(
    'blowout-drain-valves',
    'Дренажные клапаны при штатной продувке — лишняя точка отказа',
    'Они подтекают, забиваются и создают ложное ощущение, что система осушена.',
  );

  return {
    values: {
      requiredCfm: round(cfm, 2),
      requiredM3Min: round(m3min, 3),
      requiredLMin: round(m3min * 1000, 1),
      maxPressureBar: limit,
      materialNote,
      totalMinutes: round(totalMinutes, 0),
      plan,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
