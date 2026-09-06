/**
 * Извлечение таблиц потери давления в клапанах из каталога Hunter,
 * издание 41 (RU) в справочник «Клапаны и арматура» (ТЗ §3.3.5, §7).
 *
 * Запуск:  node scripts/extract-hunter-valves.ts
 * Выход:   content/reference/hunter-valves.json
 *
 * ── Что разбирается ────────────────────────────────────────────────────────
 * Каталог печатает потери в клапанах дважды: таблицу «в барах» с расходом в
 * м³/ч и таблицу «в кПа» с расходом в л/мин. Разбираются обе:
 *
 *   стр. 87 — PGV-151 (40 мм) и PGV-201 (50 мм), сферические и угловые
 *   стр. 89 — PGV-100/101 (25 мм)
 *   стр. 91 — ICV-101/151/201/301 (25, 40, 50, 80 мм)
 *
 * ── Как проверяется разбор ─────────────────────────────────────────────────
 * Две таблицы одной страницы описывают одно и то же в разных единицах, но
 * напечатаны по разным точкам расхода. Поэтому сверка идёт так:
 *
 * 1. Пары строк, где расход совпадает (л/мин ≈ м³/ч · 16,667 с допуском 2 %),
 *    сверяются по значению. Таблица «в барах» напечатана с одним знаком после
 *    запятой, поэтому допуск — половина шага округления, 0,05 бар.
 * 2. Потери должны монотонно расти с расходом внутри каждой колонки —
 *    физика клапана этого требует, а сбой текстового слоя это нарушает.
 *
 * Строки, не прошедшие проверку, помечаются `verified: false` и в справочник
 * выводятся только с явной пометкой — то же правило, что и для сопел.
 *
 * ── Что показала сверка ────────────────────────────────────────────────────
 * Из 56 сошедшихся по расходу пар 13 расходятся больше чем на шаг округления,
 * и все — в верхней трети рабочего диапазона моделей ICV: например, ICV-101
 * при 7 м³/ч даёт 0,4 бар в одной таблице и 62 кПа (0,62 бар) в другой.
 * Это несогласованность самого каталога, а не сбой разбора: обе величины
 * читаются из текстового слоя однозначно.
 *
 * Опорной принята таблица «в кПа»: у неё разрешение 1 кПа против 0,1 бар,
 * то есть в десять раз выше. Таблица «в барах» остаётся в выгрузке как
 * свидетельство сверки.
 *
 * ── Чего в каталоге нет ────────────────────────────────────────────────────
 * Потери в фильтрах отдельной таблицей не приводятся: на стр. 210 они даны
 * графиком, значения с которого снять нельзя. Их пользователь вводит по
 * паспорту своего изделия (калькулятор §5.5).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const outDir = path.join(projectRoot, 'content', 'reference');

const pdfText: typeof import('./lib/pdf-text.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'pdf-text.mjs')).href
);
const { toRows } = pdfText;

/* Каталог разбит на части — страницы читаются по сквозным полосам издания. */
const catalogLib: typeof import('./lib/hunter-catalog.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'hunter-catalog.mjs')).href
);
const { openCatalog } = catalogLib;

const LPM_PER_M3H = 1000 / 60;

interface ColumnSpec {
  /** Центр колонки по X в координатах страницы. */
  x: number;
  model: string;
  sizeLabel: string;
  sizeMm: number;
  body: 'spherical' | 'angle';
}

interface TableSpec {
  page: number;
  family: 'PGV' | 'ICV';
  /** В каких единицах напечатаны потери. */
  lossUnit: 'bar' | 'kpa';
  /** В каких единицах напечатан расход. */
  flowUnit: 'm3h' | 'lpm';
  yFrom: number;
  yTo: number;
  flowXFrom: number;
  flowXTo: number;
  columns: ColumnSpec[];
}

