/**
 * Выборочная сверка извлечения каталога Hunter (ТЗ §8 п.1: «минимум по 3 строки
 * на каждую модель сверить с каталогом и зафиксировать в DECISIONS.md»).
 *
 * Запуск: node scripts/verify-hunter-sample.ts
 * Выход:  content/reference/hunter-nozzles-spotcheck.md
 *
 * Для каждой модели берутся три строки из разных мест таблицы (начало,
 * середина, конец) и печатаются рядом:
 *   - что записано в выгрузке;
 *   - сырая строка текстового слоя PDF с той же страницы.
 * Это позволяет сверить разбор посимвольно, не открывая каталог.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const jsonPath = path.join(projectRoot, 'content', 'reference', 'hunter-nozzles.json');
const outPath = path.join(projectRoot, 'content', 'reference', 'hunter-nozzles-spotcheck.md');

const pdfText: typeof import('./lib/pdf-text.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'pdf-text.mjs')).href
);
const { toRows, rowText } = pdfText;

/* Каталог разбит на части — страницы читаются по сквозным полосам издания. */
const catalogLib: typeof import('./lib/hunter-catalog.mjs') = await import(
  pathToFileURL(path.join(here, 'lib', 'hunter-catalog.mjs')).href
);
const { openCatalog } = catalogLib;

interface Row {
  model: string;
  nozzle: string;
  sectorDeg: number;
  pressureBar: number;
  radiusM: number;
  flowM3h: number;
  flowLmin: number;
  prSquareMmH: number | null;
  prTriangleMmH: number | null;
  checkPrSquare: number | null;
  checkPrTriangle: number | null;
  flowSource: string | null;
  verified: boolean;
  issue: string | null;
  sourcePage: number;
}

const data = JSON.parse(await readFile(jsonPath, 'utf8')) as { rows: Row[] };
const catalog = await openCatalog();

/** Кэш сырых строк по странице. */
const rawCache = new Map<number, string[]>();
async function rawRows(page: number): Promise<string[]> {
  const cached = rawCache.get(page);
  if (cached) return cached;
  const rows = toRows(await catalog.items(page)).map(rowText);
  rawCache.set(page, rows);
  return rows;
}

const models = [...new Set(data.rows.map((r) => r.model))];
const out: string[] = [];

out.push('# Выборочная сверка извлечения каталога Hunter Vol. 41 (RU)\n');
out.push(
  'По три строки на каждую модель — из начала, середины и конца её таблицы. ' +
    'Под каждой строкой приведён сырой текст соответствующей строки страницы из ' +
    'текстового слоя PDF: по нему разбор проверяется посимвольно.\n',
);
out.push(
  '`PR□` и `PR△` — интенсивность при квадратной и треугольной раскладке, как ' +
    'напечатано в каталоге. `расч.` — пересчёт по формуле `PR□ = q · (360/сектор) / R²` ' +
    'из радиуса и расхода той же строки.\n',
);

let checked = 0;
for (const model of models) {
  const rows = data.rows.filter((r) => r.model === model);
  const picks = [rows[0]!, rows[Math.floor(rows.length / 2)]!, rows.at(-1)!];

  out.push(`\n## ${model}\n`);
  out.push(`Строк в выгрузке: ${rows.length}, насадок: ${new Set(rows.map((r) => r.nozzle)).size}\n`);

  for (const r of picks) {
    checked++;
    const raws = await rawRows(r.sourcePage);
    // Ищем сырую строку по совпадению давления, радиуса и обеих интенсивностей:
    // по одному радиусу можно попасть в соседнюю строку таблицы.
    const ru = (n: number) => String(n).replace('.', ',');
    const rTxt = ru(r.radiusM);
    const barTxt = ru(r.pressureBar);
    const prTxt = r.prSquareMmH === null ? null : ru(r.prSquareMmH);
    const raw =
      raws.find(
        (t) =>
          t.includes(rTxt) && t.includes(barTxt) && (prTxt === null || t.includes(` ${prTxt} `)),
      ) ??
      raws.find((t) => t.includes(rTxt) && t.includes(barTxt)) ??
      raws.find((t) => t.includes(rTxt)) ??
      '(строка не найдена в тексте PDF)';

    out.push(`**${r.nozzle}** — стр. ${r.sourcePage}, сектор ${r.sectorDeg}°\n`);
    out.push(
      `- Извлечено: ${r.pressureBar} бар · R = ${r.radiusM} м · ${r.flowM3h} м³/ч (${r.flowLmin} л/мин) · PR□ ${r.prSquareMmH ?? '—'} · PR△ ${r.prTriangleMmH ?? '—'}`,
    );
    out.push(
      `- Расчёт:    PR□ ${r.checkPrSquare ?? '—'} · PR△ ${r.checkPrTriangle ?? '—'} — ${r.verified ? '**сходится**' : '**НЕ СХОДИТСЯ**'}${r.issue ? ` (${r.issue})` : ''}`,
    );
    out.push(`- Сырой текст PDF: \`${raw.slice(0, 190)}\`\n`);
  }
}

const total = data.rows.length;
const noPr = data.rows.filter((r) => r.prSquareMmH === null).length;
const verified = data.rows.filter((r) => r.verified).length;
const failed = data.rows.filter((r) => !r.verified && r.prSquareMmH !== null);

out.push('\n## Итог\n');
out.push(`- Моделей в выгрузке: ${models.length}`);
out.push(`- Строк всего: ${total}`);
out.push(`- Сверено выборочно вручную (эта таблица): ${checked}`);
out.push(`- Сверено сплошной арифметической проверкой: ${verified} из ${total - noPr}`);
out.push(`- Без колонок интенсивности в каталоге: ${noPr}`);
out.push(`- Осталось расхождений: ${failed.length}\n`);

if (failed.length > 0) {
  out.push('### Строки, не прошедшие сверку — в приложение не попадают\n');
  for (const r of failed) {
    const raws = await rawRows(r.sourcePage);
    const raw =
      raws.find((t) => t.includes(String(r.radiusM).replace('.', ','))) ?? '(не найдена)';
    out.push(`**${r.model} — ${r.nozzle}**, стр. ${r.sourcePage}, ${r.pressureBar} бар\n`);
    out.push(
      `- Каталог: PR□ ${r.prSquareMmH}, PR△ ${r.prTriangleMmH}; расчёт: ${r.checkPrSquare} / ${r.checkPrTriangle}`,
    );
    out.push(`- Сырой текст PDF: \`${raw.slice(0, 190)}\`\n`);
  }
}

await writeFile(outPath, out.join('\n') + '\n', 'utf8');
console.log(`Выборочная сверка записана: ${path.relative(projectRoot, outPath)}`);
console.log(`Моделей: ${models.length}, проверено строк вручную: ${checked}`);
console.log(`Не прошли сверку: ${failed.length}`);
