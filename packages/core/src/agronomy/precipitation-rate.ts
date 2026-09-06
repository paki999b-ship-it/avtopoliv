/**
 * §5.6. Интенсивность дождя (precipitation rate, PR).
 *
 *   PR [мм/ч] = q [л/ч] / A [м²]
 *   A на один дождеватель: квадрат = S · L, треугольник = S · L · 0,866
 *   Для сектора: q — фактический расход головы, A — фактически поливаемая площадь.
 *
 * Тождество единиц: 1 л/м² = 1 мм, значит л/(ч·м²) = мм/ч.
 *
 * Правило каталога Hunter (ТЗ §8 п.1): интенсивность в каталоге приводится
 * для сектора 180°; для 360° делить на 2.
 */

import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange } from '../internal/build.js';
import type { CalcResult, EmitterClass, LayoutPattern } from '../types.js';

/** Коэффициент площади для треугольной раскладки (ТЗ §5.6). */
export const TRIANGULAR_FACTOR = 0.866;

export interface HeadPrInput {
  /** Фактический расход одной головы, л/ч. */
  flowLph: number;
  /** Шаг между дождевателями в ряду, м. */
  spacingM: number;
  /** Шаг между рядами, м. По умолчанию равен шагу в ряду (квадрат). */
  rowSpacingM?: number;
  pattern?: LayoutPattern;
  /** Сектор полива, град. 360 — полный круг. */
  sectorDeg?: number;
}

export interface HeadPrValues {
  /** Площадь, приходящаяся на одну голову, м². */
  areaPerHeadM2: number;
  precipitationRateMmH: number;
  pattern: LayoutPattern;
  sectorDeg: number;
}

/**
 * Интенсивность одной головы в сетке раскладки.
 *
 * Площадь, «обслуживаемая» головой, пропорциональна её сектору: угловая голова
 * на 90° отвечает за четверть площади полнокруговой. При согласованных соплах
 * (matched precipitation rate) её расход тоже вчетверо меньше — и PR совпадает.
 */
export function headPrecipitationRate(input: HeadPrInput): CalcResult<HeadPrValues> {
  const flow = requirePositive(input.flowLph, 'Расход головы');
  const spacing = requirePositive(input.spacingM, 'Шаг между дождевателями');
  const rowSpacing = requirePositive(input.rowSpacingM ?? input.spacingM, 'Шаг между рядами');
  const pattern: LayoutPattern = input.pattern ?? 'square';
  const sector = requireRange(input.sectorDeg ?? 360, 1, 360, 'Сектор полива');

  const log = new StepLog();
  const factor = pattern === 'triangular' ? TRIANGULAR_FACTOR : 1;
  const fullArea = spacing * rowSpacing * factor;
  const area = fullArea * (sector / 360);
  const pr = flow / area;

  log.step(
    'Площадь на полнокруговую голову',
    pattern === 'triangular' ? 'A₃₆₀ = S · L · 0,866' : 'A₃₆₀ = S · L',
    pattern === 'triangular'
      ? `${fmt(spacing, 2)} · ${fmt(rowSpacing, 2)} · 0,866`
      : `${fmt(spacing, 2)} · ${fmt(rowSpacing, 2)}`,
    `${fmt(fullArea, 2)} м²`,
  );
  if (sector !== 360) {
    log.step(
      'Поправка на сектор',
      'A = A₃₆₀ · сектор / 360',
      `${fmt(fullArea, 2)} · ${fmt(sector, 0)} / 360`,
      `${fmt(area, 2)} м²`,
    );
  }
  log.step(
    'Интенсивность дождя',
    'PR = q / A,  [л/ч] / [м²] = мм/ч',
    `${fmt(flow, 0)} / ${fmt(area, 2)}`,
    `${fmt(pr, 1)} мм/ч`,
  );

  log.info(
    'matched-pr',
    'Проверьте согласованность сопел (matched precipitation rate)',
    'Сопло на 90° должно давать четверть расхода сопла на 360°. Если поставить полнокруговое сопло на угловую голову, угол получит вчетверо больше воды.',
    'В одной зоне используйте комплект сопел одной серии с согласованной интенсивностью.',
  );

  return {
    values: {
      areaPerHeadM2: round(area, 2),
      precipitationRateMmH: round(pr, 2),
      pattern,
      sectorDeg: sector,
    },
    steps: log.steps,
    notes: log.notes,
  };
}

