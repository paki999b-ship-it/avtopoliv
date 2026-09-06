/**
 * §5.4. Подбор диаметра трубы.
 *
 * Вход: расход, материал/стандарт, целевая скорость.
 * Выход: рекомендуемый диаметр, фактическая скорость, потери на 100 м,
 * ближайшие варианты вверх и вниз с их показателями.
 */

import { VELOCITY_LIMITS } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requirePositive } from '../internal/build.js';
import type { CalcResult } from '../types.js';
import { PIPE_CATALOG, pipesByStandard, type PipeSpec, type PipeStandard } from '../data/pipes.js';
import { frictionLoss } from './friction.js';
import { velocityMs } from './velocity.js';
import { m3hToM3s } from '../units.js';

export interface PipeOption {
  key: string;
  standard: PipeStandard;
  odMm: number;
  idMm: number;
  velocityMs: number;
  headLossPer100mM: number;
  /** Потери на заданной длине, м вод. ст. */
  headLossM: number;
  withinTarget: boolean;
  withinHardLimit: boolean;
}

export interface PipeSizingInput {
  flowM3h: number;
  /** Стандарт, из которого подбираем. По умолчанию — PE100 SDR11 (ПНД PN16). */
  standard?: PipeStandard;
  /** Целевая скорость, м/с. По умолчанию 1,5 (верх целевого диапазона). */
  targetVelocityMs?: number;
  /** Длина участка для расчёта абсолютных потерь, м. По умолчанию 100. */
  lengthM?: number;
  /** Всасывающая линия: предел 1,2 м/с. */
  role?: 'main' | 'lateral' | 'suction';
}

export interface PipeSizingValues {
  /** Теоретический диаметр под целевую скорость, мм (внутренний). */
  requiredIdMm: number;
  recommended: PipeOption | null;
  smaller: PipeOption | null;
  larger: PipeOption | null;
  /** Все варианты сортамента с показателями — для таблицы в UI. */
  options: PipeOption[];
}

function evaluate(pipe: PipeSpec, flowM3h: number, lengthM: number, limit: number): PipeOption {
  const v = velocityMs(m3hToM3s(flowM3h), pipe.idMm / 1000);
  const loss = frictionLoss({
    flowM3h,
    innerDiameterMm: pipe.idMm,
    lengthM,
    material: pipe.material,
  });
  return {
    key: pipe.key,
    standard: pipe.standard,
    odMm: pipe.odMm,
    idMm: pipe.idMm,
    velocityMs: round(v, 2),
    headLossPer100mM: loss.values.headLossPer100mM,
    headLossM: loss.values.headLossM,
    withinTarget: v >= VELOCITY_LIMITS.targetMin && v <= VELOCITY_LIMITS.targetMax,
    withinHardLimit: v <= limit,
  };
}

export function selectPipeDiameter(input: PipeSizingInput): CalcResult<PipeSizingValues> {
  const flowM3h = requirePositive(input.flowM3h, 'Расход');
  const standard: PipeStandard = input.standard ?? 'PE100 SDR11';
  const role = input.role ?? 'main';
  const limit = role === 'suction' ? VELOCITY_LIMITS.suctionMax : VELOCITY_LIMITS.hardMax;
  const target = requirePositive(
    input.targetVelocityMs ?? (role === 'suction' ? 1.0 : VELOCITY_LIMITS.targetMax),
    'Целевая скорость',
  );
  const lengthM = input.lengthM ?? 100;

  const log = new StepLog();
  const q = m3hToM3s(flowM3h);
  const requiredIdM = Math.sqrt((4 * q) / (Math.PI * target));
  const requiredIdMm = requiredIdM * 1000;

  log.step(
    'Требуемый внутренний диаметр',
    'D = √( 4Q / (π · v_цел) )',
    `√( 4 · ${fmt(q, 5)} / (3,1416 · ${fmt(target, 2)}) )`,
    `${fmt(requiredIdMm, 1)} мм`,
  );

  const candidates = pipesByStandard(standard);
  if (candidates.length === 0) {
    throw new Error(`Сортамент «${standard}» пуст`);
  }
  const options = candidates.map((p) => evaluate(p, flowM3h, lengthM, limit));

  // Рекомендуем ближайший диаметр, который не выходит за жёсткий предел скорости.
  const recommended =
    options.find((o) => o.idMm >= requiredIdMm && o.withinHardLimit) ??
    options.filter((o) => o.withinHardLimit).at(0) ??
    options.at(-1) ??
    null;

  const idx = recommended ? options.findIndex((o) => o.key === recommended.key) : -1;
  const smaller = idx > 0 ? (options[idx - 1] ?? null) : null;
  const larger = idx >= 0 && idx < options.length - 1 ? (options[idx + 1] ?? null) : null;

  if (recommended) {
    log.step(
      'Ближайший диаметр из сортамента',
      'берём первый, у которого D_вн ≥ требуемого',
      `${standard}, наружный ${fmt(recommended.odMm, 0)} мм, внутренний ${fmt(recommended.idMm, 1)} мм`,
      `v = ${fmt(recommended.velocityMs, 2)} м/с, потери ${fmt(recommended.headLossPer100mM, 2)} м/100 м`,
    );

    if (!recommended.withinHardLimit) {
      log.error(
        'no-pipe-within-limit',
        `Даже самый крупный диаметр сортамента даёт скорость ${fmt(recommended.velocityMs, 2)} м/с`,
        'Расход слишком велик для этого ряда труб.',
        'Возьмите более крупный стандарт, разделите поток на две нитки или уменьшите расход зоны.',
      );
    } else if (!recommended.withinTarget) {
      log.warn(
        'velocity-outside-target',
        `Скорость в рекомендованной трубе ${fmt(recommended.velocityMs, 2)} м/с вне диапазона 1,0–1,5 м/с`,
        'Труба выбрана по ближайшему типоразмеру, идеального попадания в диапазон в стандартном ряду часто нет.',
        larger
          ? `Соседний вариант вверх — ${fmt(larger.odMm, 0)} мм: v = ${fmt(larger.velocityMs, 2)} м/с.`
          : undefined,
      );
    }

    if (smaller) {
      log.info(
        'option-smaller',
        `Вариант дешевле: ${fmt(smaller.odMm, 0)} мм — v = ${fmt(smaller.velocityMs, 2)} м/с, потери ${fmt(smaller.headLossPer100mM, 2)} м/100 м`,
        smaller.withinHardLimit
          ? undefined
          : 'Этот диаметр выходит за предел 2,0 м/с — брать нельзя.',
      );
    }
    if (larger) {
      log.info(
        'option-larger',
        `Вариант с запасом: ${fmt(larger.odMm, 0)} мм — v = ${fmt(larger.velocityMs, 2)} м/с, потери ${fmt(larger.headLossPer100mM, 2)} м/100 м`,
        'Разница в цене трубы обычно окупается снижением требуемого напора насоса.',
      );
    }
  }

  log.info(
    'catalog-source',
    'Сортамент приведён по номинальному ряду стандарта',
    'Фактический внутренний диаметр конкретной партии может отличаться.',
    'Перед закупкой сверьте толщину стенки с паспортом на трубу.',
  );

  return {
    values: {
      requiredIdMm: round(requiredIdMm, 1),
      recommended,
      smaller,
      larger,
      options,
    },
    steps: log.steps,
    notes: log.notes,
  };
}

export { PIPE_CATALOG };
