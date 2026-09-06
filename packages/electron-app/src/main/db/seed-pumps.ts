import { readFileSync, existsSync } from 'node:fs';
import type { Db } from './connection.js';

/**
 * Наполнение каталогов насосов из `content/reference/pumps.json` (§5.11).
 *
 * Файл собирается скриптом `scripts/extract-pump-catalogs.ts` из PDF в
 * `/content`. Здесь только перенос в базу с проверками, которые не пропускают
 * данные, на которые нельзя опираться при подборе:
 *
 *  — кривая короче двух точек: интерполировать не по чему;
 *  — кривая растёт: напор насоса не может увеличиваться с расходом, значит
 *    в столбцы попала чужая строка;
 *  — пустой источник или отсутствие пояснения у оцифрованной кривой.
 *
 * Отчёт о самих файлах (что разобрано, что пропущено и почему) переносится в
 * `app_meta`: пользователь должен видеть, каких каталогов в подборе нет.
 */

interface RawPoint {
  qM3h: number;
  hM: number;
}

interface RawPump {
  brand: string;
  model: string;
  altModel?: string;
  series: string;
  type: 'surface' | 'submersible' | 'multistage' | 'booster_station';
  powerKwMin: number | null;
  powerKwMax: number | null;
  powerHp: number | null;
  voltage: string;
  qMaxM3h: number;
  hMaxM: number;
  sourceFile: string;
  sourcePage: number;
  digitized: boolean;
  digitizedNote?: string;
  curve: RawPoint[];
}

interface FileReport {
  file: string;
  pages: number;
  pagesWithText: number;
  pumps: number;
  status: 'parsed' | 'skipped';
  reason?: string;
}

interface PumpsFile {
  note: string;
  extractedAt: string;
  files: FileReport[];
  pumps: RawPump[];
}

export const PUMP_TABLES = ['pump_curve_points', 'pumps'] as const;

/** Ключ в `app_meta`, где лежит отчёт об источниках каталогов. */
export const PUMP_SOURCES_META_KEY = 'pump_sources';

function filePath(contentDirPath: string): string {
  return `${contentDirPath}/reference/pumps.json`;
}

export function pumpsSignature(contentDirPath: string): string {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 'empty';
  const data = JSON.parse(readFileSync(path, 'utf8')) as PumpsFile;
  const points = data.pumps.reduce((sum, p) => sum + p.curve.length, 0);
  return `${data.extractedAt}:${data.pumps.length}:${points}`;
}

export interface PumpSeedInfo {
  pumps: number;
  points: number;
  reportJson: string;
}

export function seedPumps(db: Db, contentDirPath: string): PumpSeedInfo {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return { pumps: 0, points: 0, reportJson: '[]' };

  const data = JSON.parse(readFileSync(path, 'utf8')) as PumpsFile;

  const insertPump = db.prepare(`
    INSERT INTO pumps
      (brand, model, alt_model, series, type, power_kw_min, power_kw_max, power_hp,
       voltage, q_max_m3h, h_max_m, source_file, source_page, digitized, digitized_note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPoint = db.prepare(
    'INSERT INTO pump_curve_points (pump_id, q_m3h, h_m, point_order) VALUES (?, ?, ?, ?)',
  );

  let pumps = 0;
  let points = 0;

  for (const pump of data.pumps) {
    const curve = [...pump.curve].sort((a, b) => a.qM3h - b.qM3h);

    if (curve.length < 2) {
      throw new Error(`${pump.model}: кривая из ${curve.length} точек — подбирать не по чему`);
    }
    const falls = curve.every((p, i) => i === 0 || p.hM <= curve[i - 1]!.hM);
    if (!falls) {
      throw new Error(`${pump.model}: напор растёт с расходом — кривая разобрана неверно`);
    }
    if (!pump.sourceFile?.trim()) {
      throw new Error(`${pump.model}: не указан файл-источник`);
    }
    if (pump.digitized && !pump.digitizedNote?.trim()) {
      throw new Error(`${pump.model}: кривая снята с графика, но не сказано как`);
    }

    const info = insertPump.run(
      pump.brand,
      pump.model,
      pump.altModel ?? null,
      pump.series,
      pump.type,
      pump.powerKwMin,
      pump.powerKwMax,
      pump.powerHp,
      pump.voltage,
      curve[curve.length - 1]!.qM3h,
      curve[0]!.hM,
      pump.sourceFile,
      pump.sourcePage,
      pump.digitized ? 1 : 0,
      pump.digitizedNote ?? null,
    );

    const pumpId = Number(info.lastInsertRowid);
    curve.forEach((point, index) => {
      insertPoint.run(pumpId, point.qM3h, point.hM, index);
      points += 1;
    });
    pumps += 1;
  }

  return { pumps, points, reportJson: JSON.stringify(data.files) };
}
