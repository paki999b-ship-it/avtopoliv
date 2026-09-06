/**
 * §5.16. Проверка зоны (sanity check).
 *
 * Сводный калькулятор: пользователь вводит состав зоны, приложение проверяет
 * разом:
 *  - расход зоны против дебита источника (≤ 80 %);
 *  - суммарные потери против рабочего давления дождевателя (≤ 20–25 %);
 *  - давление в самой дальней/высокой точке;
 *  - скорость в трубе;
 *  - однородность класса оборудования и согласованность интенсивности;
 *  - PR против впитывания почвы;
 *  - ток и падение напряжения на кабеле.
 *
 * Каждое несоответствие — карточка «что не так → почему → как исправить».
 */

import { SOURCE_UTILISATION, VELOCITY_LIMITS, ZONE_LOSS_BUDGET } from './constants.js';
import { fmt, round } from './format.js';
import { StepLog, requirePositive, requireNonNegative } from './internal/build.js';
import type { CalcResult, EmitterClass, PipeMaterial } from './types.js';
import { frictionLoss } from './hydraulics/friction.js';
import { velocityMs } from './hydraulics/velocity.js';
import { voltageDropV } from './electrical/voltage-drop.js';
import { VALVE_CABLE } from './constants.js';
import { barToMwc, m3hToM3s, mwcToBar } from './units.js';

export interface ZoneHead {
  name: string;
  emitterClass: EmitterClass;
  /** Расход головы, л/ч. */
  flowLph: number;
  /** Сектор, град. */
  sectorDeg: number;
  /** Расчётная интенсивность головы, мм/ч — если известна. */
  precipitationRateMmH?: number;
}

export interface ZoneCheckInput {
  zoneName: string;
  heads: ZoneHead[];
  /** Поливаемая площадь зоны, м². */
  zoneAreaM2: number;

  /** Дебит источника, м³/ч. */
  sourceFlowM3h: number;
  /** Давление на входе в зону, бар. */
  inletPressureBar: number;
  /** Требуемое рабочее давление дождевателя, бар. */
  requiredHeadPressureBar: number;

  /** Внутренний диаметр трубы зоны, мм. */
  pipeInnerDiameterMm: number;
  /** Длина трубы до самой дальней головы, м. */
  pipeLengthM: number;
  pipeMaterial?: PipeMaterial;
  /** Превышение самой высокой головы над узлом, м. */
  elevationGainM?: number;
  /** Доля местных потерь. По умолчанию 0,15. */
  fittingsShare?: number;

  /** Скорость впитывания почвы, мм/ч. */
  soilInfiltrationMmH?: number;

  /** Длина клапанного кабеля, м. */
  cableLengthM?: number;
  /** Сечение жилы, мм². */
  cableCrossSectionMm2?: number;
  /** Ток соленоида, А. */
  solenoidCurrentA?: number;
}

export interface ZoneCheckIssue {
  code: string;
  severity: 'warning' | 'error';
  /** Что не так. */
  what: string;
  /** Почему это плохо. */
  why: string;
  /** Как исправить. */
  fix: string;
}

export interface ZoneCheckValues {
  zoneName: string;
  headCount: number;
  zoneFlowM3h: number;
  zoneFlowLph: number;
  sourceUtilisation: number;
  precipitationRateMmH: number;
  velocityMs: number;
  frictionLossM: number;
  minorLossM: number;
  elevationLossM: number;
  totalLossM: number;
  /** Доля потерь от рабочего давления дождевателя. */
  lossShareOfWorkingPressure: number;
  pressureAtFarthestHeadBar: number;
  cableDropV: number | null;
  emitterClassesUsed: EmitterClass[];
  prSpreadPercent: number | null;
  passed: boolean;
  issues: ZoneCheckIssue[];
}

