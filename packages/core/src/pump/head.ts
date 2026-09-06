/**
 * §5.11. Полный требуемый напор и подбор насоса.
 *
 *   H = H_геод + h_трение + h_местные + P_дождевателя + запас 10–15 %
 *   P [кВт] = Q [м³/ч] · H [м] / (367 · η),  η ≈ 0,5–0,75
 *
 * Кривых конкретных насосов в приложении НЕТ (ТЗ §5.11, §8): пользователь
 * вводит две-три точки паспортной кривой вручную, приложение строит график
 * и показывает пересечение с характеристикой системы.
 */

import { fmt, round } from '../format.js';
import { StepLog, requireNonNegative, requirePositive, requireRange } from '../internal/build.js';
import type { CalcResult } from '../types.js';
import { barToMwc, mwcToBar } from '../units.js';

export interface PumpHeadInput {
  /** Расчётный расход системы, м³/ч. */
  flowM3h: number;
  /** Геодезический перепад от зеркала воды до самой высокой точки, м. */
  staticLiftM: number;
  /** Потери на трение, м вод. ст. */
  frictionLossM: number;
  /** Местные потери, м вод. ст. */
  minorLossM?: number;
  /** Требуемое рабочее давление дождевателя, бар. */
  sprinklerPressureBar: number;
  /** Запас, доля (0,10–0,15). По умолчанию 0,10. */
  safetyMargin?: number;
  /** КПД насоса. По умолчанию 0,6. */
  efficiency?: number;
}

/**
 * Одно слагаемое требуемого напора.
 *
 * Итоговое число «нужен насос на 66 метров» само по себе ничего не объясняет:
 * половину в нём обычно занимает рабочее давление дождевателя, которое урезать
 * нельзя, а потери на трение — единственное, что реально уменьшается выбором
 * диаметра. Поэтому разбор считается здесь, а не собирается в интерфейсе.
 */
export interface HeadComponent {
  key: 'static' | 'friction' | 'minor' | 'sprinkler' | 'margin';
  label: string;
  headM: number;
  /** Доля в требуемом напоре, 0–1. */
  share: number;
  /** Что с этим слагаемым можно сделать. */
  lever: string;
}

export interface PumpHeadValues {
  /** Требуемый напор без запаса, м. */
  headBeforeMarginM: number;
  /** Требуемый напор с запасом, м. */
  requiredHeadM: number;
  requiredHeadBar: number;
  /** Давление дождевателя в метрах, м. */
  sprinklerHeadM: number;
  /** Гидравлическая рабочая точка. */
  dutyPoint: { flowM3h: number; headM: number };
  /** Потребляемая мощность, кВт. */
  shaftPowerKw: number;
  efficiency: number;
  /** Из чего сложился требуемый напор — по убыванию вклада. */
  breakdown: HeadComponent[];
}

