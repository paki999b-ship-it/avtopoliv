/**
 * Физические константы и инженерные пределы.
 *
 * ВНИМАНИЕ: любое значение здесь сопровождается пометкой источника.
 * Значения, требующие сверки с бумажными источниками из §8 ТЗ,
 * помечены TODO(source) и перечислены в DECISIONS.md.
 */

import type { PipeMaterial } from './types.js';

/** Ускорение свободного падения, м/с². */
export const G = 9.80665;

/** Плотность воды, кг/м³ (принято для 20 °C). */
export const WATER_DENSITY = 1000;

/** 1 бар в метрах водяного столба (§5.1 ТЗ). */
export const BAR_TO_MWC = 10.2;
/** 1 бар в psi (§5.1 ТЗ). */
export const BAR_TO_PSI = 14.5;
/** 1 бар в кПа (§5.1 ТЗ). */
export const BAR_TO_KPA = 100;

/** Удельное сопротивление меди, Ом·мм²/м (§5.12 ТЗ). */
export const COPPER_RESISTIVITY = 0.0175;

/** Коэффициент Хазена–Вильямса по материалу (§5.2 ТЗ). */
export const HAZEN_WILLIAMS_C: Record<PipeMaterial, number> = {
  pe_new: 150,
  pe_used: 140,
  pvc_new: 150,
  steel_new: 120,
  steel_old: 95,
  copper: 140,
};

export const HAZEN_WILLIAMS_C_LABEL: Record<PipeMaterial, string> = {
  pe_new: 'ПНД/ПЭ новая',
  pe_used: 'ПНД бывшая в употреблении',
  pvc_new: 'ПВХ новая',
  steel_new: 'сталь новая',
  steel_old: 'сталь старая',
  copper: 'медь',
};

/**
 * Эквивалентная шероховатость стенки, мм — для Дарси–Вейсбаха.
 * Порядковые значения для учебного сравнения методов (§5.2).
 */
export const PIPE_ROUGHNESS_MM: Record<PipeMaterial, number> = {
  pe_new: 0.007,
  pe_used: 0.05,
  pvc_new: 0.007,
  steel_new: 0.05,
  steel_old: 0.5,
  copper: 0.0015,
};

/** Скорость ударной волны, м/с (§5.13 ТЗ): ПНД 300–400, сталь 1000–1200. */
export const WAVE_SPEED_MS: Record<'pe' | 'pvc' | 'steel', { min: number; max: number }> = {
  pe: { min: 300, max: 400 },
  pvc: { min: 400, max: 600 },
  steel: { min: 1000, max: 1200 },
};

/** Целевые и предельные скорости потока, м/с (§5.3 ТЗ). */
export const VELOCITY_LIMITS = {
  targetMin: 1.0,
  targetMax: 1.5,
  hardMax: 2.0,
  suctionMax: 1.2,
} as const;

/** Правило «зона ≤ 80 % дебита источника» (§5.10, §5.16 ТЗ). */
export const SOURCE_UTILISATION = 0.8;

/** Допустимое падение напряжения на клапанном кабеле 24 В AC (§5.12 ТЗ). */
export const VALVE_CABLE = {
  nominalVoltage: 24,
  maxDropV: 2.4,
  maxDropPercent: 10,
  inrushCurrentA: { min: 0.3, max: 0.4 },
  holdingCurrentA: { min: 0.2, max: 0.25 },
} as const;

/** Ориентиры равномерности полива DU (§5.7, §4 уровень 4). */
export const DU_DEFAULTS = {
  spray: { min: 0.7, max: 0.8, typical: 0.75 },
  rotor: { min: 0.7, max: 0.8, typical: 0.75 },
  rotary_nozzle: { min: 0.75, max: 0.85, typical: 0.8 },
  drip: { min: 0.85, max: 0.9, typical: 0.87 },
} as const;

/** Отраслевые пороги приемлемости DU (§4 уровень 4). */
export const DU_THRESHOLDS = { acceptable: 0.7, poor: 0.6 } as const;

/** MAD для декоративного ландшафта (§5.9 ТЗ). */
export const MAD_LANDSCAPE_DEFAULT = 0.5;

/** Предельные давления продувки, бар (§5.15 ТЗ). */
export const BLOWOUT_PRESSURE_LIMIT_BAR = {
  pe: 3.5,
  pvc: 5.5,
  dripZone: { min: 1.5, max: 2.0 },
} as const;

/** Доля потерь напора от рабочего давления дождевателя (§5.16 ТЗ). */
export const ZONE_LOSS_BUDGET = { warn: 0.2, max: 0.25 } as const;
