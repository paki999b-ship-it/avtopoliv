/**
 * §5.3. Скорость потока.
 *   v = 4Q / (π·D²)
 * Цель 1,0–1,5 м/с, предел 2,0 м/с, всасывающая линия не выше 1,2 м/с.
 */

import { VELOCITY_LIMITS } from '../constants.js';
import { fmt, fmtSig, round } from '../format.js';
import { StepLog, requirePositive } from '../internal/build.js';
import type { CalcResult } from '../types.js';
import { m3hToM3s } from '../units.js';

export type PipeRole = 'main' | 'lateral' | 'suction';

export interface VelocityInput {
  flowM3h: number;
  innerDiameterMm: number;
  /** Всасывающая линия имеет более жёсткий предел (1,2 м/с). */
  role?: PipeRole;
}

export interface VelocityValues {
  velocityMs: number;
  areaM2: number;
  /** Предел, применённый к этому участку, м/с. */
  limitMs: number;
  status: 'ok' | 'below_target' | 'above_target' | 'over_limit';
}

/** Только число: v = 4Q/(πD²), Q в м³/с, D в м. */
export function velocityMs(flowM3s: number, innerDiameterM: number): number {
  return (4 * flowM3s) / (Math.PI * innerDiameterM ** 2);
}

export function flowVelocity(input: VelocityInput): CalcResult<VelocityValues> {
  const flowM3h = requirePositive(input.flowM3h, 'Расход');
  const dMm = requirePositive(input.innerDiameterMm, 'Внутренний диаметр');
  const role: PipeRole = input.role ?? 'main';

  const log = new StepLog();
  const d = dMm / 1000;
  const q = m3hToM3s(flowM3h);
  const area = (Math.PI * d ** 2) / 4;
  const v = velocityMs(q, d);
  const limit = role === 'suction' ? VELOCITY_LIMITS.suctionMax : VELOCITY_LIMITS.hardMax;

  log.step(
    'Расход в м³/с',
    'Q [м³/с] = Q [м³/ч] / 3600',
    `${fmt(flowM3h, 2)} / 3600`,
    `${fmtSig(q, 4)} м³/с`,
  );
  log.step(
    'Площадь сечения',
    'A = π · D² / 4',
    `3,1416 · ${fmt(d, 4)}² / 4`,
    `${fmtSig(area, 4)} м²`,
  );
  log.step(
    'Скорость потока',
    'v = 4Q / (π · D²) = Q / A',
    `${fmtSig(q, 4)} / ${fmtSig(area, 4)}`,
    `${fmt(v, 2)} м/с`,
  );

  let status: VelocityValues['status'] = 'ok';
  if (v > limit) {
    status = 'over_limit';
    log.error(
      'velocity-over-limit',
      `Скорость ${fmt(v, 2)} м/с выше предела ${fmt(limit, 1)} м/с`,
      role === 'suction'
        ? 'На всасывании высокая скорость роняет давление на входе в насос: возникает кавитация — насос «съедает» сам себя.'
        : 'Выше 2 м/с резко растут потери, труба шумит, а при быстром закрытии клапана гидроудар становится опасным для соединений.',
      'Возьмите трубу на типоразмер больше или разделите зону на две.',
    );
  } else if (v > VELOCITY_LIMITS.targetMax) {
    status = 'above_target';
    log.warn(
      'velocity-above-target',
      `Скорость ${fmt(v, 2)} м/с выше целевого диапазона 1,0–1,5 м/с`,
      'Потери на трение растут примерно как квадрат скорости — каждый лишний метр напора вы оплачиваете насосом.',
      'Проверьте следующий типоразмер трубы: обычно он дешевле, чем разница в напоре за сезон.',
    );
  } else if (v < VELOCITY_LIMITS.targetMin) {
    status = 'below_target';
    log.info(
      'velocity-below-target',
      `Скорость ${fmt(v, 2)} м/с ниже 1,0 м/с`,
      'Гидравлически это безопасно, но труба выбрана с запасом — растёт стоимость и объём воды, который нужно выдавить при пуске зоны.',
      'Если это не магистраль с расчётом на расширение, можно взять диаметр меньше.',
    );
  } else {
    log.info('velocity-ok', `Скорость ${fmt(v, 2)} м/с в целевом диапазоне 1,0–1,5 м/с`);
  }

  if (role === 'suction') {
    log.info(
      'suction-limit',
      'Всасывающая линия: предел 1,2 м/с',
      'Насос не «тянет» воду, её вдавливает атмосферное давление; любое сопротивление на всасывании уменьшает запас до кавитации (NPSH).',
      'Всасывающую делают на типоразмер больше напорной и без лишних колен.',
    );
  }

  return {
    values: {
      velocityMs: round(v, 3),
      areaM2: round(area, 6),
      limitMs: limit,
      status,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
