import { readFileSync, existsSync } from 'node:fs';
import type { Db } from './connection.js';

/**
 * Перечень оборудования из каталога производителя (§3.3).
 *
 * Файл собирается скриптом `scripts/extract-hunter-equipment.ts`. Здесь
 * только перенос в базу с проверкой, что у записи есть и назначение, и
 * ссылка на источник: код артикула без того и другого справочником не
 * является.
 */

interface RawRow {
  section: string;
  model: string;
  description: string;
  page: number;
  sourceFile: string;
}

interface EquipmentFile {
  source: string;
  extractedAt: string;
  rows: RawRow[];
}

export const EQUIPMENT_TABLES = ['equipment_items'] as const;

function filePath(contentDirPath: string): string {
  return `${contentDirPath}/reference/hunter-equipment.json`;
}

export function equipmentSignature(contentDirPath: string): string {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 'empty';
  const data = JSON.parse(readFileSync(path, 'utf8')) as EquipmentFile;
  return `${data.extractedAt}:${data.rows.length}`;
}

export function seedEquipmentItems(db: Db, contentDirPath: string): number {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 0;

  const data = JSON.parse(readFileSync(path, 'utf8')) as EquipmentFile;

  const insert = db.prepare(`
    INSERT INTO equipment_items
      (brand, section, model, description, source, source_file, source_page)
    VALUES ('Hunter', ?, ?, ?, ?, ?, ?)
  `);

  const seen = new Set<string>();
  let count = 0;

  for (const row of data.rows) {
    if (!row.description?.trim()) {
      throw new Error(`${row.model}: изделие без назначения в справочник не идёт`);
    }
    // Один артикул — одна запись: каталог повторяет изделия в сводных таблицах.
    if (seen.has(row.model)) continue;
    seen.add(row.model);

    insert.run(row.section, row.model, row.description, data.source, row.sourceFile, row.page);
    count += 1;
  }

  return count;
}
