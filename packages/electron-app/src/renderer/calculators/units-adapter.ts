import {
  ftToM,
  gpmToM3h,
  inHToMmH,
  inchToMm,
  m2ToSqft,
  m3hToGpm,
  mToFt,
  mmHToInH,
  mmToInch,
  psiToBar,
  barToPsi,
  sqftToM2,
  litreToGallon,
  gallonToLitre,
} from '@irrigo/core';
import type { UnitSystem } from '@shared/types.js';
import type { Quantity } from './types.js';

/**
 * Переключатель систем единиц (§1, §13 ТЗ).
 *
 * Расчётный движок принимает и возвращает только метрику — так формулы §5
 * остаются ровно теми, что записаны в ТЗ. Имперская система живёт в
 * представлении: значение переводится на входе в форму и обратно перед
 * вызовом движка.
 *
 * Вывод формул (`steps`) не переводится: подстановка чисел показывается в тех
 * единицах, в которых формула определена. Пересчитанная «на лету» подстановка
 * перестала бы сходиться с формулой над ней и стала бы вредной.
 */

interface UnitAdapter {
  /** Подпись единицы в имперской системе. */
  unit: string;
  /** Имперское значение → метрическое (то, что понимает движок). */
  toMetric: (value: number) => number;
  /** Метрическое значение → имперское (то, что видит пользователь). */
  fromMetric: (value: number) => number;
  /** Сколько знаков показывать в имперской системе. */
  digits?: number;
}

const IMPERIAL: Record<Quantity, UnitAdapter> = {
  pressure: { unit: 'psi', toMetric: psiToBar, fromMetric: barToPsi, digits: 1 },
  flow: { unit: 'GPM', toMetric: gpmToM3h, fromMetric: m3hToGpm, digits: 1 },
  // Расход эмиттера: л/ч → GPH (галлоны в час).
  flowLph: {
    unit: 'GPH',
    toMetric: (gph) => gallonToLitre(gph),
    fromMetric: (lph) => litreToGallon(lph),
    digits: 2,
  },
  length: { unit: 'ft', toMetric: ftToM, fromMetric: mToFt, digits: 1 },
  diameter: { unit: 'in', toMetric: inchToMm, fromMetric: mmToInch, digits: 2 },
  area: { unit: 'ft²', toMetric: sqftToM2, fromMetric: m2ToSqft, digits: 0 },
  volume: { unit: 'gal', toMetric: gallonToLitre, fromMetric: litreToGallon, digits: 0 },
  // Норма полива: мм осадков ↔ дюймы.
  depth: { unit: 'in', toMetric: inchToMm, fromMetric: mmToInch, digits: 2 },
  precipitation: { unit: 'in/ч', toMetric: inHToMmH, fromMetric: mmHToInH, digits: 2 },
  velocity: { unit: 'ft/с', toMetric: ftToM, fromMetric: mToFt, digits: 2 },
  // Мощность в обеих системах показывается в киловаттах: у бытовых насосов
  // на постсоветском рынке паспорт всегда в кВт, перевод в л. с. только запутает.
  power: { unit: 'кВт', toMetric: (v) => v, fromMetric: (v) => v, digits: 2 },
};

export interface DisplayUnit {
  unit: string;
  digits: number | undefined;
}

/** Единица, которую видит пользователь при выбранной системе. */
export function displayUnit(
  quantity: Quantity | undefined,
  metricUnit: string,
  system: UnitSystem,
  metricDigits?: number,
): DisplayUnit {
  if (system === 'metric' || !quantity) return { unit: metricUnit, digits: metricDigits };
  const adapter = IMPERIAL[quantity];
  return { unit: adapter.unit, digits: adapter.digits ?? metricDigits };
}

/** Значение из формы → метрика для движка. */
export function toMetric(
  quantity: Quantity | undefined,
  value: number,
  system: UnitSystem,
): number {
  if (system === 'metric' || !quantity) return value;
  return IMPERIAL[quantity].toMetric(value);
}

/** Метрический результат движка → то, что показываем. */
export function fromMetric(
  quantity: Quantity | undefined,
  value: number,
  system: UnitSystem,
): number {
  if (system === 'metric' || !quantity) return value;
  return IMPERIAL[quantity].fromMetric(value);
}

/** Пояснение под формой, когда включена имперская система. */
export const IMPERIAL_NOTE =
  'Ввод и результаты — в имперских единицах, вывод формулы ниже — в метрических: ' +
  'формулы §5 определены в СИ, и пересчитанная подстановка перестала бы сходиться ' +
  'с формулой над ней.';
