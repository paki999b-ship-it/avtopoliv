/**
 * §5.2. Потери напора на трение.
 *
 * Основной метод — Хазен–Вильямс в метрической форме:
 *   hf = 10,67 · L · Q^1,852 / (C^1,852 · D^4,87)
 *   hf — м вод. ст. | L — м | Q — м³/с | D — внутренний диаметр, м
 *
 * Альтернативный метод — Дарси–Вейсбах с коэффициентом трения по Свейми–Джейну.
 * В режиме «проектировщик» показываются оба: расхождение методов само по себе
 * учебно ценно (ТЗ §5.2).
 *
 * Контрольный пример ТЗ: ПНД 63 мм SDR17 (внутр. 55,4 мм), Q = 13 м³/ч,
 * C = 150, L = 100 м → около 3,9 м.
 */

import { HAZEN_WILLIAMS_C, HAZEN_WILLIAMS_C_LABEL, PIPE_ROUGHNESS_MM, G } from '../constants.js';
import { fmt, fmtSig, round } from '../format.js';
import { StepLog, requirePositive, requireNonNegative } from '../internal/build.js';
import type { CalcResult, PipeMaterial } from '../types.js';
import { kinematicViscosity, m3hToM3s } from '../units.js';

/** Показатель степени расхода в формуле Хазена–Вильямса. */
export const HW_FLOW_EXPONENT = 1.852;

export interface FrictionInput {
  /** Расход, м³/ч. */
  flowM3h: number;
  /** Внутренний диаметр, мм. */
  innerDiameterMm: number;
  /** Длина участка, м. */
  lengthM: number;
  /** Материал — определяет C и шероховатость. Игнорируется, если задан `hazenWilliamsC`. */
  material?: PipeMaterial;
  /** Явный коэффициент Хазена–Вильямса (перекрывает материал). */
  hazenWilliamsC?: number;
  /** Температура воды, °C — только для Дарси–Вейсбаха. */
  waterTempC?: number;
}

export interface FrictionValues {
  /** Потери по Хазену–Вильямсу, м вод. ст. */
  headLossM: number;
  /** То же в барах. */
  headLossBar: number;
  /** Потери на 100 м, м вод. ст. */
  headLossPer100mM: number;
  /** Скорость потока, м/с. */
  velocityMs: number;
  /** Применённый коэффициент C. */
  hazenWilliamsC: number;
  /** Потери по Дарси–Вейсбаху, м вод. ст. */
  darcyHeadLossM: number;
  /** Коэффициент трения по Свейми–Джейну. */
  frictionFactor: number;
  /** Число Рейнольдса. */
  reynolds: number;
  /** Относительное расхождение методов, %. */
  methodDeltaPercent: number;
}

/**
 * Потери напора по Хазену–Вильямсу (только число, без пояснений).
 * @param flowM3s расход, м³/с
 * @param innerDiameterM внутренний диаметр, м
 */
export function hazenWilliamsLossM(
  flowM3s: number,
  innerDiameterM: number,
  lengthM: number,
  c: number,
): number {
  return (
    (10.67 * lengthM * flowM3s ** HW_FLOW_EXPONENT) /
    (c ** HW_FLOW_EXPONENT * innerDiameterM ** 4.87)
  );
}

/**
 * Коэффициент трения по формуле Свейми–Джейна (явная аппроксимация Колбрука–Уайта):
 *   f = 0,25 / [log10( e/(3,7·D) + 5,74/Re^0,9 )]²
 * Для ламинарного режима (Re < 2000) используется f = 64/Re.
 */
export function swameeJainFrictionFactor(
  reynolds: number,
  roughnessM: number,
  innerDiameterM: number,
): number {
  if (reynolds <= 0) return 0;
  if (reynolds < 2000) return 64 / reynolds;
  const term = roughnessM / (3.7 * innerDiameterM) + 5.74 / reynolds ** 0.9;
  return 0.25 / Math.log10(term) ** 2;
}

/** Потери напора по Дарси–Вейсбаху: hf = f · (L/D) · v²/(2g). */
export function darcyWeisbachLossM(
  frictionFactor: number,
  lengthM: number,
  innerDiameterM: number,
  velocityMs: number,
): number {
  return (frictionFactor * (lengthM / innerDiameterM) * velocityMs ** 2) / (2 * G);
}

