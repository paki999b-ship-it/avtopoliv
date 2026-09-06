/**
 * §5.14. Капельная линия.
 *
 * Вход: расход капельницы, шаг, длина линии, диаметр, уклон, тип
 * (компенсированная / некомпенсированная).
 * Выход: расход линии, потери, разброс расхода между первой и последней
 * капельницей, оценка равномерности.
 *
 * Критерии ТЗ:
 *  - некомпенсированные: разброс расхода по линии не более 10 %,
 *    по блоку (линии + распределитель) — не более 20 %;
 *  - компенсированные держат расход в своём рабочем диапазоне давления;
 *    диапазон берётся из паспорта, а не «по опыту».
 *
 * Потери по длине линии с равномерным раздачей воды считаются с поправкой
 * Кристиансена: hf_линии = F · hf_полного расхода по всей длине.
 */

import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange, requireNonNegative } from '../internal/build.js';
import type { CalcResult } from '../types.js';
import { hazenWilliamsLossM, HW_FLOW_EXPONENT } from '../hydraulics/friction.js';
import { barToMwc, mwcToBar, m3hToM3s } from '../units.js';

/** Порог разброса расхода по линии (ТЗ §5.14). */
export const DRIP_LINE_VARIATION_LIMIT = 0.1;
/** Порог разброса по блоку (ТЗ §5.14). */
export const DRIP_BLOCK_VARIATION_LIMIT = 0.2;

/**
 * Поправка Кристиансена для трубы с равномерными водовыпусками:
 *   F = 1/(m+1) + 1/(2N) + √(m−1)/(6N²),  m = 1,852
 */
export function christiansenF(outlets: number, m = HW_FLOW_EXPONENT): number {
  if (outlets < 1) throw new Error('Число водовыпусков должно быть не меньше 1');
  return 1 / (m + 1) + 1 / (2 * outlets) + Math.sqrt(m - 1) / (6 * outlets ** 2);
}

export interface DripLineInput {
  /** Номинальный расход капельницы, л/ч. */
  emitterFlowLph: number;
  /** Шаг капельниц, м. */
  emitterSpacingM: number;
  /** Длина линии, м. */
  lineLengthM: number;
  /** Внутренний диаметр трубки, мм (для 16 мм линии обычно 13,6–14,2). */
  innerDiameterMm: number;
  /** Давление на входе в линию, бар. */
  inletPressureBar: number;
  /** Номинальное давление капельницы (при котором заявлен расход), бар. */
  nominalPressureBar?: number;
  /** Уклон линии, %: положительный — вверх, отрицательный — вниз по потоку. */
  slopePercent?: number;
  compensating?: boolean;
  /** Рабочий диапазон компенсированной капельницы из паспорта, бар. */
  compensationRangeBar?: { min: number; max: number };
  /** Показатель степени зависимости расхода от давления (обычно 0,5). */
  emitterExponent?: number;
  /** Коэффициент Хазена–Вильямса трубки. По умолчанию 150. */
  hazenWilliamsC?: number;
}

export interface DripLineValues {
  emitterCount: number;
  lineFlowLph: number;
  lineFlowM3h: number;
  christiansenF: number;
  frictionLossM: number;
  frictionLossBar: number;
  elevationChangeM: number;
  inletPressureBar: number;
  endPressureBar: number;
  minPressureBar: number;
  maxPressureBar: number;
  flowFirstLph: number;
  flowLastLph: number;
  /** Разброс расхода по линии, доля. */
  flowVariation: number;
  /** Оценка равномерности EU по линии, доля. */
  emissionUniformity: number;
  acceptable: boolean;
  /** Максимальная длина линии при заданных условиях, м. */
  maxLineLengthM: number;
}

