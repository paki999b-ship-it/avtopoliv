import { round } from '../format.js';
import { requirePositive } from '../internal/build.js';
import { systemHeadAt } from './head.js';
import type { PumpCurvePoint, SystemCurve } from './head.js';

/**
 * Подбор насоса по кривым из загруженных каталогов (§5.11).
 *
 * ── Почему здесь ломаная, а не парабола ────────────────────────────────────
 * `fitPumpCurve` аппроксимирует кривую параболой — это нужно, когда
 * пользователь вводит две-три точки из паспорта руками. У каталожного насоса
 * точек 6–16, и они сняты с напечатанной таблицы. Аппроксимация здесь только
 * исказила бы данные: между реальными точками парабола способна «дорисовать»
 * напор, которого производитель не заявлял.
 *
 * Поэтому каталожная кривая читается как ломаная: между соседними точками —
 * линейная интерполяция, за пределами таблицы — ничего. Ровно так же она
 * рисуется на графике, поэтому картинка и число всегда совпадают.
 */

export type PumpType = 'surface' | 'submersible' | 'multistage' | 'booster_station';

export interface CatalogPump {
  id: number;
  brand: string;
  model: string;
  type: PumpType;
  powerKwMin: number | null;
  powerKwMax: number | null;
  voltage: string;
  /** Точки паспортной кривой, по возрастанию расхода. */
  curve: PumpCurvePoint[];
  /** Кривая восстановлена с графика, а не взята из таблицы. */
  digitized: boolean;
  sourceFile: string;
  sourcePage: number;
}

/**
 * Напор насоса при заданном расходе по каталожной ломаной.
 * Вне диапазона таблицы возвращает `null`: экстраполяция паспортной кривой —
 * это выдумывание характеристики, которой производитель не публиковал.
 */
export function catalogHeadAt(curve: PumpCurvePoint[], flowM3h: number): number | null {
  if (curve.length === 0) return null;
  const pts = [...curve].sort((a, b) => a.flowM3h - b.flowM3h);

  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (flowM3h < first.flowM3h || flowM3h > last.flowM3h) return null;

  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (flowM3h > b.flowM3h) continue;
    if (b.flowM3h === a.flowM3h) return b.headM;
    const t = (flowM3h - a.flowM3h) / (b.flowM3h - a.flowM3h);
    return a.headM + t * (b.headM - a.headM);
  }

  return last.headM;
}

/**
 * Верхняя граница оправданного запаса по напору.
 *
 * Насос, дающий в требуемой точке больше чем на 30 % выше нужного, не
 * «надёжнее»: он работает левее своей эффективной зоны, греется и гоняет
 * лишнее давление, которое всё равно придётся срезать редуктором. Это тот же
 * принцип «запас без избыточности», что и в подборе труб.
 */
export const PUMP_MAX_HEAD_OVERHEAD = 1.3;

/**
 * Нижняя граница расхода: доля от максимального расхода паспортной кривой.
 *
 * Одного напора для подбора мало. Промышленный насос на 100 м³/ч даёт при
 * четырёх кубометрах в час почти свой напор при нулевом расходе — формально он
 * «покрывает требуемую точку», а на деле работает у самого левого края кривой:
 * КПД около нуля, вода в корпусе греется, ресурс сгорает. Для бытовой системы
 * это заведомо неверная рекомендация, и показывать её в списке нельзя.
 *
 * Порог отсекает именно такие случаи: разумные бытовые насосы для той же точки
 * попадают в 20–65 % своего расхода, промышленные — в 4 %.
 */
export const PUMP_MIN_FLOW_SHARE = 0.15;

export interface PumpMatch {
  pump: CatalogPump;
  /** Напор насоса в требуемой точке расхода, м. */
  headAtRequiredM: number;
  /** Насколько напор выше требуемого, м. */
  marginM: number;
  /** То же в долях: 0,12 — двенадцать процентов запаса. */
  marginRatio: number;
  /** Требуемый расход в долях от максимального расхода паспортной кривой. */
  flowShare: number;
  /** Фактическая рабочая точка — пересечение с характеристикой системы. */
  operatingPoint: { flowM3h: number; headM: number } | null;
}

