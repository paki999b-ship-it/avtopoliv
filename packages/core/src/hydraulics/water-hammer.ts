/**
 * §5.13. Гидроудар (формула Жуковского).
 *
 *   Δp = ρ · c · Δv
 *   c ≈ 300–400 м/с (ПНД), 1000–1200 м/с (сталь)
 *
 * Наглядный вывод из ТЗ: при v = 1,5 м/с в стальной трубе скачок порядка
 * 18 бар — отсюда требование плавного закрытия и ограничения скорости.
 */

import { WATER_DENSITY, WAVE_SPEED_MS, G } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requireNonNegative, requirePositive } from '../internal/build.js';
import type { CalcResult } from '../types.js';

export type HammerMaterial = 'pe' | 'pvc' | 'steel';

export interface WaterHammerInput {
  /** Изменение скорости потока при закрытии, м/с (обычно = рабочая скорость). */
  velocityChangeMs: number;
  material?: HammerMaterial;
  /** Явная скорость волны, м/с — перекрывает материал. */
  waveSpeedMs?: number;
  /** Длина участка от источника до закрывающегося клапана, м — для фазы. */
  lengthM?: number;
  /** Фактическое время закрытия клапана, с. */
  closingTimeS?: number;
  /** Рабочее давление в системе, бар — для оценки суммарного пика. */
  workingPressureBar?: number;
}

export interface WaterHammerValues {
  /** Скачок давления при мгновенном закрытии, бар (по нижней границе c). */
  surgeBarMin: number;
  /** То же по верхней границе c. */
  surgeBarMax: number;
  /** Скачок при принятой (средней или заданной) скорости волны, бар. */
  surgeBar: number;
  /** Скачок в метрах водяного столба. */
  surgeM: number;
  /** Фаза гидроудара 2L/c, с — граница «мгновенного» закрытия. */
  phaseS: number | null;
  /** Пик давления с учётом рабочего, бар. */
  peakPressureBar: number | null;
  isFastClosure: boolean | null;
}

/** Δp [Па] = ρ · c · Δv. */
export function zhukovskyPressureRisePa(waveSpeedMs: number, velocityChangeMs: number): number {
  return WATER_DENSITY * waveSpeedMs * velocityChangeMs;
}

export function waterHammer(input: WaterHammerInput): CalcResult<WaterHammerValues> {
  const dv = requireNonNegative(input.velocityChangeMs, 'Изменение скорости');
  const material: HammerMaterial = input.material ?? 'pe';
  const range = WAVE_SPEED_MS[material];
  const c = input.waveSpeedMs ?? (range.min + range.max) / 2;
  requirePositive(c, 'Скорость ударной волны');

  const log = new StepLog();

  const surgePa = zhukovskyPressureRisePa(c, dv);
  const surgeBar = surgePa / 1e5;
  const surgeM = (c * dv) / G;
  const surgeMin = zhukovskyPressureRisePa(range.min, dv) / 1e5;
  const surgeMax = zhukovskyPressureRisePa(range.max, dv) / 1e5;

  log.step(
    'Скорость ударной волны',
    'c — по материалу трубы',
    material === 'steel'
      ? 'сталь: 1000–1200 м/с'
      : material === 'pvc'
        ? 'ПВХ: 400–600 м/с'
        : 'ПНД: 300–400 м/с',
    `c = ${fmt(c, 0)} м/с`,
  );
  log.step(
    'Скачок давления (Жуковский)',
    'Δp = ρ · c · Δv',
    `1000 · ${fmt(c, 0)} · ${fmt(dv, 2)}`,
    `${fmt(surgePa / 1000, 0)} кПа = ${fmt(surgeBar, 1)} бар`,
  );
  log.step(
    'То же в метрах водяного столба',
    'Δh = c · Δv / g',
    `${fmt(c, 0)} · ${fmt(dv, 2)} / 9,81`,
    `${fmt(surgeM, 0)} м вод. ст.`,
  );

  let phaseS: number | null = null;
  let isFast: boolean | null = null;
  if (input.lengthM !== undefined) {
    const l = requirePositive(input.lengthM, 'Длина участка');
    phaseS = (2 * l) / c;
    log.step(
      'Фаза гидроудара',
      'T = 2L / c',
      `2 · ${fmt(l, 0)} / ${fmt(c, 0)}`,
      `${fmt(phaseS, 2)} с`,
    );
    if (input.closingTimeS !== undefined) {
      const tc = requireNonNegative(input.closingTimeS, 'Время закрытия');
      isFast = tc <= phaseS;
      log.step(
        'Тип закрытия',
        'быстрое, если t_закр ≤ 2L/c',
        `${fmt(tc, 2)} с против ${fmt(phaseS, 2)} с`,
        isFast ? 'быстрое — удар в полную силу' : 'медленное — удар ослаблен',
      );
      if (!isFast && tc > 0) {
        const reduced = surgeBar * (phaseS / tc);
        log.info(
          'slow-closure',
          `При закрытии за ${fmt(tc, 1)} с скачок снижается примерно до ${fmt(reduced, 1)} бар`,
          'Мембранный клапан с электромагнитом закрывается за 1–3 секунды именно поэтому.',
        );
      }
    }
  }

  let peak: number | null = null;
  if (input.workingPressureBar !== undefined) {
    const wp = requireNonNegative(input.workingPressureBar, 'Рабочее давление');
    peak = wp + surgeBar;
    log.step(
      'Пиковое давление',
      'P_пик = P_раб + Δp',
      `${fmt(wp, 1)} + ${fmt(surgeBar, 1)}`,
      `${fmt(peak, 1)} бар`,
    );
  }

  log.info(
    'range',
    `Разброс по скорости волны: ${fmt(surgeMin, 1)}…${fmt(surgeMax, 1)} бар`,
    'Скорость волны зависит от жёсткости трубы: чем податливее стенка, тем мягче удар. Полиэтилен гасит удар в три-четыре раза лучше стали.',
  );

  if (surgeBar >= 10) {
    log.error(
      'hammer-severe',
      `Скачок ${fmt(surgeBar, 1)} бар — опасно для соединений и мембран`,
      'Такой импульс рвёт компрессионные фитинги, выбивает уплотнения клапанов и разрушает манометры.',
      'Снизьте скорость потока до 1,0–1,5 м/с, поставьте клапаны с регулируемой скоростью закрытия, при необходимости — гаситель удара или воздушный клапан.',
    );
  } else if (surgeBar >= 5) {
    log.warn(
      'hammer-high',
      `Скачок ${fmt(surgeBar, 1)} бар — заметный удар`,
      'Система выдержит, но соединения работают на усталость, а срок службы мембран сокращается.',
      'Ограничьте скорость в магистрали и убедитесь, что клапаны не закрываются мгновенно.',
    );
  } else {
    log.info('hammer-ok', `Скачок ${fmt(surgeBar, 1)} бар — в пределах обычного для полива`);
  }

  return {
    values: {
      surgeBarMin: round(surgeMin, 2),
      surgeBarMax: round(surgeMax, 2),
      surgeBar: round(surgeBar, 2),
      surgeM: round(surgeM, 1),
      phaseS: phaseS === null ? null : round(phaseS, 3),
      peakPressureBar: peak === null ? null : round(peak, 2),
      isFastClosure: isFast,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