export interface ZonePrInput {
  /** Суммарный расход зоны, л/ч. */
  totalFlowLph: number;
  /** Фактически поливаемая площадь зоны, м². */
  zoneAreaM2: number;
  /** Класс оборудования — для сверки с типовым диапазоном. */
  emitterClass?: EmitterClass;
  /** Скорость впитывания почвы, мм/ч — для проверки на сток. */
  soilInfiltrationMmH?: number;
}

export interface ZonePrValues {
  precipitationRateMmH: number;
  /** Отношение PR к скорости впитывания, если она задана. */
  infiltrationRatio: number | null;
}

/** Типовые диапазоны PR по классам оборудования (ТЗ §4 уровень 3, §11 п.2). */
export const TYPICAL_PR_MM_H: Partial<Record<EmitterClass, { min: number; max: number }>> = {
  spray: { min: 25, max: 50 },
  rotor: { min: 8, max: 18 },
  rotary_nozzle: { min: 8, max: 13 },
  drip: { min: 3, max: 12 },
};

/** §5.6, режим «PR зоны по факту»: суммарный расход зоны / площадь зоны. */
export function zonePrecipitationRate(input: ZonePrInput): CalcResult<ZonePrValues> {
  const flow = requirePositive(input.totalFlowLph, 'Суммарный расход зоны');
  const area = requirePositive(input.zoneAreaM2, 'Площадь зоны');

  const log = new StepLog();
  const pr = flow / area;

  log.step(
    'Интенсивность зоны по факту',
    'PR = Q_зоны [л/ч] / A_зоны [м²]',
    `${fmt(flow, 0)} / ${fmt(area, 1)}`,
    `${fmt(pr, 1)} мм/ч`,
  );

  const typical = input.emitterClass ? TYPICAL_PR_MM_H[input.emitterClass] : undefined;
  if (typical) {
    if (pr < typical.min * 0.6 || pr > typical.max * 1.4) {
      log.warn(
        'pr-atypical',
        `PR ${fmt(pr, 1)} мм/ч заметно выходит за типовой диапазон ${typical.min}–${typical.max} мм/ч для этого класса оборудования`,
        'Обычно это признак ошибки: неверно посчитана площадь зоны, забыта часть голов или в зоне смешаны разные классы.',
        'Пересчитайте площадь именно поливаемой части зоны и суммарный расход всех голов.',
      );
    } else {
      log.info('pr-typical', `PR в пределах типового для класса: ${typical.min}–${typical.max} мм/ч`);
    }
  }

  let ratio: number | null = null;
  if (input.soilInfiltrationMmH !== undefined) {
    const inf = requirePositive(input.soilInfiltrationMmH, 'Скорость впитывания');
    ratio = pr / inf;
    log.step(
      'Сравнение с впитыванием',
      'k = PR / I_почвы',
      `${fmt(pr, 1)} / ${fmt(inf, 1)}`,
      `${fmt(ratio, 2)}`,
    );
    if (ratio > 1) {
      log.warn(
        'pr-over-infiltration',
        `Интенсивность выше впитывания в ${fmt(ratio, 2)} раза`,
        'Вода не успевает уходить в почву: часть стекает с уклона или стоит лужей, а корневая зона остаётся сухой.',
        'Разбейте полив на 2–3 цикла с паузой 30–60 минут (режим cycle & soak) — калькулятор времени полива сделает это автоматически.',
      );
    }
  }

  return {
    values: { precipitationRateMmH: round(pr, 2), infiltrationRatio: ratio === null ? null : round(ratio, 2) },
    steps: log.steps,
    notes: log.notes,
  };
}

/**
 * Пересчёт каталожной интенсивности Hunter (дана для 180°) на другой сектор.
 * Для 360° результат вдвое меньше — правило ТЗ §8 п.1.
 *
 * Применимо к головам с регулируемым сектором, у которых расход сопла не
 * меняется при изменении угла. Комплекты согласованных сопел (MPR) сами
 * выдерживают одинаковую PR — там пересчёт не нужен.
 */
export function catalogPrForSector(prAt180MmH: number, sectorDeg: number): number {
  requirePositive(prAt180MmH, 'Каталожная интенсивность');
  requireRange(sectorDeg, 1, 360, 'Сектор');
  return round((prAt180MmH * 180) / sectorDeg, 2);
}