const PGV_40_50: ColumnSpec[] = [
  { x: 0, model: 'PGV-151', sizeLabel: '1½" (40 мм)', sizeMm: 40, body: 'spherical' },
  { x: 0, model: 'PGV-151', sizeLabel: '1½" (40 мм)', sizeMm: 40, body: 'angle' },
  { x: 0, model: 'PGV-201', sizeLabel: '2" (50 мм)', sizeMm: 50, body: 'spherical' },
  { x: 0, model: 'PGV-201', sizeLabel: '2" (50 мм)', sizeMm: 50, body: 'angle' },
];

const ICV_ALL: ColumnSpec[] = [
  { x: 0, model: 'ICV-101', sizeLabel: '1" (25 мм)', sizeMm: 25, body: 'spherical' },
  { x: 0, model: 'ICV-151', sizeLabel: '1½" (40 мм)', sizeMm: 40, body: 'spherical' },
  { x: 0, model: 'ICV-201', sizeLabel: '2" (50 мм)', sizeMm: 50, body: 'spherical' },
  { x: 0, model: 'ICV-301', sizeLabel: '3" (80 мм)', sizeMm: 80, body: 'spherical' },
  { x: 0, model: 'ICV-301', sizeLabel: '3" (80 мм)', sizeMm: 80, body: 'angle' },
];

/** Проставляет X-координаты колонкам, не переписывая описание моделей. */
function at(columns: ColumnSpec[], xs: number[]): ColumnSpec[] {
  if (columns.length !== xs.length) throw new Error('Число колонок не совпало с координатами');
  return columns.map((c, i) => ({ ...c, x: xs[i]! }));
}

const TABLES: TableSpec[] = [
  {
    page: 87,
    family: 'PGV',
    lossUnit: 'bar',
    flowUnit: 'm3h',
    yFrom: 628,
    yTo: 760,
    flowXFrom: 360,
    flowXTo: 390,
    columns: at(PGV_40_50, [411, 455, 502, 548]),
  },
  {
    page: 87,
    family: 'PGV',
    lossUnit: 'kpa',
    flowUnit: 'lpm',
    yFrom: 465,
    yTo: 585,
    flowXFrom: 368,
    flowXTo: 390,
    columns: at(PGV_40_50, [420, 467, 512, 554]),
  },
  {
    page: 89,
    family: 'PGV',
    lossUnit: 'bar',
    flowUnit: 'm3h',
    yFrom: 585,
    yTo: 690,
    flowXFrom: 62,
    flowXTo: 85,
    columns: at(
      [{ x: 0, model: 'PGV-100/101', sizeLabel: '1" (25 мм)', sizeMm: 25, body: 'spherical' }],
      [119],
    ),
  },
  {
    page: 89,
    family: 'PGV',
    lossUnit: 'kpa',
    flowUnit: 'lpm',
    yFrom: 585,
    yTo: 690,
    flowXFrom: 175,
    flowXTo: 195,
    columns: at(
      [{ x: 0, model: 'PGV-100/101', sizeLabel: '1" (25 мм)', sizeMm: 25, body: 'spherical' }],
      [231],
    ),
  },
  {
    page: 91,
    family: 'ICV',
    lossUnit: 'bar',
    flowUnit: 'm3h',
    yFrom: 432,
    yTo: 670,
    flowXFrom: 58,
    flowXTo: 75,
    columns: at(ICV_ALL, [95, 125, 157, 190, 224]),
  },
  {
    page: 91,
    family: 'ICV',
    lossUnit: 'kpa',
    flowUnit: 'lpm',
    yFrom: 432,
    yTo: 670,
    flowXFrom: 258,
    flowXTo: 278,
    columns: at(ICV_ALL, [297, 330, 360, 392, 421]),
  },
];

/** Допуск на попадание числа в колонку, пунктов по X. */
const COLUMN_TOLERANCE = 14;

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

