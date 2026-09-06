import { CALCULATORS } from '@irrigo/core';
import type { CalculatorKey, CalculatorMeta } from '@irrigo/core';
import type { CalcDefinition } from './types.js';
import { unitsCalculator } from './definitions/units.js';
import {
  frictionCalculator,
  minorLossesCalculator,
  pipeSizingCalculator,
  velocityCalculator,
  waterHammerCalculator,
} from './definitions/hydraulics.js';
import {
  irrigationRequirementCalculator,
  precipitationRateCalculator,
  runTimeCalculator,
  soilWaterCalculator,
  waterBalanceCalculator,
} from './definitions/agronomy.js';
import { dripLineCalculator, pumpHeadCalculator } from './definitions/equipment.js';
import { valveCableCalculator } from './definitions/electrical.js';
import { blowoutCalculator, zoneCheckCalculator } from './definitions/operation.js';

/**
 * Реестр форм калькуляторов.
 *
 * Состав раздела задаёт движок (`CALCULATORS` из `@irrigo/core`), а этот файл
 * лишь сопоставляет каждому ключу описание формы. Если у калькулятора из
 * реестра движка нет формы, `assertComplete` скажет об этом на тесте, а не
 * оставит в меню мёртвый пункт.
 */

const DEFINITIONS: CalcDefinition[] = [
  unitsCalculator,
  frictionCalculator,
  velocityCalculator,
  pipeSizingCalculator,
  minorLossesCalculator,
  precipitationRateCalculator,
  irrigationRequirementCalculator,
  runTimeCalculator,
  soilWaterCalculator,
  waterBalanceCalculator,
  pumpHeadCalculator,
  valveCableCalculator,
  waterHammerCalculator,
  dripLineCalculator,
  blowoutCalculator,
  zoneCheckCalculator,
];

const BY_KEY = new Map<CalculatorKey, CalcDefinition>(DEFINITIONS.map((d) => [d.key, d]));

export function calculatorDefinition(key: CalculatorKey): CalcDefinition | undefined {
  return BY_KEY.get(key);
}

export interface CalculatorEntry {
  meta: CalculatorMeta;
  definition: CalcDefinition;
}

/** Калькуляторы в порядке реестра движка — он же порядок §5 ТЗ. */
export function calculatorEntries(): CalculatorEntry[] {
  return CALCULATORS.flatMap((meta) => {
    const definition = BY_KEY.get(meta.key);
    return definition ? [{ meta, definition }] : [];
  });
}

/** Группы для меню раздела. */
export const GROUP_TITLES: Record<CalculatorMeta['group'], string> = {
  units: 'Единицы',
  hydraulics: 'Гидравлика',
  agronomy: 'Вода и растения',
  equipment: 'Оборудование',
  electrical: 'Электрика',
  operation: 'Эксплуатация',
};

/** Ключи из реестра движка, для которых формы ещё нет. Должен быть пустым. */
export function missingDefinitions(): CalculatorKey[] {
  return CALCULATORS.filter((meta) => !BY_KEY.has(meta.key)).map((meta) => meta.key);
}

export { DEFINITIONS as CALCULATOR_DEFINITIONS };
