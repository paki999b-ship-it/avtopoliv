/**
 * §5.12. Падение напряжения на клапанном кабеле (24 В AC).
 *
 *   ΔU = 2 · L · I · ρ / S,  ρ_медь = 0,0175 Ом·мм²/м
 *   Допустимо ΔU ≤ 2,4 В (10 % от 24 В)
 *   Ток соленоида: пусковой 0,3–0,4 А, удержание 0,2–0,25 А
 *
 * Отдельный режим: расчёт общего (нулевого) провода по сумме токов
 * одновременно открытых клапанов и подбор трансформатора с запасом 30 %.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ (ТЗ §10 п.3): расчёт и схема — да, выполнение
 * работ на 220/380 В — только квалифицированный электрик.
 */

import { COPPER_RESISTIVITY, VALVE_CABLE } from '../constants.js';
import { fmt, round } from '../format.js';
import { StepLog, requirePositive, requireRange, requireNonNegative } from '../internal/build.js';
import type { CalcResult } from '../types.js';

export interface VoltageDropInput {
  /** Длина трассы кабеля в одну сторону, м. */
  lengthM: number;
  /** Сечение жилы, мм². */
  crossSectionMm2: number;
  /** Ток соленоида, А. По умолчанию 0,35 (пусковой). */
  currentA?: number;
  /** Напряжение источника, В. По умолчанию 24. */
  supplyVoltageV?: number;
  /** Удельное сопротивление, Ом·мм²/м. По умолчанию медь 0,0175. */
  resistivity?: number;
}

export interface VoltageDropValues {
  dropV: number;
  dropPercent: number;
  voltageAtValveV: number;
  acceptable: boolean;
  /** Максимальная длина при этом сечении и токе, м. */
  maxLengthM: number;
  /** Минимальное сечение для этой длины, мм². */
  requiredCrossSectionMm2: number;
}

/** ΔU = 2 · L · I · ρ / S. */
export function voltageDropV(
  lengthM: number,
  currentA: number,
  crossSectionMm2: number,
  resistivity = COPPER_RESISTIVITY,
): number {
  return (2 * lengthM * currentA * resistivity) / crossSectionMm2;
}

export function valveCableDrop(input: VoltageDropInput): CalcResult<VoltageDropValues> {
  const length = requirePositive(input.lengthM, 'Длина кабеля');
  const s = requirePositive(input.crossSectionMm2, 'Сечение жилы');
  const i = requireRange(input.currentA ?? VALVE_CABLE.inrushCurrentA.max - 0.05, 0.01, 10, 'Ток');
  const u = requirePositive(input.supplyVoltageV ?? VALVE_CABLE.nominalVoltage, 'Напряжение');
  const rho = requirePositive(input.resistivity ?? COPPER_RESISTIVITY, 'Удельное сопротивление');

  const log = new StepLog();
  const drop = voltageDropV(length, i, s, rho);
  const percent = (drop / u) * 100;
  const allowed = (u * VALVE_CABLE.maxDropPercent) / 100;
  const maxLength = (allowed * s) / (2 * i * rho);
  const requiredS = (2 * length * i * rho) / allowed;

  log.step(
    'Падение напряжения',
    'ΔU = 2 · L · I · ρ / S',
    `2 · ${fmt(length, 0)} · ${fmt(i, 2)} · ${fmt(rho, 4)} / ${fmt(s, 2)}`,
    `${fmt(drop, 2)} В`,
  );
  log.step(
    'В процентах от питания',
    'ΔU% = ΔU / U · 100',
    `${fmt(drop, 2)} / ${fmt(u, 0)} · 100`,
    `${fmt(percent, 1)} %`,
  );
  log.step(
    'Напряжение на клапане',
    'U_клапана = U − ΔU',
    `${fmt(u, 0)} − ${fmt(drop, 2)}`,
    `${fmt(u - drop, 1)} В`,
  );
  log.step(
    'Максимальная длина при этом сечении',
    'L_макс = ΔU_доп · S / (2 · I · ρ)',
    `${fmt(allowed, 2)} · ${fmt(s, 2)} / (2 · ${fmt(i, 2)} · ${fmt(rho, 4)})`,
    `${fmt(maxLength, 0)} м`,
  );
  log.step(
    'Минимальное сечение для этой длины',
    'S_мин = 2 · L · I · ρ / ΔU_доп',
    `2 · ${fmt(length, 0)} · ${fmt(i, 2)} · ${fmt(rho, 4)} / ${fmt(allowed, 2)}`,
    `${fmt(requiredS, 2)} мм²`,
  );

  const acceptable = drop <= allowed;
  if (!acceptable) {
    log.error(
      'drop-too-high',
      `Падение ${fmt(drop, 2)} В превышает допустимые ${fmt(allowed, 2)} В`,
      'Соленоиду не хватит напряжения, чтобы поднять шток: клапан либо не откроется вовсе, либо будет дребезжать и гудеть, разрушая мембрану. Классическая ошибка — кабель 0,5 мм² на 150 м.',
      `Возьмите жилу не менее ${fmt(Math.ceil(requiredS * 10) / 10, 1)} мм², либо продублируйте жилу, либо перенесите контроллер ближе к боксам.`,
    );
  } else {
    log.info(
      'drop-ok',
      `Падение ${fmt(drop, 2)} В (${fmt(percent, 1)} %) в пределах нормы`,
      `Запас по длине: до ${fmt(maxLength, 0)} м при этом сечении.`,
    );
  }

  log.info(
    'inrush-vs-holding',
    'Считайте по пусковому току, а не по току удержания',
    'Пусковой ток соленоида 0,3–0,4 А, удержание 0,2–0,25 А. Клапан, которому хватает напряжения на удержание, но не хватает на пуск, просто не откроется.',
  );

  return {
    values: {
      dropV: round(drop, 3),
      dropPercent: round(percent, 2),
      voltageAtValveV: round(u - drop, 2),
      acceptable,
      maxLengthM: Math.floor(maxLength),
      requiredCrossSectionMm2: round(requiredS, 3),
    },
    steps: log.steps,
    notes: log.notes,
  };
}