export function zoneCheck(input: ZoneCheckInput): CalcResult<ZoneCheckValues> {
  if (input.heads.length === 0) throw new Error('В зоне нет ни одной головы');
  const area = requirePositive(input.zoneAreaM2, 'Площадь зоны');
  const source = requirePositive(input.sourceFlowM3h, 'Дебит источника');
  const inlet = requirePositive(input.inletPressureBar, 'Давление на входе');
  const required = requirePositive(input.requiredHeadPressureBar, 'Рабочее давление дождевателя');
  const dMm = requirePositive(input.pipeInnerDiameterMm, 'Внутренний диаметр трубы');
  const lengthM = requireNonNegative(input.pipeLengthM, 'Длина трубы');
  const elev = input.elevationGainM ?? 0;
  const share = input.fittingsShare ?? 0.15;

  const log = new StepLog();
  const issues: ZoneCheckIssue[] = [];
  const addIssue = (i: ZoneCheckIssue) => {
    issues.push(i);
    log.note(i.severity, i.code, i.what, i.why, i.fix);
  };

  // ── 1. Расход зоны против дебита ──────────────────────────────────────────
  const flowLph = input.heads.reduce((s, h) => s + h.flowLph, 0);
  const flowM3h = flowLph / 1000;
  const utilisation = flowM3h / source;

  log.step(
    'Расход зоны',
    'Q_зоны = Σ q_голов',
    `${input.heads.length} голов, суммарно ${fmt(flowLph, 0)} л/ч`,
    `${fmt(flowM3h, 2)} м³/ч`,
  );
  log.step(
    'Использование источника',
    'k = Q_зоны / Дебит,  предел 0,80',
    `${fmt(flowM3h, 2)} / ${fmt(source, 2)}`,
    `${fmt(utilisation * 100, 0)} %`,
  );

  if (utilisation > 1) {
    addIssue({
      code: 'flow-over-source',
      severity: 'error',
      what: `Зона требует ${fmt(flowM3h, 2)} м³/ч при дебите источника ${fmt(source, 2)} м³/ч`,
      why: 'Источник физически не отдаёт столько воды. Давление в зоне просядет, дальние головы будут «плеваться», а насос при отборе выше дебита скважины хватает воздух и выходит из строя.',
      fix: 'Разделите зону: снимите головы так, чтобы расход не превышал 80 % дебита. Ставить более мощный насос бесполезно — воды в источнике от этого не прибавится.',
    });
  } else if (utilisation > SOURCE_UTILISATION) {
    addIssue({
      code: 'flow-over-80',
      severity: 'warning',
      what: `Зона забирает ${fmt(utilisation * 100, 0)} % дебита — выше правила 80 %`,
      why: 'Запас в 20 % закрывает сезонное падение уровня воды, износ насоса и загрязнение фильтра. Без него система работает нормально в мае и не тянет в августе.',
      fix: `Уберите из зоны голов на ${fmt((flowM3h - source * SOURCE_UTILISATION) * 1000, 0)} л/ч или перенесите часть в соседнюю зону.`,
    });
  }

  // ── 2. Однородность класса оборудования ───────────────────────────────────
  const classes = [...new Set(input.heads.map((h) => h.emitterClass))];
  if (classes.length > 1) {
    addIssue({
      code: 'mixed-emitter-classes',
      severity: 'error',
      what: `В зоне смешаны разные классы оборудования: ${classes.join(', ')}`,
      why: 'У спреев интенсивность 25–50 мм/ч, у роторов 8–18 мм/ч. За одно и то же время работы одна часть зоны получит воды втрое больше другой: там будет болото, а рядом — сухая трава. Временем полива это не лечится.',
      fix: 'Разнесите классы по разным зонам. Это правило без исключений: одна зона — один класс дождевателей.',
    });
  }

  // ── 3. Согласованность интенсивности (matched PR) ─────────────────────────
  const prValues = input.heads
    .map((h) => h.precipitationRateMmH)
    .filter((v): v is number => v !== undefined);
  let prSpread: number | null = null;
  if (prValues.length >= 2) {
    const mn = Math.min(...prValues);
    const mx = Math.max(...prValues);
    prSpread = mx > 0 ? ((mx - mn) / mx) * 100 : 0;
    log.step(
      'Разброс интенсивности между головами',
      'спред = (PR_макс − PR_мин) / PR_макс',
      `(${fmt(mx, 1)} − ${fmt(mn, 1)}) / ${fmt(mx, 1)}`,
      `${fmt(prSpread, 0)} %`,
    );
    if (prSpread > 20) {
      addIssue({
        code: 'unmatched-pr',
        severity: 'error',
        what: `Интенсивность голов различается на ${fmt(prSpread, 0)} %`,
        why: 'Сопла не согласованы по интенсивности. Чаще всего это полнокруговое сопло на угловой голове: сектор 90° получает вчетверо больше воды, чем должен.',
        fix: 'Поставьте комплект сопел с согласованной интенсивностью: сопло на 90° должно давать четверть расхода сопла на 360°.',
      });
    }
  }

  // ── 4. Гидравлика ветки ───────────────────────────────────────────────────
  const material: PipeMaterial = input.pipeMaterial ?? 'pe_new';
  const fr = frictionLoss({
    flowM3h,
    innerDiameterMm: dMm,
    lengthM,
    material,
  });
  const frictionM = fr.values.headLossM;
  const minorM = frictionM * share;
  const elevM = elev;
  const totalLossM = frictionM + minorM + elevM;
  const v = velocityMs(m3hToM3s(flowM3h), dMm / 1000);

  log.step(
    'Скорость в трубе зоны',
    'v = 4Q / (π · D²)',
    `Q = ${fmt(flowM3h, 2)} м³/ч, D = ${fmt(dMm, 1)} мм`,
    `${fmt(v, 2)} м/с`,
  );
  log.step(
    'Потери на трение до дальней головы',
    'hf = 10,67 · L · Q^1,852 / (C^1,852 · D^4,87)',
    `L = ${fmt(lengthM, 1)} м, C = ${fmt(fr.values.hazenWilliamsC, 0)}`,
    `${fmt(frictionM, 2)} м`,
  );
  log.step(
    'Местные потери и геодезия',
    'h_мест = hf · k;  h_геод = Δh',
    `${fmt(frictionM, 2)} · ${fmt(share, 2)} = ${fmt(minorM, 2)} м; перепад ${fmt(elevM, 2)} м`,
    `${fmt(minorM + elevM, 2)} м`,
  );
  log.step(
    'Суммарные потери зоны',
    'h_общ = hf + h_мест + h_геод',
    `${fmt(frictionM, 2)} + ${fmt(minorM, 2)} + ${fmt(elevM, 2)}`,
    `${fmt(totalLossM, 2)} м = ${fmt(mwcToBar(totalLossM), 2)} бар`,
  );

  if (v > VELOCITY_LIMITS.hardMax) {
    addIssue({
      code: 'zone-velocity-over-limit',
      severity: 'error',
      what: `Скорость в трубе ${fmt(v, 2)} м/с выше предела 2,0 м/с`,
      why: 'Растут потери, труба шумит, а при закрытии клапана гидроудар рвёт компрессионные фитинги.',
      fix: 'Возьмите трубу на типоразмер больше или разделите зону.',
    });
  } else if (v > VELOCITY_LIMITS.targetMax) {
    addIssue({
      code: 'zone-velocity-high',
      severity: 'warning',
      what: `Скорость в трубе ${fmt(v, 2)} м/с выше целевых 1,5 м/с`,
      why: 'Каждый лишний метр напора на трении вы оплачиваете насосом весь срок службы системы.',
      fix: 'Проверьте следующий типоразмер трубы.',
    });
  }

  // ── 5. Бюджет давления ────────────────────────────────────────────────────
  const requiredM = barToMwc(required);
  const lossShare = totalLossM / requiredM;
  const pressureAtHeadM = barToMwc(inlet) - totalLossM;
  const pressureAtHeadBar = mwcToBar(pressureAtHeadM);

  log.step(
    'Доля потерь от рабочего давления',
    'доля = h_общ / (P_раб · 10,2),  предел 20–25 %',
    `${fmt(totalLossM, 2)} / ${fmt(requiredM, 2)}`,
    `${fmt(lossShare * 100, 0)} %`,
  );
  log.step(
    'Давление у самой дальней головы',
    'P_дальней = P_входа − h_общ',
    `${fmt(barToMwc(inlet), 2)} − ${fmt(totalLossM, 2)}`,
    `${fmt(pressureAtHeadM, 2)} м = ${fmt(pressureAtHeadBar, 2)} бар`,
  );

  if (lossShare > ZONE_LOSS_BUDGET.max) {
    addIssue({
      code: 'loss-budget-exceeded',
      severity: 'error',
      what: `Потери составляют ${fmt(lossShare * 100, 0)} % рабочего давления при пределе 25 %`,
      why: 'Разница давления между первой и последней головой превращается в разницу радиусов: ближние поливают дальше расчёта, дальние не добивают. DU зоны падает, появляются сухие пятна.',
      fix: 'Увеличьте диаметр магистрали зоны, сократите длину ветки или разделите зону на две.',
    });
  } else if (lossShare > ZONE_LOSS_BUDGET.warn) {
    addIssue({
      code: 'loss-budget-warning',
      severity: 'warning',
      what: `Потери составляют ${fmt(lossShare * 100, 0)} % рабочего давления (ориентир — не более 20 %)`,
      why: 'Запас ещё есть, но при загрязнении фильтра или износе насоса зона первой начнёт недобирать давление.',
      fix: 'Если труба выбрана впритык, возьмите следующий типоразмер — это самая дешёвая страховка в системе.',
    });
  }

  if (pressureAtHeadBar < required) {
    addIssue({
      code: 'pressure-short-at-head',
      severity: 'error',
      what: `У дальней головы ${fmt(pressureAtHeadBar, 2)} бар при требуемых ${fmt(required, 2)} бар`,
      why: 'Ротору не хватает давления, чтобы разбить струю: вместо дождя получается «палка» воды с коротким радиусом, а сектор поливается неравномерно.',
      fix: `Не хватает ${fmt(required - pressureAtHeadBar, 2)} бар. Поднимите давление на входе, увеличьте диаметр трубы или уменьшите зону.`,
    });
  }

  if (elev > 0) {
    log.info(
      'elevation-cost',
      `Перепад высот ${fmt(elev, 1)} м съедает ${fmt(mwcToBar(elev), 2)} бар`,
      'Каждые 10 м высоты — примерно 1 бар. Геодезия не зависит от расхода: она вычитается всегда.',
    );
  }

  // ── 6. Интенсивность против впитывания ────────────────────────────────────
  const pr = flowLph / area;
  log.step(
    'Интенсивность зоны',
    'PR = Q_зоны [л/ч] / A_зоны [м²]',
    `${fmt(flowLph, 0)} / ${fmt(area, 1)}`,
    `${fmt(pr, 1)} мм/ч`,
  );

  if (input.soilInfiltrationMmH !== undefined) {
    const inf = requirePositive(input.soilInfiltrationMmH, 'Скорость впитывания');
    if (pr > inf) {
      addIssue({
        code: 'pr-over-infiltration',
        severity: 'warning',
        what: `Интенсивность ${fmt(pr, 1)} мм/ч выше впитывания почвы ${fmt(inf, 1)} мм/ч`,
        why: 'Вода подаётся быстрее, чем почва её принимает: излишек стекает или стоит лужей, корневая зона остаётся сухой, а на счётчике всё выглядит благополучно.',
        fix: `Разбейте полив на ${Math.max(2, Math.ceil(pr / inf))} цикла с паузой 30–60 минут (cycle & soak).`,
      });
    }
  }

  // ── 7. Электрика ──────────────────────────────────────────────────────────
  let cableDrop: number | null = null;
  if (input.cableLengthM !== undefined && input.cableCrossSectionMm2 !== undefined) {
    const l = requirePositive(input.cableLengthM, 'Длина кабеля');
    const s = requirePositive(input.cableCrossSectionMm2, 'Сечение жилы');
    const i = input.solenoidCurrentA ?? VALVE_CABLE.inrushCurrentA.max - 0.05;
    cableDrop = voltageDropV(l, i, s);
    log.step(
      'Падение напряжения на кабеле клапана',
      'ΔU = 2 · L · I · ρ / S',
      `2 · ${fmt(l, 0)} · ${fmt(i, 2)} · 0,0175 / ${fmt(s, 2)}`,
      `${fmt(cableDrop, 2)} В`,
    );
    if (cableDrop > VALVE_CABLE.maxDropV) {
      addIssue({
        code: 'cable-drop-high',
        severity: 'error',
        what: `Падение напряжения ${fmt(cableDrop, 2)} В выше допустимых ${fmt(VALVE_CABLE.maxDropV, 1)} В`,
        why: 'Соленоиду не хватит напряжения на пуск: клапан не откроется или будет гудеть и дребезжать, разрушая мембрану.',
        fix: `Возьмите жилу не менее ${fmt(Math.ceil(((2 * l * i * 0.0175) / VALVE_CABLE.maxDropV) * 10) / 10, 1)} мм² или перенесите контроллер ближе.`,
      });
    }
  }

  const passed = issues.every((i) => i.severity !== 'error');
  if (passed && issues.length === 0) {
    log.info('zone-ok', `Зона «${input.zoneName}» проходит все проверки`);
  }

  return {
    values: {
      zoneName: input.zoneName,
      headCount: input.heads.length,
      zoneFlowM3h: round(flowM3h, 3),
      zoneFlowLph: round(flowLph, 0),
      sourceUtilisation: round(utilisation, 3),
      precipitationRateMmH: round(pr, 2),
      velocityMs: round(v, 2),
      frictionLossM: round(frictionM, 2),
      minorLossM: round(minorM, 2),
      elevationLossM: round(elevM, 2),
      totalLossM: round(totalLossM, 2),
      lossShareOfWorkingPressure: round(lossShare, 3),
      pressureAtFarthestHeadBar: round(pressureAtHeadBar, 3),
      cableDropV: cableDrop === null ? null : round(cableDrop, 2),
      emitterClassesUsed: classes,
      prSpreadPercent: prSpread === null ? null : round(prSpread, 1),
      passed,
      issues,
    },
    steps: log.steps,
    notes: log.notes,
  };
}