function pressureAlongLine(input: {
  lengthM: number;
  emitterSpacingM: number;
  emitterFlowLph: number;
  innerDiameterMm: number;
  slopePercent: number;
  c: number;
}): { count: number; flowLph: number; f: number; lossM: number; elevM: number } {
  const count = Math.max(1, Math.floor(input.lengthM / input.emitterSpacingM));
  const flowLph = count * input.emitterFlowLph;
  const f = christiansenF(count);
  const full = hazenWilliamsLossM(
    m3hToM3s(flowLph / 1000),
    input.innerDiameterMm / 1000,
    input.lengthM,
    input.c,
  );
  // Уклон вверх по потоку отнимает напор, вниз — добавляет.
  const elevM = (-input.slopePercent / 100) * input.lengthM;
  return { count, flowLph, f, lossM: f * full, elevM };
}

export function dripLine(input: DripLineInput): CalcResult<DripLineValues> {
  const qE = requirePositive(input.emitterFlowLph, 'Расход капельницы');
  const spacing = requirePositive(input.emitterSpacingM, 'Шаг капельниц');
  const length = requirePositive(input.lineLengthM, 'Длина линии');
  const dMm = requirePositive(input.innerDiameterMm, 'Внутренний диаметр трубки');
  const inlet = requirePositive(input.inletPressureBar, 'Давление на входе');
  const nominal = requirePositive(input.nominalPressureBar ?? 1.0, 'Номинальное давление');
  const slope = input.slopePercent ?? 0;
  const x = requireRange(input.emitterExponent ?? 0.5, 0.1, 1, 'Показатель степени капельницы');
  const c = requirePositive(input.hazenWilliamsC ?? 150, 'Коэффициент C');
  const compensating = input.compensating ?? false;

  const log = new StepLog();
  const line = pressureAlongLine({
    lengthM: length,
    emitterSpacingM: spacing,
    emitterFlowLph: qE,
    innerDiameterMm: dMm,
    slopePercent: slope,
    c,
  });

  log.step(
    'Число капельниц на линии',
    'N = целая часть( L / шаг )',
    `${fmt(length, 1)} / ${fmt(spacing, 2)}`,
    `${line.count} шт.`,
  );
  log.step(
    'Расход линии',
    'Q_линии = N · q_капельницы',
    `${line.count} · ${fmt(qE, 1)}`,
    `${fmt(line.flowLph, 0)} л/ч (${fmt(line.flowLph / 1000, 3)} м³/ч)`,
  );
  log.step(
    'Поправка Кристиансена',
    'F = 1/(m+1) + 1/(2N) + √(m−1)/(6N²),  m = 1,852',
    `N = ${line.count}`,
    `F = ${fmt(line.f, 3)}`,
  );
  log.step(
    'Потери напора по линии',
    'hf_линии = F · hf(полный расход по всей длине)',
    `${fmt(line.f, 3)} · ${fmt(line.lossM / line.f, 2)}`,
    `${fmt(line.lossM, 2)} м (${fmt(mwcToBar(line.lossM), 3)} бар)`,
  );
  if (slope !== 0) {
    log.step(
      'Изменение напора от уклона',
      'Δh = −уклон [%] / 100 · L',
      `−${fmt(slope, 1)} / 100 · ${fmt(length, 1)}`,
      `${fmt(line.elevM, 2)} м`,
    );
  }

  const inletM = barToMwc(inlet);
  const endM = inletM - line.lossM + line.elevM;
  const endBar = mwcToBar(endM);
  const minBar = Math.min(inlet, endBar);
  const maxBar = Math.max(inlet, endBar);

  log.step(
    'Давление в конце линии',
    'P_конца = P_входа − hf_линии + Δh_уклона',
    `${fmt(inletM, 2)} − ${fmt(line.lossM, 2)} + ${fmt(line.elevM, 2)}`,
    `${fmt(endM, 2)} м = ${fmt(endBar, 2)} бар`,
  );

  let qFirst: number;
  let qLast: number;
  let variation: number;

  if (compensating) {
    const range = input.compensationRangeBar;
    qFirst = qE;
    qLast = qE;
    variation = 0;
    if (range) {
      const inRange = minBar >= range.min && maxBar <= range.max;
      log.step(
        'Проверка диапазона компенсации',
        'P_мин и P_макс должны лежать в паспортном диапазоне',
        `${fmt(minBar, 2)}…${fmt(maxBar, 2)} бар против ${fmt(range.min, 2)}…${fmt(range.max, 2)} бар`,
        inRange ? 'в диапазоне' : 'вне диапазона',
      );
      if (!inRange) {
        variation = 1 - (minBar / maxBar) ** x;
        qFirst = qE * (Math.min(maxBar, range.max) / nominal) ** 0;
        qLast = qE * (minBar < range.min ? (minBar / range.min) ** x : 1);
        log.error(
          'compensation-out-of-range',
          `Давление ${fmt(minBar, 2)}…${fmt(maxBar, 2)} бар выходит за паспортный диапазон компенсации`,
          minBar < range.min
            ? 'Ниже нижней границы компенсированная капельница работает как обычная: расход падает вместе с давлением, и весь смысл компенсации теряется.'
            : 'Выше верхней границы мембрана перегружена — ресурс капельницы резко сокращается.',
          'Укоротите линию, поднимите давление на входе или поставьте регулятор давления на гребёнке.',
        );
      } else {
        log.info(
          'compensation-ok',
          'Линия целиком в диапазоне компенсации — расход одинаков по всей длине',
          'Именно поэтому компенсированные капельницы допускают заметно более длинные линии и работу на склоне.',
        );
      }
    } else {
      log.warn(
        'compensation-range-missing',
        'Не задан паспортный диапазон компенсации',
        'Без него нельзя проверить, работает ли компенсация на самом деле: за пределами диапазона капельница ведёт себя как обычная.',
        'Возьмите диапазон из техкарты производителя, а не из общих соображений.',
      );
    }
  } else {
    qFirst = qE * (maxBar / nominal) ** x;
    qLast = qE * (minBar / nominal) ** x;
    variation = 1 - (minBar / maxBar) ** x;
    log.step(
      'Расход крайних капельниц',
      'q = q_ном · (P / P_ном)^x,  x ≈ 0,5',
      `первая: ${fmt(qE, 1)} · (${fmt(maxBar, 2)}/${fmt(nominal, 2)})^${fmt(x, 2)}; последняя: ${fmt(qE, 1)} · (${fmt(minBar, 2)}/${fmt(nominal, 2)})^${fmt(x, 2)}`,
      `${fmt(qFirst, 2)} и ${fmt(qLast, 2)} л/ч`,
    );
    log.step(
      'Разброс расхода по линии',
      'q_var = 1 − (P_мин / P_макс)^x',
      `1 − (${fmt(minBar, 2)} / ${fmt(maxBar, 2)})^${fmt(x, 2)}`,
      `${fmt(variation * 100, 1)} %`,
    );
  }

  const acceptable = variation <= DRIP_LINE_VARIATION_LIMIT;
  const eu = qFirst > 0 ? qLast / qFirst : 1;

  if (!compensating) {
    if (!acceptable) {
      log.error(
        'drip-variation-high',
        `Разброс расхода ${fmt(variation * 100, 1)} % превышает предел 10 %`,
        'Начало линии заливает, конец сохнет. На грядке это видно уже через две недели: первые растения в жирной грязи, последние вянут.',
        'Укоротите линию, подайте воду в середину (подключение «в тройник»), возьмите трубку большего диаметра или перейдите на компенсированные капельницы.',
      );
    } else {
      log.info(
        'drip-variation-ok',
        `Разброс расхода ${fmt(variation * 100, 1)} % — в пределах 10 %`,
        'По блоку (линии плюс распределитель) допускается до 20 % — проверьте и его.',
      );
    }
  }

  // Максимальная длина: наращиваем длину, пока разброс не выйдет за 10 %.
  let maxLen = length;
  if (!compensating) {
    maxLen = 0;
    for (let l = spacing; l <= 400; l += spacing) {
      const t = pressureAlongLine({
        lengthM: l,
        emitterSpacingM: spacing,
        emitterFlowLph: qE,
        innerDiameterMm: dMm,
        slopePercent: slope,
        c,
      });
      const eM = inletM - t.lossM + t.elevM;
      if (eM <= 0) break;
      const eB = mwcToBar(eM);
      const mn = Math.min(inlet, eB);
      const mx = Math.max(inlet, eB);
      const v = 1 - (mn / mx) ** x;
      if (v > DRIP_LINE_VARIATION_LIMIT) break;
      maxLen = l;
    }
    log.step(
      'Максимальная длина линии',
      'наращиваем длину, пока разброс не превысит 10 %',
      `шаг ${fmt(spacing, 2)} м, вход ${fmt(inlet, 2)} бар, уклон ${fmt(slope, 1)} %`,
      `${fmt(maxLen, 1)} м`,
    );
  }

  if (endM <= 0) {
    log.error(
      'drip-no-pressure',
      'Давления не хватает до конца линии',
      'Последние капельницы просто не работают — вода до них не доходит.',
      'Сократите линию или поднимите давление на входе.',
    );
  }

  log.info(
    'drip-filtration',
    'Капельному поливу обязательно нужен фильтр',
    'Отверстие капельницы — доли миллиметра. Вода из скважины с железом забивает линию за сезон, и промыть её уже нельзя.',
    'Для капельного полива берите фильтрацию мельче, чем для дождевателей, и промывайте картридж по регламенту. Обязателен промывочный клапан в конце линии.',
  );

  return {
    values: {
      emitterCount: line.count,
      lineFlowLph: round(line.flowLph, 1),
      lineFlowM3h: round(line.flowLph / 1000, 4),
      christiansenF: round(line.f, 4),
      frictionLossM: round(line.lossM, 3),
      frictionLossBar: round(mwcToBar(line.lossM), 4),
      elevationChangeM: round(line.elevM, 2),
      inletPressureBar: round(inlet, 3),
      endPressureBar: round(endBar, 3),
      minPressureBar: round(minBar, 3),
      maxPressureBar: round(maxBar, 3),
      flowFirstLph: round(qFirst, 2),
      flowLastLph: round(qLast, 2),
      flowVariation: round(variation, 4),
      emissionUniformity: round(eu, 4),
      acceptable,
      maxLineLengthM: round(maxLen, 1),
    },
    steps: log.steps,
    notes: log.notes,
  };
}

export interface DripZonePrInput {
  /** Суммарный расход капельной зоны, л/ч. */
  totalFlowLph: number;
  /** Площадь посадок, м². */
  plantedAreaM2: number;
}

/** §5.14: PR капельной зоны в мм/ч по площади посадок. */
export function dripZonePrecipitationRate(
  input: DripZonePrInput,
): CalcResult<{ precipitationRateMmH: number }> {
  const q = requirePositive(input.totalFlowLph, 'Расход зоны');
  const a = requirePositive(input.plantedAreaM2, 'Площадь посадок');
  const log = new StepLog();
  const pr = q / a;
  log.step(
    'Интенсивность капельной зоны',
    'PR = Q [л/ч] / A [м²]',
    `${fmt(q, 0)} / ${fmt(a, 1)}`,
    `${fmt(pr, 1)} мм/ч`,
  );
  log.info(
    'drip-pr-meaning',
    'У капельной зоны интенсивность считается по площади посадок, а не по площади участка',
    'Капля смачивает только зону вокруг эмиттера. Если считать по всей площади, время полива получится завышенным в разы.',
  );
  requireNonNegative(pr, 'PR');
  return { values: { precipitationRateMmH: round(pr, 2) }, steps: log.steps, notes: log.notes };
}
