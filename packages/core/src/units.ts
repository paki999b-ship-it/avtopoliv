/**
 * §5.1. Конвертер единиц.
 *
 * Базовые соотношения из ТЗ:
 *   1 бар = 10,2 м вод. ст. = 14,5 psi = 100 кПа
 *   1 м³/ч = 16,67 л/мин = 4,40 GPM = 0,278 л/с
 *   1 л/м² = 1 мм осадков
 *   1 сотка = 100 м²
 *   1 дюйм = 25,4 мм, 1 in/ч = 25,4 мм/ч
 */

import { BAR_TO_KPA, BAR_TO_MWC, BAR_TO_PSI } from './constants.js';

// ── Давление ────────────────────────────────────────────────────────────────
export const barToMwc = (bar: number) => bar * BAR_TO_MWC;
export const mwcToBar = (m: number) => m / BAR_TO_MWC;
export const barToPsi = (bar: number) => bar * BAR_TO_PSI;
export const psiToBar = (psi: number) => psi / BAR_TO_PSI;
export const barToKpa = (bar: number) => bar * BAR_TO_KPA;
export const kpaToBar = (kpa: number) => kpa / BAR_TO_KPA;

// ── Расход ──────────────────────────────────────────────────────────────────
export const M3H_TO_LMIN = 1000 / 60; // 16,666…
export const M3H_TO_LS = 1 / 3.6; // 0,2777…
/** 1 US gallon = 3,785411784 л. */
export const LITRE_PER_GALLON = 3.785411784;

export const m3hToLmin = (q: number) => q * M3H_TO_LMIN;
export const lminToM3h = (q: number) => q / M3H_TO_LMIN;
export const m3hToLs = (q: number) => q * M3H_TO_LS;
export const lsToM3h = (q: number) => q / M3H_TO_LS;
export const m3hToM3s = (q: number) => q / 3600;
export const m3sToM3h = (q: number) => q * 3600;
export const m3hToLh = (q: number) => q * 1000;
export const lhToM3h = (q: number) => q / 1000;
export const m3hToGpm = (q: number) => (q * 1000) / LITRE_PER_GALLON / 60;
export const gpmToM3h = (g: number) => (g * LITRE_PER_GALLON * 60) / 1000;
export const lminToGpm = (q: number) => q / LITRE_PER_GALLON;
export const gpmToLmin = (g: number) => g * LITRE_PER_GALLON;

// ── Длина и площадь ─────────────────────────────────────────────────────────
export const MM_PER_INCH = 25.4;
export const inchToMm = (i: number) => i * MM_PER_INCH;
export const mmToInch = (mm: number) => mm / MM_PER_INCH;
export const mToFt = (m: number) => m / 0.3048;
export const ftToM = (ft: number) => ft * 0.3048;
/** 1 сотка = 100 м². */
export const sotkaToM2 = (s: number) => s * 100;
export const m2ToSotka = (m2: number) => m2 / 100;
export const m2ToSqft = (m2: number) => m2 / 0.09290304;
export const sqftToM2 = (sqft: number) => sqft * 0.09290304;

// ── Осадки и интенсивность ──────────────────────────────────────────────────
/** 1 л/м² = 1 мм. */
export const lPerM2ToMm = (l: number) => l;
export const mmToLPerM2 = (mm: number) => mm;
/** 1 in/ч = 25,4 мм/ч. */
export const inHToMmH = (inh: number) => inh * MM_PER_INCH;
export const mmHToInH = (mmh: number) => mmh / MM_PER_INCH;

// ── Объём ───────────────────────────────────────────────────────────────────
export const m3ToLitre = (m3: number) => m3 * 1000;
export const litreToM3 = (l: number) => l / 1000;
export const litreToGallon = (l: number) => l / LITRE_PER_GALLON;
export const gallonToLitre = (g: number) => g * LITRE_PER_GALLON;

// ── Температура ─────────────────────────────────────────────────────────────
export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

/**
 * Кинематическая вязкость воды, м²/с, по эмпирической аппроксимации Пуазейля:
 *   v = 1,79e-6 / (1 + 0,03368·T + 0,000221·T²)
 * При 20 °C даёт около 1,016e-6 м²/с (табличное значение 1,004e-6).
 * Используется только в расчёте по Дарси–Вейсбаху (§5.2).
 */
export function kinematicViscosity(tempC = 20): number {
  return 1.79e-6 / (1 + 0.03368 * tempC + 0.000221 * tempC * tempC);
}

/** Описание одной единицы для таблицы конвертера в UI. */
export interface UnitConversionRow {
  label: string;
  unit: string;
  value: number;
}

export type UnitQuantity =
  | 'pressure'
  | 'flow'
  | 'length'
  | 'area'
  | 'volume'
  | 'depth'
  | 'precipitation';