// ── Общий провод и трансформатор ────────────────────────────────────────────

export interface CommonWireValve {
  name: string;
  lengthM: number;
  currentA?: number;
}

export interface CommonWireInput {
  /** Клапаны, которые могут быть открыты одновременно. */
  simultaneousValves: CommonWireValve[];
  /** Сечение общего провода, мм². */
  commonCrossSectionMm2: number;
  /** Длина общего провода до самой дальней точки, м. */
  commonLengthM: number;
  /** Есть мастер-клапан, открытый всё время полива. */
  masterValve?: boolean;
  supplyVoltageV?: number;
  /** Запас трансформатора, доля. По умолчанию 0,3 (30 %). */
  transformerReserve?: number;
}

export interface CommonWireValues {
  totalCurrentA: number;
  commonWireDropV: number;
  /** Полное падение до худшего клапана (жила + общий), В. */
  worstCaseDropV: number;
  worstValveName: string;
  acceptable: boolean;
  /** Требуемая мощность трансформатора, ВА. */
  transformerVa: number;
  /** С запасом, ВА. */
  transformerWithReserveVa: number;
}

export function commonWireAndTransformer(input: CommonWireInput): CalcResult<CommonWireValues> {
  const valves = input.simultaneousValves;
  if (valves.length === 0) throw new Error('Не задан ни один клапан');
  const sCommon = requirePositive(input.commonCrossSectionMm2, 'Сечение общего провода');
  const lCommon = requirePositive(input.commonLengthM, 'Длина общего провода');
  const u = requirePositive(input.supplyVoltageV ?? VALVE_CABLE.nominalVoltage, 'Напряжение');
  const reserve = requireRange(input.transformerReserve ?? 0.3, 0, 1, 'Запас трансформатора');

  const log = new StepLog();
  const currents = valves.map((v) => v.currentA ?? VALVE_CABLE.inrushCurrentA.max - 0.05);
  const master = input.masterValve ? VALVE_CABLE.inrushCurrentA.max - 0.05 : 0;
  const total = currents.reduce((a, b) => a + b, 0) + master;

  log.step(
    'Суммарный ток одновременно открытых клапанов',
    'I_общ = Σ I_клапанов (+ мастер-клапан)',
    `${currents.map((c) => fmt(c, 2)).join(' + ')}${master ? ` + ${fmt(master, 2)}` : ''}`,
    `${fmt(total, 2)} А`,
  );

  // Общий провод несёт сумму токов — падение считается один раз, «в одну сторону».
  const commonDrop = (lCommon * total * COPPER_RESISTIVITY) / sCommon;
  log.step(
    'Падение на общем проводе',
    'ΔU_общ = L · I_общ · ρ / S',
    `${fmt(lCommon, 0)} · ${fmt(total, 2)} · 0,0175 / ${fmt(sCommon, 2)}`,
    `${fmt(commonDrop, 2)} В`,
  );

  let worstDrop = 0;
  let worstName = valves[0]!.name;
  valves.forEach((v, idx) => {
    const i = currents[idx]!;
    const own = (v.lengthM * i * COPPER_RESISTIVITY) / sCommon;
    const totalDrop = own + commonDrop;
    if (totalDrop > worstDrop) {
      worstDrop = totalDrop;
      worstName = v.name;
    }
  });

  log.step(
    'Худший клапан по суммарному падению',
    'ΔU = ΔU_жилы + ΔU_общего',
    `клапан «${worstName}»`,
    `${fmt(worstDrop, 2)} В`,
  );

  const allowed = (u * VALVE_CABLE.maxDropPercent) / 100;
  const acceptable = worstDrop <= allowed;

  if (!acceptable) {
    log.error(
      'common-drop-high',
      `Падение до клапана «${worstName}» ${fmt(worstDrop, 2)} В выше допустимых ${fmt(allowed, 2)} В`,
      'Общий провод несёт ток всех одновременно открытых клапанов, поэтому именно он чаще всего оказывается узким местом, а не жила конкретной зоны.',
      'Увеличьте сечение общего провода или продублируйте его второй жилой — это дешевле, чем перекладывать весь кабель.',
    );
  } else {
    log.info('common-drop-ok', `Суммарное падение ${fmt(worstDrop, 2)} В в пределах нормы`);
  }

  const va = total * u;
  const vaReserve = va * (1 + reserve);

  log.step(
    'Мощность трансформатора',
    'S [ВА] = I_общ · U',
    `${fmt(total, 2)} · ${fmt(u, 0)}`,
    `${fmt(va, 1)} ВА`,
  );
  log.step(
    'С запасом',
    'S_выбор = S · (1 + запас)',
    `${fmt(va, 1)} · (1 + ${fmt(reserve, 2)})`,
    `${fmt(vaReserve, 1)} ВА`,
  );

  if (input.masterValve) {
    log.info(
      'master-valve-load',
      'Мастер-клапан открыт всё время полива — его ток учтён постоянно',
      'Забыть мастер-клапан в расчёте нагрузки — типовая причина «контроллер иногда не открывает последнюю зону».',
    );
  }

  log.info(
    'electrical-scope',
    'Это расчёт слаботочной части 24 В',
    'Подключение трансформатора и насоса к сети 220/380 В, УЗО 30 мА, заземление и класс IP щита — зона ответственности квалифицированного электрика.',
    'Приложение даёт расчёт и схему, но не заменяет электрика и не является допуском к работам.',
  );

  return {
    values: {
      totalCurrentA: round(total, 3),
      commonWireDropV: round(commonDrop, 3),
      worstCaseDropV: round(worstDrop, 3),
      worstValveName: worstName,
      acceptable,
      transformerVa: round(va, 1),
      transformerWithReserveVa: round(vaReserve, 1),
    },
    steps: log.steps,
    notes: log.notes,
  };
}

/**
 * Таблица максимальных длин по сечению и току — справочник `cable_table` (§7).
 * Значения расчётные, из той же формулы ΔU = 2·L·I·ρ/S при ΔU ≤ 2,4 В.
 */
export function cableLengthTable(
  crossSections = [0.5, 0.75, 1.0, 1.5, 2.5],
  currents = [0.25, 0.35, 0.5, 0.7, 1.0],
): { crossSectionMm2: number; currentA: number; maxLengthM: number }[] {
  const allowed = VALVE_CABLE.maxDropV;
  const rows: { crossSectionMm2: number; currentA: number; maxLengthM: number }[] = [];
  for (const s of crossSections) {
    for (const i of currents) {
      requireNonNegative(i, 'Ток');
      rows.push({
        crossSectionMm2: s,
        currentA: i,
        maxLengthM: Math.floor((allowed * s) / (2 * i * COPPER_RESISTIVITY)),
      });
    }
  }
  return rows;
}