/** Полный расчёт потерь с формулами, подстановкой и замечаниями. */
export function frictionLoss(input: FrictionInput): CalcResult<FrictionValues> {
  const flowM3h = requirePositive(input.flowM3h, 'Расход');
  const dMm = requirePositive(input.innerDiameterMm, 'Внутренний диаметр');
  const lengthM = requireNonNegative(input.lengthM, 'Длина участка');
  const material: PipeMaterial = input.material ?? 'pe_new';
  const c = input.hazenWilliamsC ?? HAZEN_WILLIAMS_C[material];
  requirePositive(c, 'Коэффициент C');

  const log = new StepLog();
  const d = dMm / 1000;
  const q = m3hToM3s(flowM3h);
  const area = (Math.PI * d ** 2) / 4;
  const velocity = q / area;

  const hf = hazenWilliamsLossM(q, d, lengthM, c);
  const hfPer100 = lengthM > 0 ? (hf / lengthM) * 100 : hazenWilliamsLossM(q, d, 100, c);

  log.step(
    'Перевод расхода в м³/с',
    'Q [м³/с] = Q [м³/ч] / 3600',
    `${fmt(flowM3h, 2)} / 3600`,
    `${fmtSig(q, 4)} м³/с`,
  );
  log.step(
    'Внутренний диаметр в метрах',
    'D [м] = D [мм] / 1000',
    `${fmt(dMm, 1)} / 1000`,
    `${fmt(d, 4)} м`,
  );
  log.step(
    'Коэффициент Хазена–Вильямса',
    'C — по материалу трубы',
    input.hazenWilliamsC ? 'задан вручную' : `${HAZEN_WILLIAMS_C_LABEL[material]}`,
    `C = ${fmt(c, 0)}`,
  );
  log.step(
    'Потери на трение (Хазен–Вильямс)',
    'hf = 10,67 · L · Q^1,852 / (C^1,852 · D^4,87)',
    `10,67 · ${fmt(lengthM, 1)} · ${fmtSig(q, 4)}^1,852 / (${fmt(c, 0)}^1,852 · ${fmt(d, 4)}^4,87)`,
    `${fmt(hf, 2)} м вод. ст.`,
  );
  log.step(
    'Потери на 100 м',
    'hf₁₀₀ = hf · 100 / L',
    `${fmt(hf, 2)} · 100 / ${fmt(lengthM, 1)}`,
    `${fmt(hfPer100, 2)} м / 100 м`,
  );

  // Дарси–Вейсбах для сверки методов.
  const nu = kinematicViscosity(input.waterTempC ?? 20);
  const reynolds = (velocity * d) / nu;
  const roughnessM = PIPE_ROUGHNESS_MM[material] / 1000;
  const f = swameeJainFrictionFactor(reynolds, roughnessM, d);
  const hfDarcy = darcyWeisbachLossM(f, lengthM, d, velocity);

  log.step(
    'Число Рейнольдса',
    'Re = v · D / ν',
    `${fmt(velocity, 3)} · ${fmt(d, 4)} / ${fmtSig(nu, 4)}`,
    `${fmt(reynolds, 0)}`,
  );
  log.step(
    'Коэффициент трения (Свейми–Джейн)',
    'f = 0,25 / [lg( e/(3,7·D) + 5,74/Re^0,9 )]²',
    `e = ${fmtSig(PIPE_ROUGHNESS_MM[material], 3)} мм, Re = ${fmt(reynolds, 0)}`,
    `f = ${fmt(f, 4)}`,
  );
  log.step(
    'Потери на трение (Дарси–Вейсбах)',
    'hf = f · (L/D) · v² / (2g)',
    `${fmt(f, 4)} · (${fmt(lengthM, 1)} / ${fmt(d, 4)}) · ${fmt(velocity, 3)}² / (2 · 9,81)`,
    `${fmt(hfDarcy, 2)} м вод. ст.`,
  );

  const delta = hf > 0 ? ((hfDarcy - hf) / hf) * 100 : 0;
  log.info(
    'method-comparison',
    `Расхождение методов: ${fmt(Math.abs(delta), 1)} %`,
    'Хазен–Вильямс — эмпирическая формула, откалиброванная на воде при обычных температурах и скоростях; Дарси–Вейсбах — физическая модель с учётом вязкости и шероховатости.',
    'Для проектных решений берите больший из двух результатов — это запас в правильную сторону.',
  );

  if (Math.abs(delta) > 25) {
    log.warn(
      'method-divergence',
      'Методы расходятся более чем на 25 %',
      'Обычно это означает выход за область применимости Хазена–Вильямса: очень малый диаметр, очень низкая или очень высокая скорость.',
      'В таком режиме доверяйте Дарси–Вейсбаху.',
    );
  }

  if (lengthM === 0) {
    log.info('zero-length', 'Длина участка нулевая — показаны только потери на 100 м.');
  }

  return {
    values: {
      headLossM: round(hf, 3),
      headLossBar: round(hf / 10.2, 4),
      headLossPer100mM: round(hfPer100, 3),
      velocityMs: round(velocity, 3),
      hazenWilliamsC: c,
      darcyHeadLossM: round(hfDarcy, 3),
      frictionFactor: round(f, 5),
      reynolds: round(reynolds, 0),
      methodDeltaPercent: round(delta, 1),
    },
    steps: log.steps,
    notes: log.notes,
  };
}
