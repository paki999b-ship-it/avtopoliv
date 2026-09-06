/**
 * §5.8. Время полива и режим cycle & soak.
 *
 *   t [мин] = 60 · Норма_брутто [мм] / PR [мм/ч]
 *
 * Если PR выше скорости впитывания почвы — полив автоматически разбивается
 * на 2–3 цикла с паузой 30–60 мин, и результат выдаётся готовым графиком.
 * На склоне круче 5 % впитывание уменьшается на 25–50 % (коэффициент
 * выбирает пользователь).
 */

import { fmt, round } from '../format.js';
import { StepLog, clamp, requirePositive, requireRange, requireNonNegative } from '../internal/build.js';
import type { CalcResult } from '../types.js';

export interface RunTimeInput {
  /** Норма брутто за один полив, мм. */
  grossDepthMm: number;
  /** Интенсивность дождя зоны, мм/ч. */
  precipitationRateMmH: number;
  /** Скорость впитывания почвы, мм/ч. Без неё cycle & soak не проверяется. */
  soilInfiltrationMmH?: number;
  /** Уклон участка, %. */
  slopePercent?: number;
  /**
   * Насколько уменьшить впитывание на склоне, доля 0,25–0,50 (ТЗ §5.8).
   * Применяется только при уклоне выше 5 %.
   */
  slopeReduction?: number;
  /** Пауза между циклами, мин (30–60). По умолчанию 45. */
  soakMinutes?: number;
  /** Максимальное число циклов. По умолчанию 3. */
  maxCycles?: number;
}

export interface RunCycle {
  index: number;
  runMinutes: number;
  soakMinutes: number;
  /** Норма, поданная за этот цикл, мм. */
  depthMm: number;
}

export interface RunTimeValues {
  /** Полное время работы зоны без учёта пауз, мин. */
  totalRunMinutes: number;
  /** Полная длительность с паузами, мин. */
  totalElapsedMinutes: number;
  /** Эффективная скорость впитывания с поправкой на уклон, мм/ч. */
  effectiveInfiltrationMmH: number | null;
  cycleAndSoakRequired: boolean;
  cycles: RunCycle[];
}

export function runTime(input: RunTimeInput): CalcResult<RunTimeValues> {
  const depth = requirePositive(input.grossDepthMm, 'Норма брутто');
  const pr = requirePositive(input.precipitationRateMmH, 'Интенсивность дождя');
  const soak = requireRange(input.soakMinutes ?? 45, 5, 240, 'Пауза между циклами');
  const maxCycles = requireRange(input.maxCycles ?? 3, 1, 6, 'Максимум циклов');

  const log = new StepLog();
  const total = (60 * depth) / pr;

  log.step(
    'Время полива',
    't = 60 · Норма_брутто / PR',
    `60 · ${fmt(depth, 1)} / ${fmt(pr, 1)}`,
    `${fmt(total, 0)} мин`,
  );

  let effInf: number | null = null;
  let cycleNeeded = false;
  let cycles: RunCycle[] = [
    { index: 1, runMinutes: round(total, 1), soakMinutes: 0, depthMm: round(depth, 2) },
  ];

  if (input.soilInfiltrationMmH !== undefined) {
    const baseInf = requirePositive(input.soilInfiltrationMmH, 'Скорость впитывания');
    const slope = requireNonNegative(input.slopePercent ?? 0, 'Уклон');
    const reduction = slope > 5 ? requireRange(input.slopeReduction ?? 0.25, 0, 0.9, 'Поправка на уклон') : 0;
    effInf = baseInf * (1 - reduction);

    if (reduction > 0) {
      log.step(
        'Поправка впитывания на уклон',
        'I_эф = I · (1 − k_уклона)',
        `${fmt(baseInf, 1)} · (1 − ${fmt(reduction, 2)})`,
        `${fmt(effInf, 1)} мм/ч`,
      );
      log.info(
        'slope-correction',
        `Уклон ${fmt(slope, 0)} % — впитывание снижено на ${fmt(reduction * 100, 0)} %`,
        'На склоне часть воды успевает стечь до того, как впитается; чем круче и плотнее грунт, тем сильнее эффект.',
        'Диапазон поправки 25–50 % выбирается по факту: если на поливе видны ручейки — берите верхнюю границу.',
      );
    }

    cycleNeeded = pr > effInf;
    log.step(
      'Проверка на сток',
      'cycle & soak нужен, если PR > I_эф',
      `${fmt(pr, 1)} против ${fmt(effInf, 1)} мм/ч`,
      cycleNeeded ? 'нужен' : 'не нужен',
    );

    if (cycleNeeded) {
      const n = clamp(Math.ceil(pr / effInf), 2, maxCycles);
      const runPer = total / n;
      const depthPer = depth / n;
      cycles = Array.from({ length: n }, (_, i) => ({
        index: i + 1,
        runMinutes: round(runPer, 1),
        soakMinutes: i === n - 1 ? 0 : soak,
        depthMm: round(depthPer, 2),
      }));
      log.step(
        'Число циклов',
        'n = округление вверх( PR / I_эф ), не более заданного максимума',
        `округление вверх(${fmt(pr, 1)} / ${fmt(effInf, 1)}) = ${Math.ceil(pr / effInf)}`,
        `${n} цикла по ${fmt(runPer, 0)} мин с паузой ${fmt(soak, 0)} мин`,
      );
      log.warn(
        'cycle-and-soak',
        `Интенсивность выше впитывания — полив разбит на ${n} цикла`,
        'Непрерывный полив на такой почве даст лужи и сток: вода уйдёт с участка, а корневая зона останется сухой.',
        `Задайте на контроллере ${n} старта по ${fmt(runPer, 0)} мин с интервалом не менее ${fmt(soak, 0)} мин, либо включите функцию cycle & soak, если контроллер её поддерживает.`,
      );
    }
  } else {
    log.info(
      'no-soil-data',
      'Скорость впитывания почвы не задана — проверка на сток не выполнена',
      'Для спреев (25–50 мм/ч) на суглинке и глине cycle & soak нужен почти всегда.',
      'Укажите тип почвы, чтобы калькулятор построил график циклов.',
    );
  }

  const totalElapsed = cycles.reduce((s, c) => s + c.runMinutes + c.soakMinutes, 0);
  if (cycles.length > 1) {
    log.step(
      'Полная длительность',
      'T = Σ (работа + пауза)',
      cycles.map((c) => `${fmt(c.runMinutes, 0)}+${fmt(c.soakMinutes, 0)}`).join(' + '),
      `${fmt(totalElapsed, 0)} мин`,
    );
  }

  if (total > 90 && cycles.length === 1) {
    log.info(
      'long-run',
      `Один полив длится ${fmt(total, 0)} мин`,
      'Это нормально для капельных зон и роторов, но проверьте, помещается ли вся программа в окно полива.',
      'Сложите время всех зон и сверьте с окном полива в водном балансе.',
    );
  }

  return {
    values: {
      totalRunMinutes: round(total, 1),
      totalElapsedMinutes: round(totalElapsed, 1),
      effectiveInfiltrationMmH: effInf === null ? null : round(effInf, 2),
      cycleAndSoakRequired: cycleNeeded,
      cycles,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
