/**
 * Перечень оборудования Hunter из каталога Vol. 41 (§3.3 ТЗ).
 *
 * Запуск:  node scripts/extract-hunter-equipment.ts
 * Выход:   content/reference/hunter-equipment.json
 *
 * ── Что извлекается ────────────────────────────────────────────────────────
 * Каталог описывает всё оборудование одной и той же таблицей «Модель —
 * Описание»: контроллеры, датчики, декодеры, реле пуска насоса, капельные
 * линии, фитинги, короба, инструменты. Отдельные скрипты уже снимают
 * **числовые характеристики** сопел, клапанов и фильтрации; здесь берётся
 * сам перечень изделий с назначением — то, чего в справочнике не было вовсе.
 *
 * ── Как определяется принадлежность строки ─────────────────────────────────
 * Описание в каталоге переносится на несколько строк, а код модели набран
 * один раз и выключен по верхней строке своего блока. Поэтому строки
 * описания привязываются к модели **по вертикали**: всё, что лежит между
 * этой моделью и следующей, принадлежит ей. Привязка «по той же строке»
 * теряла бы вторую и третью строку описания и цепляла хвост предыдущего.
 *
 * Раздел берётся из заголовка полосы — самого крупного текста наверху.
 * Это и есть навигация каталога, дублировать её вручную незачем.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const outDir = path.join(projectRoot, 'content', 'reference');

const catalogLib: typeof import('./lib/hunter-catalog.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'hunter-catalog.mjs')).href
);
const { openCatalog, CATALOG_SOURCE } = catalogLib;

interface Item {
  str: string;
  x: number;
  y: number;
  h: number;
}

/**
 * Код модели: латиница и цифры через дефис или косую черту.
 *
 * Хвост «-XX» в каталоге означает переменную часть артикула (цвет, резьба,
 * длина) — он остаётся как есть, это и есть обозначение в прайсе.
 */
const MODEL_CODE = /^[A-Z][A-Z0-9]*(?:[-/][A-Z0-9]+)*$/;

/** Заведомо не модель: единицы, служебные слова и одиночные буквы. */
const NOT_A_MODEL = new Set([
  'BSP', 'NPT', 'PVC', 'UV', 'LED', 'AC', 'DC', 'IP', 'USB', 'GPM', 'PSI',
  'RU', 'EU', 'US', 'NEW', 'PDF', 'QR',
]);

const isModelCode = (token: string): boolean =>
  token.length >= 3 &&
  token.length <= 28 &&
  MODEL_CODE.test(token) &&
  !NOT_A_MODEL.has(token) &&
  /\d|-/.test(token);

interface Row {
  y: number;
  items: Item[];
}

function toRows(items: Item[], tolerance = 3.2): Row[] {
  const rows: Row[] = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
      row.y = (row.y * (row.items.length - 1) + item.y) / row.items.length;
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.y - b.y);
}

/**
 * Заголовок полосы — самый крупный текст в верхней части листа.
 *
 * Из него вычищаются слова самой шапки таблицы: на части полос «Модель» и
 * «Описание» набраны тем же кеглем, что и заголовок, и попадают в него.
 */
