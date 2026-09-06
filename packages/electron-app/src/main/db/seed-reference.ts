import { readFileSync } from 'node:fs';
import { CABLE_TABLE } from '@irrigo/core';
import type { Db } from './connection.js';

/**
 * Наполнение справочников шага §12 п.5: клапаны, фильтрация, кабель, глоссарий.
 *
 * Клапаны и фильтрация приходят из разбора каталога, кабель вычисляется
 * движком из формулы §5.12, глоссарий — авторский текст курса. Всё
 * пересобирается вместе с остальными справочниками при смене подписи контента.
 */

interface ValveFile {
  models: Array<{
    model: string;
    sizeLabel: string;
    sizeMm: number;
    flowMinM3h: number;
    flowMaxM3h: number;
    pressureMinBar: number;
    pressureMaxBar: number;
    warrantyYears: number;
    note: string;
    source: string;
  }>;
  solenoids: Array<{
    type: string;
    note: string;
    inrushMa: number | null;
    holdingMa: number | null;
    frequencyHz: number | null;
    source: string;
  }>;
  rows: Array<{
    brand: string;
    model: string;
    sizeLabel: string;
    sizeMm: number;
    body: 'spherical' | 'angle';
    flowM3h: number;
    flowLpm: number;
    lossBar: number;
    lossKpa: number;
    printedIn: 'bar' | 'kpa';
    verified: boolean;
    issue: string | null;
    source: string;
    sourcePage: number;
  }>;
}

interface FiltrationFile {
  meshToMicron: Array<{
    mesh: number;
    micron: number;
    note: string;
    source: string;
    sourcePage: number | null;
    sourceStatus: string;
  }>;
  requirements: Array<{
    equipment: string;
    emitterClass: string;
    minMesh: number;
    minMicron: number;
    source: string;
    sourcePage: number | null;
    sourceStatus: string;
  }>;
  filterTypes: Array<{
    type: string;
    typicalMesh: string;
    note: string;
    source: string;
    sourceStatus: string;
  }>;
  sourceGuidance: Array<{
    waterSource: string;
    risk: string;
    recommendation: string;
    derivedFrom: string;
  }>;
}

interface GlossaryFile {
  terms: Array<{
    ru: string;
    en: string;
    group: string;
    definition: string;
    lessonKey: string | null;
    calculatorKey: string | null;
  }>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export const REFERENCE_V2_TABLES = [
  'valve_models',
  'valve_losses',
  'valve_solenoids',
  'filtration_mesh',
  'filtration_requirements',
  'filtration_types',
  'filtration_sources',
  'cable_table',
  'glossary',
] as const;

export interface ReferenceV2Signature {
  valves: string;
  filtration: string;
  glossary: string;
}

/** Подпись содержимого — чтобы пересборка шла при смене файлов. */
export function referenceV2Signature(contentDirPath: string): ReferenceV2Signature {
  const valves = readJson<ValveFile & { extractedAt?: string }>(
    `${contentDirPath}/reference/hunter-valves.json`,
  );
  const filtration = readJson<FiltrationFile & { collectedAt?: string }>(
    `${contentDirPath}/reference/filtration.json`,
  );
  const glossary = readJson<GlossaryFile & { collectedAt?: string }>(
    `${contentDirPath}/reference/glossary.json`,
  );

  return {
    valves: `${valves.extractedAt ?? '—'}:${valves.rows.length}`,
    filtration: `${filtration.collectedAt ?? '—'}:${filtration.meshToMicron.length}`,
    glossary: `${glossary.collectedAt ?? '—'}:${glossary.terms.length}`,
  };
}

export function seedReferenceV2(db: Db, contentDirPath: string): void {
  seedValves(db, readJson<ValveFile>(`${contentDirPath}/reference/hunter-valves.json`));
  seedFiltration(db, readJson<FiltrationFile>(`${contentDirPath}/reference/filtration.json`));
  seedCable(db);
  seedGlossary(db, readJson<GlossaryFile>(`${contentDirPath}/reference/glossary.json`));
}

function seedValves(db: Db, file: ValveFile): void {
  const model = db.prepare(`
    INSERT INTO valve_models
      (brand, model, size_label, size_mm, flow_min_m3h, flow_max_m3h,
       pressure_min_bar, pressure_max_bar, warranty_years, note, source)
    VALUES ('Hunter', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of file.models) {
    model.run(
      m.model,
      m.sizeLabel,
      m.sizeMm,
      m.flowMinM3h,
      m.flowMaxM3h,
      m.pressureMinBar,
      m.pressureMaxBar,
      m.warrantyYears,
      m.note,
      m.source,
    );
  }

  const loss = db.prepare(`
    INSERT INTO valve_losses
      (brand, model, size_label, size_mm, body, flow_m3h, flow_lpm,
       loss_bar, loss_kpa, verified, issue, source, source_page)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Опорной принята таблица «в кПа»: её разрешение 1 кПа против 0,1 бар,
  // то есть в десять раз выше. Таблица «в барах» остаётся в JSON как
  // свидетельство сверки — подробности в шапке скрипта извлечения.
  for (const row of file.rows.filter((r) => r.printedIn === 'kpa')) {
    loss.run(
      row.brand,
      row.model,
      row.sizeLabel,
      row.sizeMm,
      row.body,
      row.flowM3h,
      row.flowLpm,
      row.lossBar,
      row.lossKpa,
      row.verified ? 1 : 0,
      row.issue,
      row.source,
      row.sourcePage,
    );
  }

  const solenoid = db.prepare(`
    INSERT INTO valve_solenoids (type, inrush_ma, holding_ma, frequency_hz, note, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const s of file.solenoids) {
    solenoid.run(s.type, s.inrushMa, s.holdingMa, s.frequencyHz, s.note, s.source);
  }
}

function seedFiltration(db: Db, file: FiltrationFile): void {
  const mesh = db.prepare(`
    INSERT INTO filtration_mesh (mesh, micron, note, source, source_page, source_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const m of file.meshToMicron) {
    mesh.run(m.mesh, m.micron, m.note, m.source, m.sourcePage, m.sourceStatus);
  }

  const requirement = db.prepare(`
    INSERT INTO filtration_requirements
      (equipment, emitter_class, min_mesh, min_micron, source, source_page, source_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of file.requirements) {
    requirement.run(
      r.equipment,
      r.emitterClass,
      r.minMesh,
      r.minMicron,
      r.source,
      r.sourcePage,
      r.sourceStatus,
    );
  }

  const type = db.prepare(`
    INSERT INTO filtration_types (filter_type, typical_mesh, note, source, source_status)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const t of file.filterTypes) {
    type.run(t.type, t.typicalMesh, t.note, t.source, t.sourceStatus);
  }

  const guidance = db.prepare(`
    INSERT INTO filtration_sources (water_source, risk, recommendation, derived_from)
    VALUES (?, ?, ?, ?)
  `);
  for (const g of file.sourceGuidance) {
    guidance.run(g.waterSource, g.risk, g.recommendation, g.derivedFrom);
  }
}

function seedCable(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO cable_table (cross_section_mm2, current_a, max_length_m, note, source)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const row of CABLE_TABLE) {
    insert.run(row.crossSectionMm2, row.currentA, row.maxLengthM, row.note, row.source);
  }
}

function seedGlossary(db: Db, file: GlossaryFile): void {
  const insert = db.prepare(`
    INSERT INTO glossary (term_ru, term_en, definition, group_key, lesson_key, calculator_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const term of file.terms) {
    insert.run(term.ru, term.en, term.definition, term.group, term.lessonKey, term.calculatorKey);
  }
}
