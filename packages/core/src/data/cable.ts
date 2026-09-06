/**
 * Справочник «Кабель»: максимальные длины по сечению и токовой нагрузке
 * (§3.3.6, §7 таблица `cable_table`).
 *
 * ── ИСТОЧНИК ───────────────────────────────────────────────────────────────
 * Таблица не взята откуда-то готовой, а вычисляется из формулы §5.12 той же
 * функцией, что и калькулятор:
 *
 *     ΔU = 2 · L · I · ρ / S   →   L_макс = ΔU_доп · S / (2 · I · ρ)
 *
 * при ρ_медь = 0,0175 Ом·мм²/м и допуске ΔU ≤ 2,4 В (10 % от 24 В).
 * Поэтому справочник и калькулятор не могут разойтись: разойтись просто нечему.
 *
 * ── ТОК СОЛЕНОИДА ──────────────────────────────────────────────────────────
 * Считается по пусковому току, а не по току удержания: если напряжения не
 * хватит в момент открытия, клапан не откроется вовсе, сколько бы он потом
 * ни держал.
 *
 * Каталог Hunter, издание 41 (RU), стр. 87, 88, 90 приводит для стандартного
 * электромагнита 24 В переменного тока:
 *   при 60 Гц — пусковой 350 мА, удержание 190 мА;
 *   при 50 Гц — пусковой 370 мА, удержание 210 мА.
 * В сети 50 Гц ток выше, поэтому за основу таблицы взяты 0,37 А на клапан.
 *
 * Длина округляется ВНИЗ до целого метра: округление вверх выдавало бы длину,
 * на которой допуск 2,4 В уже нарушен.
 */

import { COPPER_RESISTIVITY, VALVE_CABLE } from '../constants.js';

/** Пусковой ток одного соленоида 24 В AC в сети 50 Гц, А. */
export const SOLENOID_INRUSH_50HZ_A = 0.37;

/** Ток удержания одного соленоида 24 В AC в сети 50 Гц, А. */
export const SOLENOID_HOLDING_50HZ_A = 0.21;

/** Ряд сечений медной жилы поливочного кабеля, мм². */
export const CABLE_CROSS_SECTIONS_MM2 = [0.5, 0.75, 1.0, 1.5, 2.5] as const;

export interface CableRow {
  crossSectionMm2: number;
  /** Расчётный ток, А. */
  currentA: number;
  /** Сколько соленоидов этот ток покрывает при 0,37 А на клапан. */
  solenoids: number;
  /** Максимальная длина трассы в одну сторону, м. */
  maxLengthM: number;
  note: string;
  source: string;
}

const SOURCE =
  'Расчёт по формуле ТЗ §5.12 (ΔU = 2·L·I·ρ/S, ρ_медь = 0,0175 Ом·мм²/м, ' +
  'допуск 2,4 В); пусковой ток соленоида — каталог Hunter, издание 41 (RU), ' +
  'стр. 87, 88, 90 (0,37 А при 50 Гц)';

/**
 * Максимальная длина трассы при заданных сечении и токе.
 * Округление вниз: на длине, полученной округлением вверх, допуск уже нарушен.
 */
export function maxCableLengthM(
  crossSectionMm2: number,
  currentA: number,
  resistivity = COPPER_RESISTIVITY,
): number {
  if (crossSectionMm2 <= 0) throw new Error('Сечение должно быть больше нуля');
  if (currentA <= 0) throw new Error('Ток должен быть больше нуля');
  const exact = (VALVE_CABLE.maxDropV * crossSectionMm2) / (2 * currentA * resistivity);
  return Math.floor(exact);
}

function buildTable(): CableRow[] {
  const rows: CableRow[] = [];

  for (const section of CABLE_CROSS_SECTIONS_MM2) {
    for (const solenoids of [1, 2, 3, 4]) {
      const currentA = Math.round(solenoids * SOLENOID_INRUSH_50HZ_A * 100) / 100;
      rows.push({
        crossSectionMm2: section,
        currentA,
        solenoids,
        maxLengthM: maxCableLengthM(section, currentA),
        note:
          solenoids === 1
            ? 'Жила до одного клапана.'
            : `Общий (нулевой) провод при ${solenoids} одновременно открытых клапанах — ` +
              'зонный плюс мастер-клапан и так далее.',
        source: SOURCE,
      });
    }
  }

  return rows;
}

export const CABLE_TABLE: CableRow[] = buildTable();

/** Строки для одного сечения — как их показывает справочник. */
export function cableRowsForSection(crossSectionMm2: number): CableRow[] {
  return CABLE_TABLE.filter((r) => r.crossSectionMm2 === crossSectionMm2);
}

/**
 * Минимальное сечение из ряда, которого хватает на заданные длину и ток.
 * Возвращает `null`, если не хватает даже самого толстого.
 */
export function minimumCrossSection(lengthM: number, currentA: number): number | null {
  for (const section of CABLE_CROSS_SECTIONS_MM2) {
    if (maxCableLengthM(section, currentA) >= lengthM) return section;
  }
  return null;
}
