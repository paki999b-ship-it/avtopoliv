import { readFileSync } from 'node:fs';
import {
  CABLE_TABLE,
  CALCULATORS,
  HAZEN_WILLIAMS_C,
  PIPE_CATALOG,
  PLANTS,
  SOILS,
  hazenWilliamsLossM,
} from '@irrigo/core';
import type { Db } from './connection.js';
import { getMeta, inTransaction, setMeta } from './connection.js';
import {
  REFERENCE_V2_TABLES,
  referenceV2Signature,
  seedReferenceV2,
} from './seed-reference.js';
import { rebuildSearchIndex } from './repos/search.js';
import { ACADEMY_TABLES, academySignature, seedAcademy } from './seed-academy.js';
import { LAYOUT_TABLES, layoutSignature, seedLayoutTasks } from './seed-layout.js';
import { SCENARIO_TABLES, scenariosSignature, seedScenarios } from './seed-scenarios.js';
import { ASSEMBLY_TABLES, assemblySignature, seedAssemblyTasks } from './seed-assembly.js';
import {
  DIAGNOSTICS_TABLES,
  diagnosticsSignature,
  seedDiagnostics,
} from './seed-diagnostics.js';
import { SAFETY_TABLES, safetySignature, seedSafetyTopics } from './seed-safety.js';
import { questionBankSignature, seedQuestionBank } from './seed-questions.js';
import { seedStripNozzles, stripNozzlesSignature } from './seed-strip-nozzles.js';
import {
  EQUIPMENT_TABLES,
  equipmentSignature,
  seedEquipmentItems,
} from './seed-equipment.js';
import {
  PUMP_SOURCES_META_KEY,
  PUMP_TABLES,
  pumpsSignature,
  seedPumps,
} from './seed-pumps.js';

/**
 * Наполнение справочных таблиц при первом запуске (§2 ТЗ: «контент в /content,
 * сборка в БД при первом запуске»).
 *
 * Справочники — производные данные: они целиком пересобираются, когда меняется
 * подпись контента. Пользовательские таблицы (профили, прогресс, история
 * расчётов) при этом не трогаются — иначе обновление приложения стирало бы
 * прогресс.
 */

const SIGNATURE_KEY = 'content_signature';
const CATALOG_EDITION_KEY = 'catalog_edition';

/** Поднимать вручную, когда меняется код наполнения, а не сами файлы. */
const SEED_VERSION = 14;

interface NozzleRow {
  brand: string;
  model: string;
  nozzle: string;
  sectorDeg: number | null;
  pressureBar: number;
  radiusM: number;
  flowM3h: number;
  flowLmin: number | null;
  prSquareMmH: number | null;
  prTriangleMmH: number | null;
  emitterClass: string;
  verified: boolean;
  issue: string | null;
  source: string;
  sourcePage: number | null;
}

interface NozzleFile {
  source: string;
  extractedAt: string;
  rule: string;
  rows: NozzleRow[];
}

interface StandardItem {
  code: string;
  titleRu: string;
  scopeNote: string;
  region?: string;
  authors?: string;
  edition?: string;
  needsLocalCheck?: boolean;
  url?: string | null;
}