export interface ValveLossRow {
  brand: 'Hunter';
  family: string;
  model: string;
  sizeLabel: string;
  sizeMm: number;
  body: 'spherical' | 'angle';
  flowM3h: number;
  flowLpm: number;
  lossBar: number;
  lossKpa: number;
  /** В каких единицах значение напечатано в каталоге. */
  printedIn: 'bar' | 'kpa';
  verified: boolean;
  issue: string | null;
  source: string;
  sourcePage: number;
}

interface RawRow {
  spec: TableSpec;
  flow: number;
  /** Значение по индексу колонки; отсутствующие — undefined. */
  values: Array<number | undefined>;
  y: number;
}

async function readTable(
  catalog: { items: (page: number) => Promise<unknown[]> },
  spec: TableSpec,
): Promise<RawRow[]> {
  const rows = toRows(await catalog.items(spec.page));
  const out: RawRow[] = [];

  for (const row of rows) {
    if (row.y < spec.yFrom || row.y > spec.yTo) continue;

    const flowItem = row.items.find(
      (i) => i.x >= spec.flowXFrom && i.x <= spec.flowXTo && num(i.str) !== null,
    );
    if (!flowItem) continue;
    const flow = num(flowItem.str);
    if (flow === null) continue;

    const values: Array<number | undefined> = spec.columns.map(() => undefined);
    let assigned = 0;

    for (const item of row.items) {
      if (item === flowItem) continue;
      const value = num(item.str);
      if (value === null) continue;

      let best = -1;
      let bestDistance = COLUMN_TOLERANCE;
      spec.columns.forEach((column, index) => {
        const distance = Math.abs(item.x - column.x);
        if (distance < bestDistance) {
          best = index;
          bestDistance = distance;
        }
      });

      if (best >= 0 && values[best] === undefined) {
        values[best] = value;
        assigned += 1;
      }
    }

    if (assigned > 0) out.push({ spec, flow, values, y: row.y });
  }

  return out;
}

function toLossRows(raw: RawRow[]): ValveLossRow[] {
  const rows: ValveLossRow[] = [];

  for (const item of raw) {
    const flowM3h = item.spec.flowUnit === 'm3h' ? item.flow : item.flow / LPM_PER_M3H;
    const flowLpm = item.spec.flowUnit === 'lpm' ? item.flow : item.flow * LPM_PER_M3H;

    item.values.forEach((value, index) => {
      if (value === undefined) return;
      const column = item.spec.columns[index]!;
      const lossBar = item.spec.lossUnit === 'bar' ? value : value / 100;
      const lossKpa = item.spec.lossUnit === 'kpa' ? value : value * 100;

      rows.push({
        brand: 'Hunter',
        family: item.spec.family,
        model: column.model,
        sizeLabel: column.sizeLabel,
        sizeMm: column.sizeMm,
        body: column.body,
        flowM3h: round(flowM3h, 3),
        flowLpm: round(flowLpm, 1),
        lossBar: round(lossBar, 3),
        lossKpa: round(lossKpa, 1),
        printedIn: item.spec.lossUnit,
        verified: true,
        issue: null,
        source: `Каталог Hunter, издание 41 (RU), стр. ${item.spec.page}`,
        sourcePage: item.spec.page,
      });
    });
  }

  return rows;
}

