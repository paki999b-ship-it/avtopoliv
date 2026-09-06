import {
  PUMP_MAX_HEAD_OVERHEAD,
  PUMP_MIN_FLOW_SHARE,
  buildSystemCurve,
  selectCatalogPumps,
} from '@irrigo/core';
import type { CatalogPump } from '@irrigo/core';
import type { Db } from '../connection.js';
import { getMeta } from '../connection.js';
import { PUMP_SOURCES_META_KEY } from '../seed-pumps.js';
import type {
  PumpDto,
  PumpSelectionRequest,
  PumpSelectionResult,
  PumpSourceReport,
  PumpType,
} from '../../../shared/pumps.js';

/**
 * Каталоги насосов (§5.11).
 *
 * Подбор делает движок `@irrigo/core`: интерфейс присылает требуемую точку и
 * получает готовый список. Здесь только чтение кривых из базы и перевод их в
 * форму, которую понимает движок.
 */

interface PumpRow {
  id: number;
  brand: string;
  model: string;
  alt_model: string | null;
  series: string;
  type: PumpType;
  power_kw_min: number | null;
  power_kw_max: number | null;
  power_hp: number | null;
  voltage: string;
  q_max_m3h: number;
  h_max_m: number;
  source_file: string;
  source_page: number;
  digitized: number;
  digitized_note: string | null;
}

const PUMP_SELECT = `
  SELECT id, brand, model, alt_model, series, type, power_kw_min, power_kw_max,
         power_hp, voltage, q_max_m3h, h_max_m, source_file, source_page,
         digitized, digitized_note
  FROM pumps
`;

function curveOf(db: Db, pumpId: number): Array<{ qM3h: number; hM: number }> {
  const rows = db
    .prepare(
      'SELECT q_m3h, h_m FROM pump_curve_points WHERE pump_id = ? ORDER BY point_order, q_m3h',
    )
    .all(pumpId) as unknown as Array<{ q_m3h: number; h_m: number }>;

  return rows.map((r) => ({ qM3h: Number(r.q_m3h), hM: Number(r.h_m) }));
}

function toDto(db: Db, row: PumpRow): PumpDto {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    altModel: row.alt_model,
    series: row.series,
    type: row.type,
    powerKwMin: row.power_kw_min,
    powerKwMax: row.power_kw_max,
    powerHp: row.power_hp,
    voltage: row.voltage,
    qMaxM3h: Number(row.q_max_m3h),
    hMaxM: Number(row.h_max_m),
    sourceFile: row.source_file,
    sourcePage: row.source_page,
    digitized: row.digitized === 1,
    digitizedNote: row.digitized_note,
    curve: curveOf(db, row.id),
  };
}

export function pumpSources(db: Db): PumpSourceReport[] {
  const raw = getMeta(db, PUMP_SOURCES_META_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PumpSourceReport[];
  } catch {
    return [];
  }
}

export function pump(db: Db, id: number): PumpDto {
  const row = db.prepare(`${PUMP_SELECT} WHERE id = ?`).get(id) as unknown as PumpRow | undefined;
  if (!row) throw new Error(`Насос ${id} не найден.`);
  return toDto(db, row);
}

/**
 * Подбор насосов под требуемую точку.
 *
 * Кривые читаются целиком: их несколько сотен, и выборка «по габаритам» здесь
 * ничего не ускорит, зато может отсечь насос, который в требуемой точке
 * подходит, — граничные значения `q_max`/`h_max` описывают только концы
 * кривой, а не её ход.
 */
export function selectPumps(db: Db, request: PumpSelectionRequest): PumpSelectionResult {
  const rows = db.prepare(PUMP_SELECT).all() as unknown as PumpRow[];

  const catalog: CatalogPump[] = rows.map((row) => {
    const dto = toDto(db, row);
    return {
      id: dto.id,
      brand: dto.brand,
      model: dto.model,
      type: dto.type,
      powerKwMin: dto.powerKwMin,
      powerKwMax: dto.powerKwMax,
      voltage: dto.voltage,
      digitized: dto.digitized,
      sourceFile: dto.sourceFile,
      sourcePage: dto.sourcePage,
      curve: dto.curve.map((p) => ({ flowM3h: p.qM3h, headM: p.hM })),
    };
  });

  const system = buildSystemCurve(
    Math.max(0, request.staticHeadM),
    Math.max(0.01, request.flowM3h),
    Math.max(0, request.designLossM),
  );

  const matches = selectCatalogPumps(catalog, {
    flowM3h: request.flowM3h,
    headM: request.headM,
    system,
    ...(request.type ? { type: request.type } : {}),
  });

  const byId = new Map(rows.map((r) => [r.id, r]));

  return {
    matches: matches.map((m) => ({
      pump: toDto(db, byId.get(m.pump.id)!),
      headAtRequiredM: m.headAtRequiredM,
      marginM: m.marginM,
      marginRatio: m.marginRatio,
      flowShare: m.flowShare,
      operatingPoint: m.operatingPoint
        ? { qM3h: m.operatingPoint.flowM3h, hM: m.operatingPoint.headM }
        : null,
    })),
    catalogSize: rows.length,
    maxOverhead: PUMP_MAX_HEAD_OVERHEAD,
    minFlowShare: PUMP_MIN_FLOW_SHARE,
    sources: pumpSources(db),
  };
}
