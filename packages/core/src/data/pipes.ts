/**
 * Сортамент труб для подбора диаметра (§5.4) и справочника «Трубы» (§3.3.2).
 *
 * ── ИСТОЧНИКИ (ТЗ §0 п.6, §7) ──────────────────────────────────────────────
 * Полиэтилен: ГОСТ 18599-2001, таблица 4 «Размеры и максимальные рабочие
 * давления труб из полиэтилена ПЭ 100». Весь ряд SDR11 и SDR17 сверен построчно
 * с опубликованным текстом таблицы.
 *
 * ПВХ: ISO 1452-2:2009, Table 2 «Nominal (minimum) wall thicknesses», серии
 * S 10 (SDR 21) и S 6,3 (SDR 13,6). Сверено по официальному тексту стандарта.
 * Привязка PN к SDR зависит от коэффициента запаса C: при C = 2,5 (применяется
 * к трубам номинальным диаметром свыше 90 мм) SDR 21 = PN10, SDR 13,6 = PN16 —
 * эти значения и приняты. При C = 2,0 тот же ряд маркируется как PN12,5 и PN20,
 * то есть принятая маркировка — консервативная.
 *
 * Инвариант, который проверяется юнит-тестом: номинальная толщина стенки не
 * меньше расчётной D/SDR (с допуском 0,05 мм на округление ряда) и не
 * превышает её более чем на 0,5 мм.
 *
 * Замечание, снятое сверкой: ПЭ100 SDR11 Ø75 имеет толщину 6,8 мм при
 * D/SDR = 6,818 мм. Инвариант помечал строку как подозрительную, но таблица 4
 * ГОСТ 18599-2001 подтверждает именно 6,8 мм: ряд толщин ISO 4065 округлён и не
 * выводится из D/SDR арифметически.
 */

import type { PipeMaterial } from '../types.js';

export type PipeStandard = 'PE100 SDR11' | 'PE100 SDR17' | 'PVC PN10' | 'PVC PN16';

export interface PipeSpec {
  /** Ключ строки: `pe100-sdr11-63`. */
  key: string;
  standard: PipeStandard;
  material: PipeMaterial;
  /** Наружный диаметр, мм. */
  odMm: number;
  /** Номинальная толщина стенки, мм. */
  wallMm: number;
  /** Внутренний диаметр, мм (расчётный: OD − 2·e). */
  idMm: number;
  /** Отношение наружного диаметра к толщине стенки. */
  sdr: number;
  /** Номинальное давление, бар. */
  pnBar: number;
  source: string;
  sourceStatus: 'verified' | 'to_verify';
}

interface RawRow {
  od: number;
  wall: number;
}

const PE_SOURCE =
  'ГОСТ 18599-2001, таблица 4 «Размеры и максимальные рабочие давления труб из полиэтилена ПЭ 100»';
const PVC_SOURCE =
  'ISO 1452-2:2009, Table 2 «Nominal (minimum) wall thicknesses» (PN по коэффициенту запаса C = 2,5)';

const PE100_SDR11: RawRow[] = [
  { od: 20, wall: 2.0 },
  { od: 25, wall: 2.3 },
  { od: 32, wall: 3.0 },
  { od: 40, wall: 3.7 },
  { od: 50, wall: 4.6 },
  { od: 63, wall: 5.8 },
  { od: 75, wall: 6.8 },
  { od: 90, wall: 8.2 },
  { od: 110, wall: 10.0 },
  { od: 125, wall: 11.4 },
  { od: 140, wall: 12.7 },
  { od: 160, wall: 14.6 },
];

const PE100_SDR17: RawRow[] = [
  { od: 50, wall: 3.0 },
  { od: 63, wall: 3.8 },
  { od: 75, wall: 4.5 },
  { od: 90, wall: 5.4 },
  { od: 110, wall: 6.6 },
  { od: 125, wall: 7.4 },
  { od: 140, wall: 8.3 },
  { od: 160, wall: 9.5 },
  { od: 180, wall: 10.7 },
  { od: 200, wall: 11.9 },
  { od: 225, wall: 13.4 },
];

const PVC_PN10: RawRow[] = [
  { od: 50, wall: 2.4 },
  { od: 63, wall: 3.0 },
  { od: 75, wall: 3.6 },
  { od: 90, wall: 4.3 },
  { od: 110, wall: 5.3 },
  { od: 125, wall: 6.0 },
  { od: 140, wall: 6.7 },
  { od: 160, wall: 7.7 },
];

const PVC_PN16: RawRow[] = [
  { od: 50, wall: 3.7 },
  { od: 63, wall: 4.7 },
  { od: 75, wall: 5.6 },
  { od: 90, wall: 6.7 },
  { od: 110, wall: 8.1 },
  { od: 125, wall: 9.2 },
  { od: 160, wall: 11.8 },
];

function build(
  rows: RawRow[],
  standard: PipeStandard,
  material: PipeMaterial,
  sdr: number,
  pnBar: number,
  source: string,
  keyPrefix: string,
): PipeSpec[] {
  return rows.map((r) => ({
    key: `${keyPrefix}-${r.od}`,
    standard,
    material,
    odMm: r.od,
    wallMm: r.wall,
    idMm: Math.round((r.od - 2 * r.wall) * 100) / 100,
    sdr,
    pnBar,
    source,
    sourceStatus: 'verified' as const,
  }));
}

/** Полный сортамент, доступный подбору диаметра и справочнику. */
export const PIPE_CATALOG: PipeSpec[] = [
  ...build(PE100_SDR11, 'PE100 SDR11', 'pe_new', 11, 16, PE_SOURCE, 'pe100-sdr11'),
  ...build(PE100_SDR17, 'PE100 SDR17', 'pe_new', 17, 10, PE_SOURCE, 'pe100-sdr17'),
  ...build(PVC_PN10, 'PVC PN10', 'pvc_new', 21, 10, PVC_SOURCE, 'pvc-pn10'),
  ...build(PVC_PN16, 'PVC PN16', 'pvc_new', 13.6, 16, PVC_SOURCE, 'pvc-pn16'),
];

export function pipesByStandard(standard: PipeStandard): PipeSpec[] {
  return PIPE_CATALOG.filter((p) => p.standard === standard).sort((a, b) => a.odMm - b.odMm);
}

export function findPipe(key: string): PipeSpec | undefined {
  return PIPE_CATALOG.find((p) => p.key === key);
}

/**
 * Резервный расчёт толщины стенки, если строки нет в сортаменте:
 * e = D/SDR с округлением вверх до 0,1 мм, минимум 2,0 мм (ISO 4427-2).
 */
export function nominalWallMm(odMm: number, sdr: number): number {
  return Math.max(2.0, Math.ceil((odMm / sdr) * 10) / 10);
}
