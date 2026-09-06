/**
 * §5.9. Норма за один полив по запасу влаги и интервал между поливами.
 *
 *   Норма [мм] = глубина корневой зоны [м] · влагоёмкость [мм/м] · MAD
 *   Интервал [сут] = Норма / суточная потребность нетто
 *
 * MAD (management allowed depletion) для декоративного ландшафта — обычно 0,5.
 * Подтверждено: UC ANR, «Landscape Irrigation System Evaluation and Management»
 * (публикация 80223, Appendix E): «For many landscape plants, this allowable
 * soil moisture depletion is about 50 percent of the available soil moisture».
 *
 * Глубина промачивания: газон 15–20 см, кустарники 30–40 см, деревья 50–80 см.
 *
 * ПОПРАВКА MAD НА ЖАРУ (FAO Irrigation and Drainage Paper 56, гл. 8):
 *   p = p_табл + 0,04 · (5 − ETc),  0,1 ≤ p ≤ 0,8,  ETc в мм/сут
 * Смысл: в жару растение расходует запас быстрее, чем корни успевают его
 * добирать, поэтому поливать надо раньше — допустимое истощение снижается.
 * В прохладную погоду, наоборот, можно дать почве просохнуть сильнее.
 */

import { MAD_LANDSCAPE_DEFAULT } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange } from '../internal/build.js';
import type { CalcResult } from '../types.js';

export interface SoilWaterInput {
  /** Глубина корневой зоны, м. */
  rootDepthM: number;
  /** Доступная влага почвы, мм на метр глубины. */
  awcMmPerM: number;
  /** Допустимое истощение запаса, доля. По умолчанию 0,5. */
  mad?: number;
  /** Суточная потребность нетто, мм/сут — для расчёта интервала. */
  dailyNetDemandMmDay?: number;
  /** Равномерность полива — чтобы сразу дать норму брутто. */
  du?: number;
  /**
   * Фактическая ETc, мм/сут. Если задана, MAD корректируется по FAO-56:
   * p = p_табл + 0,04 · (5 − ETc), с ограничением 0,1…0,8.
   */
  etcMmDay?: number;
}

export interface SoilWaterValues {
  /** MAD до поправки на ETc. */
  madBase: number;
  /** Применялась ли поправка FAO-56 на ETc. */
  madAdjusted: boolean;
  /** Полный запас доступной влаги в корневой зоне, мм. */
  totalAvailableMm: number;
  /** Норма за один полив (нетто), мм. */
  netDepthMm: number;
  /** Норма за один полив (брутто), мм — если задан DU. */
  grossDepthMm: number | null;
  mad: number;
  /** Интервал между поливами, суток. */
  intervalDays: number | null;
}

export function soilWaterHoldingNorm(input: SoilWaterInput): CalcResult<SoilWaterValues> {
  const depth = requireRange(input.rootDepthM, 0.05, 3, 'Глубина корневой зоны');
  const awc = requirePositive(input.awcMmPerM, 'Влагоёмкость');
  const madBase = requireRange(input.mad ?? MAD_LANDSCAPE_DEFAULT, 0.1, 0.9, 'MAD');

  const log = new StepLog();

  // Поправка FAO-56 на интенсивность водопотребления.
  let mad = madBase;
  let madAdjusted = false;
  if (input.etcMmDay !== undefined) {
    const etc = requirePositive(input.etcMmDay, 'ETc');
    mad = Math.min(0.8, Math.max(0.1, madBase + 0.04 * (5 - etc)));
    madAdjusted = true;
    log.step(
      'Поправка MAD на водопотребление (FAO-56)',
      'p = p_табл + 0,04 · (5 − ETc),  0,1 ≤ p ≤ 0,8',
      `${fmt(madBase, 2)} + 0,04 · (5 − ${fmt(etc, 1)})`,
      `MAD = ${fmt(mad, 2)}`,
    );
    if (etc > 5) {
      log.info(
        'mad-hot-weather',
        `В жару (ETc ${fmt(etc, 1)} мм/сут) допустимое истощение снижено до ${fmt(mad, 2)}`,
        'Растение расходует запас быстрее, чем корни успевают его добирать: ждать прежнего процента истощения уже нельзя.',
        'Сократите интервал между поливами, а не увеличивайте норму за полив.',
      );
    }
  }

  const total = depth * awc;
  const net = total * mad;

  log.step(
    'Запас доступной влаги в корневой зоне',
    'W = h_корней · AWC',
    `${fmt(depth, 2)} · ${fmt(awc, 0)}`,
    `${fmt(total, 1)} мм`,
  );
  log.step(
    'Норма за один полив (нетто)',
    'Норма = W · MAD',
    `${fmt(total, 1)} · ${fmt(mad, 2)}`,
    `${fmt(net, 1)} мм`,
  );

  let gross: number | null = null;
  if (input.du !== undefined) {
    const du = requireRange(input.du, 0.2, 1, 'DU');
    gross = net / du;
    log.step(
      'Норма за один полив (брутто)',
      'Брутто = Нетто / DU',
      `${fmt(net, 1)} / ${fmt(du, 2)}`,
      `${fmt(gross, 1)} мм`,
    );
  }

  let interval: number | null = null;
  if (input.dailyNetDemandMmDay !== undefined) {
    const daily = requirePositive(input.dailyNetDemandMmDay, 'Суточная потребность');
    interval = net / daily;
    log.step(
      'Интервал между поливами',
      'Интервал = Норма_нетто / суточная потребность',
      `${fmt(net, 1)} / ${fmt(daily, 1)}`,
      `${fmt(interval, 1)} сут`,
    );

    if (interval < 1) {
      log.warn(
        'interval-under-day',
        `Расчётный интервал ${fmt(interval, 1)} сут — меньше суток`,
        'Корневая зона физически не удерживает суточную потребность: обычно это песок, мелкие корни или экстремальная жара.',
        'Поливайте дважды в сутки или увеличьте глубину промачивания, если она искусственно занижена.',
      );
    } else if (interval > 14) {
      log.info(
        'interval-long',
        `Интервал ${fmt(interval, 0)} сут — очень редкий полив`,
        'Для деревьев на тяжёлой почве это нормально, для газона — признак завышенной глубины корневой зоны.',
      );
    }
  }

  log.info(
    'mad-meaning',
    `MAD = ${fmt(mad, 2)}: поливаем, когда израсходовано ${fmt(mad * 100, 0)} % доступной влаги`,
    'Ждать полного истощения нельзя — растение начинает страдать задолго до того, как почва отдаст всю доступную воду. Для декоративного ландшафта отраслевой ориентир — 0,5.',
    'Для газона на песке берут MAD ближе к 0,4, для деревьев на суглинке — до 0,6.',
  );
  log.info(
    'deep-and-rare',
    'Поливать реже и глубже выгоднее, чем каждый день понемногу',
    'Частый поверхностный полив держит корни в верхних 5 см: растение теряет засухоустойчивость и погибает при первом же сбое системы.',
  );

  return {
    values: {
      totalAvailableMm: round(total, 2),
      netDepthMm: round(net, 2),
      grossDepthMm: gross === null ? null : round(gross, 2),
      mad: round(mad, 2),
      madBase: round(madBase, 2),
      madAdjusted,
      intervalDays: interval === null ? null : round(interval, 2),
    },
    steps: log.steps,
    notes: log.notes,
  };
}