export function pumpHead(input: PumpHeadInput): CalcResult<PumpHeadValues> {
  const q = requirePositive(input.flowM3h, 'Расход');
  const geo = requireNonNegative(input.staticLiftM, 'Геодезический перепад');
  const friction = requireNonNegative(input.frictionLossM, 'Потери на трение');
  const minor = requireNonNegative(input.minorLossM ?? 0, 'Местные потери');
  const pBar = requirePositive(input.sprinklerPressureBar, 'Давление дождевателя');
  const margin = requireRange(input.safetyMargin ?? 0.1, 0, 0.5, 'Запас');
  const eta = requireRange(input.efficiency ?? 0.6, 0.2, 0.95, 'КПД насоса');

  const log = new StepLog();
  const pHead = barToMwc(pBar);
  const before = geo + friction + minor + pHead;
  const required = before * (1 + margin);
  const power = (q * required) / (367 * eta);

  log.step(
    'Давление дождевателя в метрах',
    'h_дожд = P [бар] · 10,2',
    `${fmt(pBar, 1)} · 10,2`,
    `${fmt(pHead, 1)} м вод. ст.`,
  );
  log.step(
    'Сумма составляющих напора',
    'H₀ = H_геод + h_трение + h_местные + h_дожд',
    `${fmt(geo, 1)} + ${fmt(friction, 1)} + ${fmt(minor, 1)} + ${fmt(pHead, 1)}`,
    `${fmt(before, 1)} м`,
  );
  log.step(
    'Требуемый напор с запасом',
    'H = H₀ · (1 + запас)',
    `${fmt(before, 1)} · (1 + ${fmt(margin, 2)})`,
    `${fmt(required, 1)} м (${fmt(mwcToBar(required), 2)} бар)`,
  );
  log.step(
    'Потребляемая мощность',
    'P [кВт] = Q [м³/ч] · H [м] / (367 · η)',
    `${fmt(q, 2)} · ${fmt(required, 1)} / (367 · ${fmt(eta, 2)})`,
    `${fmt(power, 2)} кВт`,
  );

  log.info(
    'duty-point',
    `Рабочая точка: Q = ${fmt(q, 2)} м³/ч при H = ${fmt(required, 1)} м`,
    'Насос подбирают по рабочей точке, а не по «максимальному напору» из рекламы: на максимальном напоре расход равен нулю.',
    'Найдите эту точку на паспортной кривой конкретного насоса — она должна лежать в средней трети кривой, ближе к максимуму КПД.',
  );
  log.info(
    'npsh',
    'Проверьте запас по кавитации (NPSH) для поверхностного насоса',
    'Насос не всасывает воду — её вдавливает атмосферное давление. Высота всасывания больше 7–8 м физически недостижима, а с учётом потерь на всасывающей линии практический предел ещё ниже.',
    'Сверьте требуемый NPSH из паспорта с фактическим на вашей всасывающей линии; при сомнении ставьте погружной насос.',
  );
  log.info(
    'geodetic-rule',
    'Каждые 10 м высоты — это примерно 1 бар',
    'Геодезический перепад не зависит от расхода: он вычитается из давления всегда, даже когда система стоит.',
  );

  if (geo > 8) {
    log.warn(
      'high-lift',
      `Геодезический перепад ${fmt(geo, 1)} м`,
      'Для поверхностного насоса высота всасывания выше 7–8 м недостижима принципиально.',
      'Если это высота всасывания, а не подъёма, переходите на погружной насос или опускайте насос ближе к воде.',
    );
  }

  if (margin < 0.1) {
    log.warn(
      'margin-low',
      `Запас ${fmt(margin * 100, 0)} % ниже рекомендуемых 10–15 %`,
      'Труба зарастает, фильтр забивается, сопла изнашиваются — фактические потери со временем растут.',
      'Возьмите запас не меньше 10 %.',
    );
  }

  const marginHead = required - before;
  const breakdown: HeadComponent[] = (
    [
      {
        key: 'sprinkler',
        label: 'Рабочее давление дождевателя',
        headM: pHead,
        lever: 'Урезать нельзя: сопло при недостатке давления даёт рваную струю. Уменьшается только сменой класса оборудования.',
      },
      {
        key: 'static',
        label: 'Подъём по высоте',
        headM: geo,
        lever: 'Задан рельефом и глубиной воды. Уменьшается только переносом насоса ближе к воде.',
      },
      {
        key: 'friction',
        label: 'Потери на трение',
        headM: friction,
        lever: 'Единственное слагаемое, которое реально снижается: больший диаметр трубы или разделение зоны.',
      },
      { key: 'minor', label: 'Местные потери', headM: minor, lever: 'Снижаются выбором фильтра и клапана по расходу, а не по диаметру трубы.' },
      {
        key: 'margin',
        label: `Запас ${fmt(margin * 100, 0)} %`,
        headM: marginHead,
        lever: 'На износ и загрязнение системы. Меньше 10 % брать не стоит, больше 15 % — это работа насоса вне эффективной зоны.',
      },
    ] as const
  )
    .filter((c) => c.headM > 0)
    .map((c) => ({ ...c, headM: round(c.headM, 2), share: round(c.headM / required, 4) }))
    .sort((a, b) => b.headM - a.headM);

  return {
    values: {
      headBeforeMarginM: round(before, 2),
      requiredHeadM: round(required, 2),
      requiredHeadBar: round(mwcToBar(required), 3),
      sprinklerHeadM: round(pHead, 2),
      dutyPoint: { flowM3h: round(q, 2), headM: round(required, 2) },
      shaftPowerKw: round(power, 3),
      efficiency: eta,
      breakdown,
    },
    steps: log.steps,
    notes: log.notes,
  };
}

// ── Кривая насоса и рабочая точка ───────────────────────────────────────────

export interface PumpCurvePoint {
  flowM3h: number;
  headM: number;
}

export interface PumpCurve {
  /** H(Q) = a + b·Q + c·Q² */
  a: number;
  b: number;
  c: number;
  points: PumpCurvePoint[];
}

/**
 * Аппроксимация паспортной кривой насоса параболой H = a + b·Q + c·Q².
 * Принимает 2 или 3 точки (2 точки → b = 0, парабола H = a + c·Q²).
 */