interface UnitDef {
  unit: string;
  label: string;
  toBase: (v: number) => number;
  fromBase: (v: number) => number;
}

const IDENTITY: Pick<UnitDef, 'toBase' | 'fromBase'> = {
  toBase: (v: number) => v,
  fromBase: (v: number) => v,
};

/**
 * Универсальный конвертер: значение + исходная единица → все родственные единицы.
 * Используется калькулятором 5.1 и переключателем метрика/имперская.
 */
const QUANTITY_TABLE: Record<UnitQuantity, UnitDef[]> = {
  pressure: [
    { unit: 'бар', label: 'бар', ...IDENTITY },
    { unit: 'м вод. ст.', label: 'метры водяного столба', toBase: mwcToBar, fromBase: barToMwc },
    { unit: 'psi', label: 'фунт-сила на квадратный дюйм', toBase: psiToBar, fromBase: barToPsi },
    { unit: 'кПа', label: 'килопаскаль', toBase: kpaToBar, fromBase: barToKpa },
    {
      unit: 'кгс/см²',
      label: 'техническая атмосфера',
      toBase: (v) => v * 0.980665,
      fromBase: (v) => v / 0.980665,
    },
  ],
  flow: [
    { unit: 'м³/ч', label: 'кубометры в час', ...IDENTITY },
    { unit: 'л/мин', label: 'литры в минуту', toBase: lminToM3h, fromBase: m3hToLmin },
    { unit: 'л/с', label: 'литры в секунду', toBase: lsToM3h, fromBase: m3hToLs },
    { unit: 'л/ч', label: 'литры в час', toBase: lhToM3h, fromBase: m3hToLh },
    { unit: 'GPM', label: 'US галлоны в минуту', toBase: gpmToM3h, fromBase: m3hToGpm },
  ],
  length: [
    { unit: 'м', label: 'метр', ...IDENTITY },
    { unit: 'мм', label: 'миллиметр', toBase: (v) => v / 1000, fromBase: (v) => v * 1000 },
    {
      unit: 'дюйм',
      label: 'дюйм',
      toBase: (v) => (v * MM_PER_INCH) / 1000,
      fromBase: (v) => (v * 1000) / MM_PER_INCH,
    },
    { unit: 'фут', label: 'фут', toBase: ftToM, fromBase: mToFt },
  ],
  area: [
    { unit: 'м²', label: 'квадратный метр', ...IDENTITY },
    { unit: 'сотка', label: 'сотка (100 м²)', toBase: sotkaToM2, fromBase: m2ToSotka },
    { unit: 'га', label: 'гектар', toBase: (v) => v * 10000, fromBase: (v) => v / 10000 },
    { unit: 'кв. фут', label: 'квадратный фут', toBase: sqftToM2, fromBase: m2ToSqft },
  ],
  volume: [
    { unit: 'л', label: 'литр', ...IDENTITY },
    { unit: 'м³', label: 'кубометр', toBase: m3ToLitre, fromBase: litreToM3 },
    { unit: 'US gal', label: 'US галлон', toBase: gallonToLitre, fromBase: litreToGallon },
  ],
  depth: [
    { unit: 'мм', label: 'миллиметры осадков', ...IDENTITY },
    { unit: 'л/м²', label: 'литры на квадратный метр', ...IDENTITY },
    { unit: 'дюйм', label: 'дюйм осадков', toBase: inchToMm, fromBase: mmToInch },
  ],
  precipitation: [
    { unit: 'мм/ч', label: 'миллиметры в час', ...IDENTITY },
    { unit: 'л/(м²·ч)', label: 'литры на квадратный метр в час', ...IDENTITY },
    { unit: 'in/ч', label: 'дюймы в час', toBase: inHToMmH, fromBase: mmHToInH },
  ],
};

export function listUnits(quantity: UnitQuantity): { unit: string; label: string }[] {
  return QUANTITY_TABLE[quantity].map(({ unit, label }) => ({ unit, label }));
}

export function convertAll(
  quantity: UnitQuantity,
  value: number,
  fromUnit: string,
): UnitConversionRow[] {
  const table = QUANTITY_TABLE[quantity];
  const from = table.find((r) => r.unit === fromUnit);
  if (!from) throw new Error(`Неизвестная единица «${fromUnit}» для величины «${quantity}»`);
  const base = from.toBase(value);
  return table.map((r) => ({ label: r.label, unit: r.unit, value: r.fromBase(base) }));
}

export function convert(
  quantity: UnitQuantity,
  value: number,
  fromUnit: string,
  toUnit: string,
): number {
  const row = convertAll(quantity, value, fromUnit).find((r) => r.unit === toUnit);
  if (!row) throw new Error(`Неизвестная единица «${toUnit}» для величины «${quantity}»`);
  return row.value;
}