export interface PumpSelectionInput {
  /** Требуемый расход, м³/ч. */
  flowM3h: number;
  /** Требуемый напор с уже учтённым запасом, м. */
  headM: number;
  /** Характеристика системы — для расчёта фактической рабочей точки. */
  system?: SystemCurve;
  /** Верхняя граница запаса; по умолчанию 30 %. */
  maxOverhead?: number;
  /** Нижняя граница расхода в долях от Q_max кривой; по умолчанию 0,15. */
  minFlowShare?: number;
  /** Ограничение по типу насоса. */
  type?: PumpType;
}

/**
 * Пересечение каталожной ломаной с характеристикой системы.
 *
 * Ищется по сегментам: на каждом из них обе кривые непрерывны, а разность
 * меняет знак не более одного раза. Если пересечения нет в пределах таблицы —
 * возвращается `null`, а не край диапазона: рабочая точка за пределами
 * опубликованной кривой неизвестна.
 */
export function catalogOperatingPoint(
  curve: PumpCurvePoint[],
  system: SystemCurve,
): { flowM3h: number; headM: number } | null {
  const pts = [...curve].sort((a, b) => a.flowM3h - b.flowM3h);
  if (pts.length < 2) return null;

  const diff = (q: number): number | null => {
    const h = catalogHeadAt(pts, q);
    return h === null ? null : h - systemHeadAt(system, q);
  };

  for (let i = 1; i < pts.length; i += 1) {
    let lo = pts[i - 1]!.flowM3h;
    let hi = pts[i]!.flowM3h;
    const dLo = diff(lo);
    const dHi = diff(hi);
    if (dLo === null || dHi === null) continue;

    if (dLo === 0) return { flowM3h: round(lo, 3), headM: round(catalogHeadAt(pts, lo)!, 2) };
    if (dLo > 0 === dHi > 0) continue;

    // Знак меняется внутри сегмента — уточняем делением пополам.
    for (let k = 0; k < 60; k += 1) {
      const mid = (lo + hi) / 2;
      const dMid = diff(mid)!;
      if (dLo > 0 === dMid > 0) lo = mid;
      else hi = mid;
    }
    const q = (lo + hi) / 2;
    return { flowM3h: round(q, 3), headM: round(catalogHeadAt(pts, q)!, 2) };
  }

  return null;
}

/**
 * Подбор насосов под требуемую рабочую точку.
 *
 * Подходящим считается насос, который выполняет три условия сразу:
 *
 *  1. в требуемой точке расхода даёт напор не ниже требуемого;
 *  2. даёт не больше требуемого в `maxOverhead` раз — иначе лишнее давление
 *     всё равно придётся срезать редуктором;
 *  3. требуемый расход лежит не у левого края его кривой, то есть составляет
 *     не меньше `minFlowShare` от максимального расхода паспорта.
 *
 * Третье условие отсеивает насосы не своего класса: без него в выдачу для
 * садового участка на 4 м³/ч попадает промышленная машина на 100 м³/ч и 22 кВт,
 * формально «проходящая по напору».
 *
 * Список идёт по возрастанию запаса: первым — насос с минимальным оправданным
 * запасом.
 */
export function selectCatalogPumps(
  pumps: readonly CatalogPump[],
  input: PumpSelectionInput,
): PumpMatch[] {
  const q = requirePositive(input.flowM3h, 'Требуемый расход');
  const h = requirePositive(input.headM, 'Требуемый напор');
  const maxOverhead = input.maxOverhead ?? PUMP_MAX_HEAD_OVERHEAD;
  const minFlowShare = input.minFlowShare ?? PUMP_MIN_FLOW_SHARE;

  const matches: PumpMatch[] = [];

  for (const pump of pumps) {
    if (input.type && pump.type !== input.type) continue;

    const headAt = catalogHeadAt(pump.curve, q);
    if (headAt === null) continue;
    if (headAt < h) continue;
    if (headAt > h * maxOverhead) continue;

    // Насос не своего класса: требуемый расход у левого края его кривой.
    const curveMaxFlow = Math.max(...pump.curve.map((p) => p.flowM3h));
    const flowShare = curveMaxFlow > 0 ? q / curveMaxFlow : 0;
    if (flowShare < minFlowShare) continue;

    matches.push({
      pump,
      headAtRequiredM: round(headAt, 2),
      marginM: round(headAt - h, 2),
      marginRatio: round(headAt / h - 1, 4),
      flowShare: round(flowShare, 4),
      operatingPoint: input.system ? catalogOperatingPoint(pump.curve, input.system) : null,
    });
  }

  return matches.sort((a, b) => a.marginM - b.marginM);
}
