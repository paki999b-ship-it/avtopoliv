/**
 * Каталоги насосов и подбор под требуемую рабочую точку (§5.11).
 *
 * Кривая ходит между процессами точками, а не коэффициентами: на графике она
 * рисуется ломаной по этим же точкам, поэтому картинка и расчёт совпадают.
 */

export type PumpType = 'surface' | 'submersible' | 'multistage' | 'booster_station';

export interface PumpCurvePointDto {
  qM3h: number;
  hM: number;
}

export interface PumpDto {
  id: number;
  brand: string;
  model: string;
  altModel: string | null;
  series: string;
  type: PumpType;
  powerKwMin: number | null;
  powerKwMax: number | null;
  powerHp: number | null;
  voltage: string;
  qMaxM3h: number;
  hMaxM: number;
  sourceFile: string;
  sourcePage: number;
  /** Кривая снята с графика, а не взята из напечатанной таблицы. */
  digitized: boolean;
  digitizedNote: string | null;
  curve: PumpCurvePointDto[];
}

export interface PumpSelectionRequest {
  /** Требуемый расход, м³/ч. */
  flowM3h: number;
  /** Требуемый напор с уже учтённым запасом, м. */
  headM: number;
  /** Статическая часть характеристики системы, м (геодезия + давление головы). */
  staticHeadM: number;
  /** Потери в расчётной точке, м — по ним калибруется характеристика системы. */
  designLossM: number;
  type?: PumpType;
}

export interface PumpMatchDto {
  pump: PumpDto;
  headAtRequiredM: number;
  marginM: number;
  marginRatio: number;
  /** Требуемый расход в долях от максимального расхода паспортной кривой. */
  flowShare: number;
  /** Пересечение кривой насоса с характеристикой системы. */
  operatingPoint: PumpCurvePointDto | null;
}

/** Сведения об источнике: какие каталоги разобраны, какие нет и почему. */
export interface PumpSourceReport {
  file: string;
  pages: number;
  pagesWithText: number;
  pumps: number;
  status: 'parsed' | 'skipped';
  reason?: string;
}

export interface PumpSelectionResult {
  /** Подходящие насосы, от минимального оправданного запаса к большему. */
  matches: PumpMatchDto[];
  /** Сколько насосов вообще есть в базе — чтобы отличить «нет данных» от «не подошли». */
  catalogSize: number;
  /** Верхняя граница запаса по напору, доля (1,3 — не выше +30 %). */
  maxOverhead: number;
  /** Нижняя граница расхода в долях от Q_max кривой (0,15 — не левее 15 %). */
  minFlowShare: number;
  sources: PumpSourceReport[];
}