function round(value: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

const columnKey = (row: ValveLossRow) => `${row.model}|${row.sizeMm}|${row.body}`;

/**
 * Сверка двух печатных таблиц одной страницы между собой.
 * Возвращает число сошедшихся пар и помечает разошедшиеся строки.
 */
function crossCheckUnits(rows: ValveLossRow[]): { paired: number; mismatched: number } {
  const bar = rows.filter((r) => r.printedIn === 'bar');
  const kpa = rows.filter((r) => r.printedIn === 'kpa');

  let paired = 0;
  let mismatched = 0;

  for (const b of bar) {
    const twin = kpa.find(
      (k) =>
        columnKey(k) === columnKey(b) &&
        Math.abs(k.flowM3h - b.flowM3h) <= Math.max(0.05, b.flowM3h * 0.02),
    );
    if (!twin) continue;

    paired += 1;
    // Таблица «в барах» напечатана с одним знаком после запятой, поэтому
    // 14 кПа там законно выглядят как 0,1 бар. Сравниваем с допуском в
    // половину шага округления — иначе половина строк ложно «расходится».
    const allowed = 0.05 + 1e-9;
    if (Math.abs(b.lossBar - twin.lossKpa / 100) > allowed) {
      mismatched += 1;
      const note =
        `Таблицы каталога расходятся: ${b.lossBar} бар против ${twin.lossKpa} кПа ` +
        `(${twin.lossKpa / 100} бар) при расходе ${b.flowM3h} м³/ч`;
      b.verified = false;
      b.issue = note;
      twin.verified = false;
      twin.issue = note;
    }
  }

  return { paired, mismatched };
}

/**
 * Потери в клапане обязаны расти с расходом. Нарушение этого порядка внутри
 * колонки означает сбой текстового слоя, а не свойство изделия.
 */
function checkMonotonic(rows: ValveLossRow[]): number {
  const groups = new Map<string, ValveLossRow[]>();
  for (const row of rows) {
    const key = `${columnKey(row)}|${row.printedIn}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  let broken = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a.flowM3h - b.flowM3h);
    for (let i = 1; i < list.length; i += 1) {
      const previous = list[i - 1]!;
      const current = list[i]!;
      if (current.lossBar < previous.lossBar - 1e-9) {
        current.verified = false;
        current.issue =
          `Потери убывают с ростом расхода (${previous.lossBar} → ${current.lossBar} бар) — ` +
          'признак сбоя разбора';
        broken += 1;
      }
    }
  }

  return broken;
}

/**
 * Паспортные данные соленоида и рабочие диапазоны — из текста тех же страниц
 * (стр. 87, 88, 90). Не таблицы, поэтому вписаны как факты с указанием страницы.
 */
const SOLENOIDS = [
  {
    type: 'AC 24 В',
    note: 'Электромагнит переменного тока, стандартный для всех клапанов Hunter',
    inrushMa: 350,
    holdingMa: 190,
    frequencyHz: 60,
    source: 'Каталог Hunter, издание 41 (RU), стр. 87, 88, 90',
  },
  {
    type: 'AC 24 В',
    note: 'Тот же электромагнит в сети 50 Гц — ток заметно выше',
    inrushMa: 370,
    holdingMa: 210,
    frequencyHz: 50,
    source: 'Каталог Hunter, издание 41 (RU), стр. 87, 88, 90',
  },
  {
    type: 'DC latching 9 В',
    note: 'Фиксирующий соленоид постоянного тока (арт. 458200) для контроллеров с питанием от батарей',
    inrushMa: null,
    holdingMa: 0,
    frequencyHz: null,
    source: 'Каталог Hunter, издание 41 (RU), стр. 87, 89, 90',
  },
];

const MODELS = [
  {
    model: 'PGV-100/101',
    sizeLabel: '1" (25 мм)',
    sizeMm: 25,
    flowMinM3h: 0.05,
    flowMaxM3h: 9,
    pressureMinBar: 1.5,
    pressureMaxBar: 10,
    warrantyYears: 2,
    note: 'Базовый зонный клапан для частного участка.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 86, 88',
  },
  {
    model: 'PGV-151',
    sizeLabel: '1½" (40 мм)',
    sizeMm: 40,
    flowMinM3h: 5,
    flowMaxM3h: 27,
    pressureMinBar: 1.5,
    pressureMaxBar: 10,
    warrantyYears: 2,
    note: 'Для больших зон и магистралей.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 87',
  },
  {
    model: 'PGV-201',
    sizeLabel: '2" (50 мм)',
    sizeMm: 50,
    flowMinM3h: 5,
    flowMaxM3h: 34,
    pressureMinBar: 1.5,
    pressureMaxBar: 10,
    warrantyYears: 2,
    note: 'Для больших зон и магистралей.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 87',
  },
  {
    model: 'ICV-101',
    sizeLabel: '1" (25 мм)',
    sizeMm: 25,
    flowMinM3h: 0.03,
    flowMaxM3h: 9,
    pressureMinBar: 1.5,
    pressureMaxBar: 15,
    warrantyYears: 5,
    note: 'Высокое давление и грязная вода; опция самоочистки фильтра Filter Sentry.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 86, 90',
  },
  {
    model: 'ICV-151',
    sizeLabel: '1½" (40 мм)',
    sizeMm: 40,
    flowMinM3h: 0.03,
    flowMaxM3h: 34,
    pressureMinBar: 1.5,
    pressureMaxBar: 15,
    warrantyYears: 5,
    note: 'Высокое давление и грязная вода.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 90',
  },
  {
    model: 'ICV-201',
    sizeLabel: '2" (50 мм)',
    sizeMm: 50,
    flowMinM3h: 0.03,
    flowMaxM3h: 45,
    pressureMinBar: 1.5,
    pressureMaxBar: 15,
    warrantyYears: 5,
    note: 'Высокое давление и грязная вода.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 90',
  },
  {
    model: 'ICV-301',
    sizeLabel: '3" (80 мм)',
    sizeMm: 80,
    flowMinM3h: 0.03,
    flowMaxM3h: 68,
    pressureMinBar: 1.5,
    pressureMaxBar: 15,
    warrantyYears: 5,
    note: 'Магистральный и мастер-клапан крупных систем.',
    source: 'Каталог Hunter, издание 41 (RU), стр. 90',
  },
];

async function main() {
  const catalog = await openCatalog();

  const perPage = new Map<number, ValveLossRow[]>();
  for (const spec of TABLES) {
    const rows = toLossRows(await readTable(catalog, spec));
    const list = perPage.get(spec.page) ?? [];
    list.push(...rows);
    perPage.set(spec.page, list);
  }

  let paired = 0;
  let mismatched = 0;
  for (const list of perPage.values()) {
    const result = crossCheckUnits(list);
    paired += result.paired;
    mismatched += result.mismatched;
  }

  const rows = [...perPage.values()].flat();
  const broken = checkMonotonic(rows);
  rows.sort(
    (a, b) =>
      a.model.localeCompare(b.model) ||
      a.body.localeCompare(b.body) ||
      a.printedIn.localeCompare(b.printedIn) ||
      a.flowM3h - b.flowM3h,
  );

  const payload = {
    source: `Каталог Hunter, издание 41 (RU) — 2 части: 00-RC-001-CA-Vol41-HunterCatalog-RU-1-124.pdf, 00-RC-001-CA-Vol41-HunterCatalog-RU-125-228.pdf`,
    extractedAt: new Date().toISOString().slice(0, 10),
    check:
      'Таблицы «в барах» и «в кПа» одной страницы сверены между собой по совпадающим ' +
      'точкам расхода; внутри каждой колонки проверена монотонность потерь.',
    stats: {
      rows: rows.length,
      pairedRows: paired,
      mismatched,
      nonMonotonic: broken,
      unverified: rows.filter((r) => !r.verified).length,
    },
    models: MODELS,
    solenoids: SOLENOIDS,
    rows,
  };

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'hunter-valves.json'),
    `${JSON.stringify(payload, null, 1)}\n`,
    'utf8',
  );

  console.log(
    `Клапаны: ${rows.length} строк, сверено пар ${paired}, расхождений ${mismatched}, ` +
      `нарушений монотонности ${broken}`,
  );
  for (const row of rows.filter((r) => !r.verified)) {
    console.log(`  [!] ${row.model} ${row.body} ${row.flowM3h} м³/ч — ${row.issue}`);
  }
}

await main();
