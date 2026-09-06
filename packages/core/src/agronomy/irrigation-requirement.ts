/**
 * §5.7. Норма полива.
 *
 *   Нетто [мм] = ET0 · Kc − эффективные осадки
 *   Брутто [мм] = Нетто / DU
 *   Множитель графика = 1 / DU
 *
 * DU (ТЗ §5.7): дождеватели 0,70–0,80, роторные сопла ≈ 0,80,
 * капельный 0,85–0,90.
 * Ориентир приемлемости DU — около 0,70 и выше; хуже 0,60 — переделывать
 * раскладку, а не добавлять минуты (ТЗ §4, уровень 4).
 */

import { DU_DEFAULTS, DU_THRESHOLDS } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requireNonNegative, requireRange } from '../internal/build.js';
import type { CalcResult } from '../types.js';

export type DuPreset = keyof typeof DU_DEFAULTS;

export interface IrrigationRequirementInput {
  /** Эталонная эвапотранспирация, мм/сут. */
  et0MmDay: number;
  /** Коэффициент культуры. */
  kc: number;
  /** Эффективные осадки за тот же период, мм. По умолчанию 0. */
  effectiveRainMm?: number;
  /** Равномерность полива (distribution uniformity, нижняя четверть). */
  du?: number;
  /** Пресет DU по классу оборудования, если `du` не задан. */
  duPreset?: DuPreset;
  /** Период расчёта, суток. По умолчанию 1 (суточная норма). */
  periodDays?: number;
}

export interface IrrigationRequirementValues {
  /** Потребность культуры ETc = ET0 · Kc, мм за период. */
  etcMm: number;
  /** Норма нетто, мм за период. */
  nettoMm: number;
  /** Норма брутто, мм за период. */
  bruttoMm: number;
  du: number;
  /** Множитель времени полива = 1 / DU. */
  scheduleMultiplier: number;
  /** Перерасход воды из-за неравномерности, мм. */
  uniformityLossMm: number;
}

export function irrigationRequirement(
  input: IrrigationRequirementInput,
): CalcResult<IrrigationRequirementValues> {
  const et0 = requireNonNegative(input.et0MmDay, 'ET0');
  const kc = requireRange(input.kc, 0.05, 2, 'Kc');
  const rain = requireNonNegative(input.effectiveRainMm ?? 0, 'Эффективные осадки');
  const days = requireRange(input.periodDays ?? 1, 1, 366, 'Период');
  const du = requireRange(
    input.du ?? DU_DEFAULTS[input.duPreset ?? 'spray'].typical,
    0.2,
    1,
    'DU',
  );

  const log = new StepLog();
  const etc = et0 * kc * days;
  const netto = Math.max(0, etc - rain);
  const brutto = netto / du;
  const multiplier = 1 / du;

  log.step(
    'Потребность культуры',
    'ETc = ET0 · Kc · дни',
    `${fmt(et0, 1)} · ${fmt(kc, 2)} · ${fmt(days, 0)}`,
    `${fmt(etc, 1)} мм`,
  );
  log.step(
    'Норма нетто',
    'Нетто = ETc − эффективные осадки',
    `${fmt(etc, 1)} − ${fmt(rain, 1)}`,
    `${fmt(netto, 1)} мм`,
  );
  log.step(
    'Норма брутто',
    'Брутто = Нетто / DU',
    `${fmt(netto, 1)} / ${fmt(du, 2)}`,
    `${fmt(brutto, 1)} мм`,
  );
  log.step(
    'Множитель графика',
    'k = 1 / DU',
    `1 / ${fmt(du, 2)}`,
    `× ${fmt(multiplier, 2)} ко времени полива`,
  );

  if (etc - rain <= 0 && rain > 0) {
    log.info(
      'rain-covers',
      'Осадки перекрывают потребность за период — полив не нужен',
      'Именно для этого ставят датчик дождя: он экономит не столько воду, сколько ресурс клапанов и корни растений.',
    );
  }

  if (du < DU_THRESHOLDS.poor) {
    log.error(
      'du-poor',
      `DU = ${fmt(du, 2)} — раскладка неприемлема`,
      `Чтобы самая сухая четверть участка получила норму, всей зоне придётся дать в ${fmt(multiplier, 2)} раза больше воды. Перелив на остальных ${fmt(100 - 100 / multiplier, 0)} % площади вы оплачиваете каждый полив всю жизнь системы.`,
      'Переделывайте раскладку: шаг, перекрытие, согласованные сопла. Добавление минут сухие пятна не лечит.',
    );
  } else if (du < DU_THRESHOLDS.acceptable) {
    log.warn(
      'du-low',
      `DU = ${fmt(du, 2)} ниже отраслевого ориентира 0,70`,
      `Норма брутто выросла до ${fmt(brutto, 1)} мм против ${fmt(netto, 1)} мм нетто — это ${fmt(brutto - netto, 1)} мм лишней воды за каждый полив.`,
      'Проверьте шаг между головами и перекрытие: чаще всего DU роняет именно растянутый шаг.',
    );
  }

  log.info(
    'du-source',
    'DU измеряется тестом «баночками» на смонтированной системе',
    'Расчётное DU — это ожидание от раскладки; фактическое зависит от давления, ветра и состояния сопел.',
    'После пусконаладки проведите аудит и подставьте измеренное DU в график.',
  );

  return {
    values: {
      etcMm: round(etc, 2),
      nettoMm: round(netto, 2),
      bruttoMm: round(brutto, 2),
      du: round(du, 3),
      scheduleMultiplier: round(multiplier, 3),
      uniformityLossMm: round(brutto - netto, 2),
    },
    steps: log.steps,
    notes: log.notes,
  };
}