interface StandardsFile {
  note: string;
  collectedAt: string;
  items: StandardItem[];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Расход, м³/ч, при заданной скорости в трубе внутреннего диаметра `idMm`. */
function flowAtVelocity(idMm: number, velocityMs: number): number {
  const areaM2 = (Math.PI * (idMm / 1000) ** 2) / 4;
  return round(areaM2 * velocityMs * 3600, 2);
}

function round(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

const REFERENCE_TABLES = [
  'equipment_nozzles',
  'pipes',
  'soils',
  'kc_values',
  'standards_refs',
  'calculators',
  ...REFERENCE_V2_TABLES,
  ...ACADEMY_TABLES,
  ...LAYOUT_TABLES,
  ...SCENARIO_TABLES,
  ...ASSEMBLY_TABLES,
  ...DIAGNOSTICS_TABLES,
  ...SAFETY_TABLES,
  ...PUMP_TABLES,
  ...EQUIPMENT_TABLES,
] as const;

export interface SeedInfo {
  seeded: boolean;
  signature: string;
  catalogEdition: string;
  counts: Record<string, number>;
}

export function seedReferenceData(db: Db, contentDirPath: string): SeedInfo {
  const nozzlesPath = `${contentDirPath}/reference/hunter-nozzles.json`;
  const standardsPath = `${contentDirPath}/reference/standards.json`;

  const nozzles = readJson<NozzleFile>(nozzlesPath);
  const standards = readJson<StandardsFile>(standardsPath);

  const v2 = referenceV2Signature(contentDirPath);

  const signature = [
    `seed:${SEED_VERSION}`,
    `nozzles:${nozzles.extractedAt}:${nozzles.rows.length}`,
    `strip:${stripNozzlesSignature()}`,
    `equipment:${equipmentSignature(contentDirPath)}`,
    `pumps:${pumpsSignature(contentDirPath)}`,
    `standards:${standards.collectedAt}:${standards.items.length}`,
    `calculators:${CALCULATORS.length}`,
    `pipes:${PIPE_CATALOG.length}`,
    `soils:${SOILS.length}`,
    `plants:${PLANTS.length}`,
    `valves:${v2.valves}`,
    `filtration:${v2.filtration}`,
    `glossary:${v2.glossary}`,
    `cable:${CABLE_TABLE.length}`,
    `academy:${academySignature(contentDirPath)}`,
    `layout:${layoutSignature(contentDirPath)}`,
    `scenarios:${scenariosSignature(contentDirPath)}`,
    `assembly:${assemblySignature(contentDirPath)}`,
    `diagnostics:${diagnosticsSignature(contentDirPath)}`,
    `safety:${safetySignature(contentDirPath)}`,
    `bank:${questionBankSignature(contentDirPath)}`,
  ].join('|');

  if (getMeta(db, SIGNATURE_KEY) === signature) {
    return {
      seeded: false,
      signature,
      catalogEdition: getMeta(db, CATALOG_EDITION_KEY) ?? nozzles.source,
      counts: countReferenceRows(db),
    };
  }

  inTransaction(db, () => {
    for (const table of REFERENCE_TABLES) db.exec(`DELETE FROM ${table}`);

    seedNozzles(db, nozzles);
    seedStripNozzles(db);
    seedEquipmentItems(db, contentDirPath);
    seedPipes(db);
    seedSoils(db);
    seedPlants(db);
    seedStandards(db, standards);
    seedCalculators(db);
    seedReferenceV2(db, contentDirPath);
    seedAcademy(db, contentDirPath);
    // Банк вопросов после Академии: его вопросы ссылаются на уроки, и ссылка
    // разрешается по уже наполненной таблице. Таблица `questions` очищается
    // вместе с Академией, поэтому отдельной записи в REFERENCE_TABLES не нужно.
    seedQuestionBank(db, contentDirPath);
    seedLayoutTasks(db, contentDirPath);
    seedScenarios(db, contentDirPath);
    seedAssemblyTasks(db, contentDirPath);
    // Диагностика идёт после Академии: каждый её исход ссылается на урок,
    // и ссылка проверяется по уже наполненной таблице (§3.6).
    seedDiagnostics(db, contentDirPath);
    seedSafetyTopics(db, contentDirPath);

    // Отчёт об источниках каталогов насосов хранится рядом с данными:
    // пользователь должен видеть, каких каталогов в подборе нет и почему.
    const pumpsInfo = seedPumps(db, contentDirPath);
    setMeta(db, PUMP_SOURCES_META_KEY, pumpsInfo.reportJson);

    // Индекс глобального поиска строится последним: он читает уже наполненные
    // справочники, поэтому пересобирать его отдельно не нужно.
    rebuildSearchIndex(db);

    setMeta(db, SIGNATURE_KEY, signature);
    setMeta(db, CATALOG_EDITION_KEY, nozzles.source);
    setMeta(db, 'catalog_rule', nozzles.rule);
    setMeta(db, 'seeded_at', new Date().toISOString());
  });

  return {
    seeded: true,
    signature,
    catalogEdition: nozzles.source,
    counts: countReferenceRows(db),
  };
}

function countReferenceRows(db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of REFERENCE_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    counts[table] = Number(row.n);
  }
  return counts;
}

function seedNozzles(db: Db, file: NozzleFile): void {
  const insert = db.prepare(`
    INSERT INTO equipment_nozzles
      (brand, family, model, nozzle, sector_deg, pressure_bar, radius_m, flow_m3h,
       flow_lpm, pr_square_mm_h, pr_triangle_mm_h, emitter_class, verified, issue,
       source, source_page)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const r of file.rows) {
    insert.run(
      r.brand,
      r.model, // в каталоге семейство и модель совпадают: «PGP Ultra / I-20 / PRB»
      r.model,
      r.nozzle,
      r.sectorDeg,
      r.pressureBar,
      r.radiusM,
      r.flowM3h,
      r.flowLmin,
      r.prSquareMmH,
      r.prTriangleMmH,
      r.emitterClass,
      r.verified ? 1 : 0,
      r.issue,
      r.source,
      r.sourcePage,
    );
  }
}

function seedPipes(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO pipes
      (material, standard, sdr, pn, od_mm, wall_mm, id_mm,
       q_1_0_m3h, q_1_5_m3h, q_2_0_m3h, hf_100m_at_1_5, source, source_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of PIPE_CATALOG) {
    const c = HAZEN_WILLIAMS_C[p.material];
    const q15M3h = flowAtVelocity(p.idMm, 1.5);
    // Потери на 100 м при скорости 1,5 м/с — та же формула §5.2, что и в калькуляторе.
    const hf100 = round(hazenWilliamsLossM(q15M3h / 3600, p.idMm / 1000, 100, c), 2);

    insert.run(
      p.material,
      p.standard,
      String(p.sdr),
      `PN${String(p.pnBar).replace('.', ',')}`,
      p.odMm,
      p.wallMm,
      p.idMm,
      flowAtVelocity(p.idMm, 1.0),
      q15M3h,
      flowAtVelocity(p.idMm, 2.0),
      hf100,
      p.source,
      p.sourceStatus,
    );
  }
}

function seedSoils(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO soils
      (key, title, infiltration_min, infiltration_max, awc_min, awc_max,
       note, source, source_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of SOILS) {
    insert.run(
      s.type,
      s.titleRu,
      s.infiltrationMinMmH,
      s.infiltrationMaxMmH,
      s.awcMinMmPerM,
      s.awcMaxMmPerM,
      s.note,
      `${s.sourceInfiltration} · ${s.sourceAwc}`,
      s.sourceStatus,
    );
  }
}

function seedPlants(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO kc_values
      (key, plant_type, kc_min, kc_max, root_depth_min_m, root_depth_max_m,
       note, source, source_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of PLANTS) {
    insert.run(
      p.type,
      p.titleRu,
      p.kcMin,
      p.kcMax,
      p.rootDepthMinM,
      p.rootDepthMaxM,
      p.note,
      p.source,
      p.sourceStatus,
    );
  }
}

function seedStandards(db: Db, file: StandardsFile): void {
  const insert = db.prepare(`
    INSERT INTO standards_refs
      (code, title_ru, scope_note, region, edition, needs_local_check, url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of file.items) {
    insert.run(
      s.code,
      s.titleRu,
      s.scopeNote,
      s.region ?? '',
      s.edition ?? s.authors ?? '',
      s.needsLocalCheck ? 1 : 0,
      s.url ?? null,
    );
  }
}

function seedCalculators(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO calculators (key, section, title, description, formula_md, spec_ref, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  CALCULATORS.forEach((c, index) => {
    insert.run(c.key, c.group, c.title, c.summary, c.formula, `§${c.spec}`, index);
  });
}