export function fitPumpCurve(points: PumpCurvePoint[]): PumpCurve {
  if (points.length < 2) throw new Error('Нужны минимум две точки паспортной кривой');
  const pts = [...points].sort((p, q) => p.flowM3h - q.flowM3h);

  if (pts.length === 2) {
    const [p1, p2] = pts as [PumpCurvePoint, PumpCurvePoint];
    if (p1.flowM3h === p2.flowM3h) throw new Error('Точки кривой должны иметь разный расход');
    // H = a + c·Q²
    const c = (p2.headM - p1.headM) / (p2.flowM3h ** 2 - p1.flowM3h ** 2);
    const a = p1.headM - c * p1.flowM3h ** 2;
    return { a, b: 0, c, points: pts };
  }

  // Метод наименьших квадратов по базису [1, Q, Q²].
  const n = pts.length;
  let s0 = n, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let t0 = 0, t1 = 0, t2 = 0;
  for (const p of pts) {
    const x = p.flowM3h;
    const y = p.headM;
    s1 += x;
    s2 += x * x;
    s3 += x ** 3;
    s4 += x ** 4;
    t0 += y;
    t1 += x * y;
    t2 += x * x * y;
  }
  const m: number[][] = [
    [s0, s1, s2, t0],
    [s1, s2, s3, t1],
    [s2, s3, s4, t2],
  ];
  // Метод Гаусса 3×3.
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    for (let r = i + 1; r < 3; r++) {
      if (Math.abs(m[r]![i]!) > Math.abs(m[pivot]![i]!)) pivot = r;
    }
    const tmp = m[i]!;
    m[i] = m[pivot]!;
    m[pivot] = tmp;
    const d = m[i]![i]!;
    if (Math.abs(d) < 1e-12) throw new Error('Точки кривой вырождены — аппроксимация невозможна');
    for (let k = i; k < 4; k++) m[i]![k] = m[i]![k]! / d;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r]![i]!;
      for (let k = i; k < 4; k++) m[r]![k] = m[r]![k]! - f * m[i]![k]!;
    }
  }
  return { a: m[0]![3]!, b: m[1]![3]!, c: m[2]![3]!, points: pts };
}

export const pumpHeadAt = (curve: PumpCurve, flowM3h: number): number =>
  curve.a + curve.b * flowM3h + curve.c * flowM3h ** 2;

export interface SystemCurve {
  /** Статическая составляющая (геодезия + давление дождевателя), м. */
  staticHeadM: number;
  /** Коэффициент потерь: h = k · Q^1,852 (форма Хазена–Вильямса). */
  k: number;
}

/**
 * Характеристика системы, откалиброванная по одной расчётной точке:
 * h_потерь(Q_расч) = lossM, дальше масштабируется по Q^1,852.
 */
export function buildSystemCurve(
  staticHeadM: number,
  designFlowM3h: number,
  designLossM: number,
): SystemCurve {
  requirePositive(designFlowM3h, 'Расчётный расход');
  return { staticHeadM, k: designLossM / designFlowM3h ** 1.852 };
}

export const systemHeadAt = (curve: SystemCurve, flowM3h: number): number =>
  curve.staticHeadM + curve.k * flowM3h ** 1.852;

export interface OperatingPoint {
  flowM3h: number;
  headM: number;
  found: boolean;
}

/**
 * Пересечение кривой насоса и характеристики системы — фактическая рабочая
 * точка. Ищется делением отрезка пополам на [0; Q_max].
 */
export function findOperatingPoint(
  pump: PumpCurve,
  system: SystemCurve,
  maxFlowM3h?: number,
): OperatingPoint {
  const hi0 = maxFlowM3h ?? Math.max(...pump.points.map((p) => p.flowM3h)) * 1.5;
  const diff = (q: number) => pumpHeadAt(pump, q) - systemHeadAt(system, q);

  if (diff(1e-6) < 0) {
    // Насос не создаёт даже статического напора.
    return { flowM3h: 0, headM: system.staticHeadM, found: false };
  }
  let lo = 1e-6;
  let hi = hi0;
  if (diff(hi) > 0) {
    return { flowM3h: round(hi, 2), headM: round(pumpHeadAt(pump, hi), 2), found: false };
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (diff(mid) > 0) lo = mid;
    else hi = mid;
  }
  const q = (lo + hi) / 2;
  return { flowM3h: round(q, 3), headM: round(pumpHeadAt(pump, q), 2), found: true };
}