function pageHeading(items: Item[]): string {
  const top = items.filter((i) => i.y < 220 && i.str.trim().length > 2);
  if (top.length === 0) return '';
  const maxHeight = Math.max(...top.map((i) => i.h));

  return top
    .filter((i) => i.h >= maxHeight - 0.6)
    .map((i) => i.str.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*(Модель|Описание|Наименование)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

export interface EquipmentRow {
  section: string;
  model: string;
  description: string;
  page: number;
  sourceFile: string;
}

/** Ширина колонки описания: дальше идут числовые характеристики, не текст. */
const DESCRIPTION_WIDTH = 235;
/**
 * Насколько выше своей первой строки описания может стоять код модели.
 *
 * Запас маленький намеренно: чем он больше, тем чаще хвост описания
 * следующего изделия приклеивается к предыдущему.
 */
const MODEL_LEAD = 2;

function extractPage(items: Item[], page: number, sourceFile: string): EquipmentRow[] {
  const rows = toRows(items);
  const section = pageHeading(items);
  const out: EquipmentRow[] = [];

  for (let r = 0; r < rows.length; r += 1) {
    const header = rows[r]!;
    const modelHeader = header.items.find((i) => /^Модель$/i.test(i.str.trim()));
    const descHeader = header.items.find((i) =>
      /^(Описание|Наименование)$/i.test(i.str.trim()),
    );
    if (!modelHeader || !descHeader) continue;

    // Всё, что ниже шапки: коды моделей в своей колонке и текст описания в своей.
    const below = items.filter((i) => i.y > header.y + 2);

    const models = below
      .filter((i) => Math.abs(i.x - modelHeader.x) <= 9 && isModelCode(i.str.trim()))
      .sort((a, b) => a.y - b.y);

    const descriptions = below
      .filter(
        (i) =>
          i.x >= descHeader.x - 9 &&
          i.x < descHeader.x + DESCRIPTION_WIDTH &&
          /[А-Яа-яЁё]/.test(i.str),
      )
      .sort((a, b) => a.y - b.y);

    /*
     * Строка описания достаётся ближайшей по вертикали модели.
     *
     * Диапазон «от этой модели до следующей» не годится: в каталоге код
     * модели то выключен по верхней строке блока, то по центру, и тогда
     * первая строка описания оказывается выше своего кода. Ближайший сосед
     * покрывает оба случая одним правилом.
     */
    const buckets = new Map<number, Item[]>();
    for (const line of descriptions) {
      let nearest = 0;
      let best = Infinity;
      for (let m = 0; m < models.length; m += 1) {
        const distance = Math.abs(models[m]!.y - line.y);
        if (distance < best) {
          best = distance;
          nearest = m;
        }
      }
      const bucket = buckets.get(nearest) ?? [];
      bucket.push(line);
      buckets.set(nearest, bucket);
    }

    for (let m = 0; m < models.length; m += 1) {
      const text = (buckets.get(m) ?? [])
        .sort((a, b) => a.y - b.y || a.x - b.x)
        .map((d) => d.str.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;)])/g, '$1')
        // Перекрёстные ссылки каталога «См. стр. 183» — это навигация по
        // печатному изданию, а не характеристика изделия.
        .replace(/\s*(См\.)?\s*Страниц[ае]?\s*\d+\s*/gi, ' ')
        // Слово шапки, попавшее в текст на полосах-продолжениях таблицы.
        .replace(/^\s*(Описание|Наименование)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      out.push({
        section,
        model: models[m]!.str.trim(),
        description: text,
        page,
        sourceFile,
      });
    }

    // Таблица на полосе одна: вторую шапку «Модель» дальше не ищем.
    break;
  }

  return out;
}

async function main(): Promise<void> {
  const catalog = await openCatalog();
  const all: EquipmentRow[] = [];

  /*
   * Раздел тянется через полосы: у разворотов и продолжений таблиц своего
   * заголовка нет. Пустой заголовок наследуется от предыдущей полосы — так
   * запись не остаётся без раздела вовсе.
   */
  let lastSection = '';
  for (let page = 1; page <= catalog.totalPages; page += 1) {
    const items = (await catalog.items(page)) as Item[];
    if (items.length === 0) continue;

    const rows = extractPage(items, page, catalog.fileOf(page));
    for (const row of rows) {
      if (row.section) lastSection = row.section;
      else row.section = lastSection;
    }
    all.push(...rows);
  }

  /*
   * Один и тот же артикул встречается в каталоге дважды: в своём разделе и в
   * сводной таблице совместимости. Оставляем запись с более полным описанием —
   * пустое описание в справочнике бесполезно.
   */
  const byModel = new Map<string, EquipmentRow>();
  for (const row of all) {
    const existing = byModel.get(row.model);
    if (!existing || existing.description.length < row.description.length) {
      byModel.set(row.model, row);
    }
  }

  /*
   * В справочник не идут:
   *  — записи без описания: код без назначения ничего не добавляет;
   *  — расшифровки артикула («= 30 м = 15 см = чёрный»): это не изделие, а
   *    ключ к обозначению, и в перечне оборудования он выглядит как товар.
   */
  const rows = [...byModel.values()]
    .filter((r) => r.description.length >= 8)
    .filter((r) => (r.description.match(/=/g) ?? []).length < 2)
    .sort((a, b) => a.page - b.page || a.model.localeCompare(b.model));

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'hunter-equipment.json'),
    `${JSON.stringify(
      {
        source: `${CATALOG_SOURCE} — ${catalog.parts.length} части: ${catalog.parts
          .map((p) => p.file)
          .join(', ')}`,
        extractedAt: new Date().toISOString().slice(0, 10),
        note:
          'Перечень оборудования из таблиц «Модель — Описание» каталога. Числовые ' +
          'характеристики сопел, клапанов и фильтрации извлекаются отдельными скриптами ' +
          'и лежат в своих разделах справочника.',
        parts: catalog.parts,
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const bySection = new Map<string, number>();
  for (const row of rows) bySection.set(row.section, (bySection.get(row.section) ?? 0) + 1);

  console.log(`Изделий: ${rows.length} (из ${all.length} найденных строк)`);
  console.log(`Разделов: ${bySection.size}`);
  for (const [section, count] of [...bySection.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${String(count).padStart(3)}  ${section}`);
  }
}

await main();
