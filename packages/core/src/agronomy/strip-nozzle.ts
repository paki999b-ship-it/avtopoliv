import { fmt, round } from '../format.js';
import { StepLog, requirePositive } from '../internal/build.js';
import type { CalcResult } from '../types.js';

/**
 * §5.6, режим «полосовая форсунка».
 *
 * Полосовая форсунка (strip pattern nozzle) поливает прямоугольник, а не
 * сектор круга. Поэтому стандартный расчёт интенсивности через площадь
 * сектора и шаг раскладки к ней неприменим: площадь берётся прямо из
 * технического листа — ширина × длина полосы при заданном давлении.
 *
 *   PR (мм/ч) = q (л/ч) / (ширина_м × длина_м)
 *
 * Контрольный пример (Hunter SS-530 при 2,1 бар): 5,0 л/мин = 300 л/ч,
 * полоса 1,5 × 9,1 м = 13,65 м² → 300 / 13,65 ≈ 22 мм/ч.
 */

export interface StripNozzleInput {
  /** Расход форсунки, л/ч. */
  flowLph: number;
  /** Ширина полосы, м. */
  widthM: number;
  /** Длина полосы, м. */
  lengthM: number;
}

export interface StripNozzleValues {
  /** Площадь политой полосы, м². */
  wettedAreaM2: number;
  precipitationRateMmH: number;
  /** Расход на метр длины полосы, л/ч·м — по нему полосовые согласуются между собой. */
  flowPerMetreLphM: number;
}

/**
 * Почему полосовые нельзя мешать с веерными и роторными соплами в одной зоне:
 * у них другая геометрия полива и, как следствие, другая интенсивность.
 * Это тот же случай, что и «роторы со спреями» (§11 п.2 ТЗ). Между собой
 * полосовые сочетаются: у семейства одинаковый расход на метр полосы, поэтому
 * угловые, боковые и центральная модели дают согласованную интенсивность.
 */
export const STRIP_MIXING_WARNING =
  'Полосовые форсунки не согласуются по интенсивности с веерными и роторными соплами: ' +
  'в одной зоне их с ними не ставят. Между собой полосовые сочетаются — ' +
  'у них одинаковый расход на метр полосы.';

export function stripNozzlePrecipitationRate(
  input: StripNozzleInput,
): CalcResult<StripNozzleValues> {
  const flow = requirePositive(input.flowLph, 'Расход форсунки');
  const width = requirePositive(input.widthM, 'Ширина полосы');
  const length = requirePositive(input.lengthM, 'Длина полосы');

  const log = new StepLog();

  const area = width * length;
  log.step(
    'Площадь полосы',
    'A = ширина × длина',
    `${fmt(width, 2)} × ${fmt(length, 2)}`,
    `${fmt(area, 2)} м²`,
  );

  const pr = flow / area;
  log.step(
    'Интенсивность дождя',
    'PR = q / A',
    `${fmt(flow, 1)} / ${fmt(area, 2)}`,
    `${fmt(pr, 1)} мм/ч`,
  );

  log.info(
    'strip-not-matched',
    STRIP_MIXING_WARNING,
    'Полоса — это прямоугольник, а не сектор круга: площадь на голову у полосовой и у веерной форсунки складывается по-разному.',
    'Выделить полосовые форсунки в отдельную зону; внутри зоны комбинировать только полосовые модели.',
  );

  return {
    values: {
      wettedAreaM2: round(area, 2),
      precipitationRateMmH: round(pr, 1),
      flowPerMetreLphM: round(flow / length, 1),
    },
    steps: log.steps,
    notes: log.notes,
  };
}
