/**
 * Извлечение каталогов насосов из PDF в `/content` (часть 2 задачи).
 *
 * Запуск:  node scripts/extract-pump-catalogs.ts [--pdf <файл>]
 * Выход:   content/reference/pumps.json
 *
 * ── Что здесь происходит ───────────────────────────────────────────────────
 * У каталогов в `/content` три разных устройства, и обращаться с ними надо
 * по-разному:
 *
 *  1. SPERONI — рабочие характеристики напечатаны **таблицей**: строка «m3/h»
 *     задаёт расходы, строка модели под ней — напор при каждом из них. Это
 *     разбирается по координатам: значения напора стоят ровно под своими
 *     колонками расхода. Такие точки взяты из текста PDF и не оцифрованы.
 *
 *  2. Grundfos (CM/CME, CR) — только графики. Числовых таблиц Q–H в тексте
 *     нет вовсе; кривая нарисована векторными путями. Такие модели этот
 *     скрипт не берёт: см. `scripts/extract-grundfos-curves.ts`.
 *
 *  3. LEO — распознанный каталог `LEO_Industrial_Pumps_OCR_1.pdf`. Исходные
 *     сканы текстового слоя не имели; распознавание дало и плоский текст, и
 *     PDF с координатами. Берётся PDF (`lib/leo-tables.mjs`): координаты
 *     позволяют привязать напор к своему столбцу расхода, а не к порядковому
 *     номеру слова, и пропуск в клетке перестаёт сдвигать весь ряд.
 *
 * Ни одна точка кривой не достраивается и не интерполируется при извлечении:
 * в выгрузку идёт ровно то, что напечатано.
 */

import { writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPdf, pageItems, toRows } from './lib/pdf-text.mjs';
import { parseLeoPages } from './lib/leo-tables.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const contentDir = path.join(projectRoot, 'content');
const outDir = path.join(contentDir, 'reference');

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Row {
  y: number;
  items: Item[];
}

/** «12,5» → 12.5; «—» → null. */
function num(raw: string): number | null {
  const text = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const hasLetter = (s: string): boolean => /[A-Za-zА-Яа-яÀ-ÿ]/.test(s);

/** Служебные подписи столбца напора, которые не являются частью названия. */
const HEAD_LABELS = new Set(['H', '(m)', 'H (m)', 'm', 'H(m)', '(m']);

/**
 * Подписи строк-единиц: под столбцами расхода в каталоге стоит вторая шапка
 * с тем же расходом в литрах в минуту и в галлонах. Числа в ней выглядят как
 * напор, но моделью такая строка не является.
 */
/**
 * Начало габаритной таблицы. Ниже неё идут размеры в миллиметрах, и их числа
 * иногда попадают в те же столбцы, что и напор, — поэтому разбор строк
 * производительности на этой строке прекращается.
 */
/** «300 W», «16 µF» — это величина с единицей, а не часть названия модели. */
const UNIT_VALUE = /^[\d,.]+\s*(W|kW|Вт|A|µF|μF|uF|mm|kg)$/i;

const TABLE_END = /^(DIMENSIONI|DIMENSIONS|PESO|WEIGHT|GIRANTI|IMPELLERS|TIPO|TYPE)$/i;

const UNIT_ROW_LABELS = /^(lt\/1|l\/min|lt\/min|m3\/h|U\.S\.g\.p\.m\.|lmp\.g\.m\.|Imp\.g\.m\.|Single-phase|Monofase|Three-phase|Trifase|Hm|H m)/i;

export interface CurvePoint {
  qM3h: number;
  hM: number;
}

export interface PumpRecord {
  brand: string;
  model: string;
  /** Второе обозначение той же машины (трёхфазное исполнение и т. п.). */
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
  curve: CurvePoint[];
}

/** Тип насоса по заголовку страницы каталога. */
function pumpType(title: string): PumpRecord['type'] {
  const t = title.toUpperCase();
  if (/SOMMERG|SUBMERSIBLE|SOMMERSA|BOREHOLE|DRAIN|SEWAGE/.test(t)) return 'submersible';
  if (/MULTISTAGE|MULTISTADIO|MULTICELLULAR|MULTI-STAGE/.test(t)) return 'multistage';
  if (/BOOSTER|GRUPPO|GRUPPI|SET |PRESSURE UNIT|AUTOCLAVE/.test(t)) return 'booster_station';
  return 'surface';
}

/** Питание по подписи в шапке таблицы. */
function voltageOf(headerText: string): string {
  const t = headerText.toLowerCase();
  if (/trifase|three-phase/.test(t) && /monofase|single-phase/.test(t)) return '1~230 В / 3~400 В';
  if (/trifase|three-phase/.test(t)) return '3~400 В';
  if (/monofase|single-phase/.test(t)) return '1~230 В';
  return 'уточнить по каталогу';
}

/**
 * Разбор одной страницы каталога SPERONI.
 *
 * Опорная строка — та, где стоит подпись «m3/h»: правее неё столбцы расхода.
 * Строки моделей узнаются по тому, что их числа стоят ровно под этими
 * столбцами; всё, что левее, — название и электрические данные.
 */
function parseSperoniPage(rows: Row[], pageNo: number, sourceFile: string): PumpRecord[] {
  const out: PumpRecord[] = [];

  const pageTitle = rows
    .slice(0, 4)
    .map((r) => r.items.map((i) => i.str).join(' '))
    .join(' ');

  for (let i = 0; i < rows.length; i += 1) {
    const headerRow = rows[i]!;
    const marker = headerRow.items.find((it) => /^m3\/h$/i.test(it.str.trim()));
    if (!marker) continue;

    // Столбцы расхода: всё правее подписи «m3/h», что читается как число.
    const qCols = headerRow.items
      .filter((it) => it.x > marker.x)
      .map((it) => ({ x: it.x, q: num(it.str) }))
      .filter((c): c is { x: number; q: number } => c.q !== null);

    if (qCols.length < 3) continue;

    // Подписи мощности ищем в ближайших строках — они дают колонки HP и kW.
    const nearby = rows.filter((r) => Math.abs(r.y - headerRow.y) < 70);
    const powerCols: Array<{ x: number; kind: 'hp' | 'kw' }> = [];
    for (const row of nearby) {
      for (const it of row.items) {
        const s = it.str.trim();
        if (s === 'HP') powerCols.push({ x: it.x, kind: 'hp' });
        else if (s === 'kW') powerCols.push({ x: it.x, kind: 'kw' });
      }
    }

    const headerText = nearby.map((r) => r.items.map((it) => it.str).join(' ')).join(' ');
    const voltage = voltageOf(headerText);

    // Строки моделей идут ниже шапки, пока значения попадают в столбцы.
    for (let j = i + 1; j < rows.length; j += 1) {
      const row = rows[j]!;
      if (row.y - headerRow.y > 220) break;
      if (row.items.some((it) => TABLE_END.test(it.str.trim()))) break;

      /*
       * Значения напора не всегда лежат по одному в элементе: PDF нередко
       * склеивает соседние ячейки в одну строку («32,7 32,5 32,3»). Поэтому
       * элемент разворачивается в список чисел, а первое из них привязывается
       * к ближайшему столбцу расхода — дальше числа ложатся по столбцам
       * подряд. Если брать только «чисто числовые» элементы, половина точек
       * кривой молча теряется.
       */
      const heads: CurvePoint[] = [];
      let colIdx = 0;

      for (const it of row.items) {
        if (it.x < qCols[0]!.x - 10) continue;

        const parts = it.str.trim().split(/\s+/);
        const values = parts.map(num);
        if (values.length === 0 || values.some((v) => v === null)) continue;

        let start = -1;
        let bestDistance = Infinity;
        for (let c = colIdx; c < qCols.length; c += 1) {
          const d = Math.abs(qCols[c]!.x - it.x);
          if (d < bestDistance) {
            bestDistance = d;
            start = c;
          }
        }
        if (start < 0 || bestDistance > 12) continue;

        values.forEach((value, k) => {
          const column = qCols[start + k];
          if (column) heads.push({ qM3h: column.q, hM: value! });
        });
        colIdx = start + values.length;
      }

      // Меньше трёх точек — это не строка модели, а подпись или размерная таблица.
      if (heads.length < 3) continue;

      const left = row.items.filter((it) => it.x < qCols[0]!.x - 10);
      if (left.length === 0) continue;

      // Строка «lt/1'» — это вторая шапка того же столбца расхода в литрах в
      // минуту, а не модель: её числа тоже стоят под колонками расхода.
      if (left.some((it) => UNIT_ROW_LABELS.test(it.str.trim()))) continue;

      const nameParts: string[] = [];
      const electrical: Array<{ x: number; value: number }> = [];

      for (const it of left) {
        const s = it.str.trim();
        if (HEAD_LABELS.has(s)) continue;

        // Слева числа тоже бывают склеены («25 18,5» — л. с. и кВт).
        const parts = s.split(/\s+/);
        const values = parts.map(num);
        if (values.length > 0 && values.every((v) => v !== null)) {
          for (const value of values) electrical.push({ x: it.x, value: value! });
        } else if (hasLetter(s) && electrical.length === 0 && !UNIT_VALUE.test(s)) {
          // Название стоит слева от чисел; всё буквенное правее — подписи.
          nameParts.push(s);
        }
      }

      if (nameParts.length === 0) continue;

      /*
       * Порядок чисел слева в каталоге постоянен: лошадиные силы, мощность на
       * валу P2, потребляемая P1, дальше токи. Привязка по координате здесь
       * ненадёжна — склеенные элементы («25 18,5») стоят под одним x, — а
       * порядок чтения сохраняется всегда.
       */
      const hasHpColumn = powerCols.some((c) => c.kind === 'hp');
      const hasKwColumn = powerCols.some((c) => c.kind === 'kw');

      /*
       * Если в шапке нет колонки «kW», мощности в таблице нет вовсе: у мелких
       * дренажных насосов там стоят ватты и ёмкость конденсатора. Брать первое
       * попавшееся число за мощность нельзя — получится 1,6 кВт вместо 300 Вт.
       */
      const hp = hasHpColumn ? (electrical[0]?.value ?? null) : null;
      const p2 = hasKwColumn ? (electrical[hasHpColumn ? 1 : 0]?.value ?? null) : null;
      const p1 = hasKwColumn ? (electrical[hasHpColumn ? 2 : 1]?.value ?? null) : null;

      const curve = heads.sort((a, b) => a.qM3h - b.qM3h);

      // Кривая насоса всегда падает: напор не может расти с расходом.
      // Возрастающий участок означает, что в столбцы попала не та строка.
      const falls = curve.every((point, k) => k === 0 || point.hM <= curve[k - 1]!.hM);
      if (!falls) continue;
      // Напор бытового и промышленного насоса лежит в этих пределах; всё, что
      // вне, — это чужие числа из соседней таблицы.
      if (curve[0]!.hM > 500 || curve[curve.length - 1]!.hM < 0) continue;

      const model = nameParts[0]!;
      const alt = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

      // Мощность бытового и промышленного насоса — от 0,1 до 500 кВт.
      // Число вне этого диапазона пришло из габаритной таблицы.
      const sane = (v: number | null): number | null =>
        v !== null && v >= 0.1 && v <= 500 ? v : null;

      out.push({
        brand: 'Speroni',
        model,
        ...(alt ? { altModel: alt } : {}),
        series: pageTitle.trim().slice(0, 80),
        type: pumpType(pageTitle),
        powerKwMin: sane(p2),
        powerKwMax: sane(p1) ?? sane(p2),
        powerHp: sane(hp),
        voltage,
        qMaxM3h: curve[curve.length - 1]!.qM3h,
        hMaxM: Math.max(...curve.map((p) => p.hM)),
        sourceFile: sourceFile,
        sourcePage: pageNo,
        // Точки взяты из напечатанной таблицы, а не сняты с графика.
        digitized: false,
        curve,
      });
    }
  }

  return out;
}

/**
 * Каталог Speroni лежит частями, названными по диапазону листов. Номер листа
 * внутри части и есть то, что человек откроет для сверки, поэтому в
 * `source_page` пишется именно он, а в `source_file` — имя реальной части.
 * Сквозной нумерации у Speroni нет: печатный колонцифр отличается от номера
 * листа, а ручная сверка велась по листам.
 */
const SPERONI_PARTS = [
  'SPERONI-cat-2026-1-192.pdf',
  'SPERONI-cat-2026-193-382.pdf',
];

const LEO_PDF_FILE = 'LEO_Industrial_Pumps_OCR_1.pdf';
const LEO_TEXT_FILE = 'LEO_Industrial_Pumps_text.txt';

interface FileReport {
  file: string;
  pages: number;
  pagesWithText: number;
  pumps: number;
  status: 'parsed' | 'skipped';
  reason?: string;
}

async function run(): Promise<void> {
  const only = process.argv.includes('--pdf')
    ? process.argv[process.argv.indexOf('--pdf') + 1]
    : null;

  const files = (await readdir(contentDir))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .filter((f) => !/HunterCatalog/i.test(f))
    .filter((f) => (only ? f === only : true));

  const pumps: PumpRecord[] = [];
  const reports: FileReport[] = [];

  for (const file of files) {
    const full = path.join(contentDir, file);
    const doc = await loadPdf(full);
    let pagesWithText = 0;
    const before = pumps.length;

    // Каталог LEO читается отдельно, ниже: у него свой разбор.
    if (file === LEO_PDF_FILE) continue;

    const isSperoni = SPERONI_PARTS.includes(file);

    if (isSperoni) {
      for (let p = 1; p <= doc.numPages; p += 1) {
        const items = (await pageItems(doc, p)) as Item[];
        if (items.length > 0) pagesWithText += 1;
        pumps.push(...parseSperoniPage(toRows(items) as Row[], p, file));
      }
    } else {
      /*
       * Файл, который мы не разбираем, читается пробами, а не целиком: чтобы
       * ответить «есть ли текстовый слой», хватает нескольких страниц, а
       * полный проход по сотням страниц сканированного каталога занимает
       * минуты и ничего не добавляет.
       */
      const probes = [0.05, 0.25, 0.5, 0.75, 0.95].map((f) =>
        Math.max(1, Math.min(doc.numPages, Math.round(doc.numPages * f))),
      );
      const seenProbe = new Set<number>();
      let probed = 0;
      for (const p of probes) {
        if (seenProbe.has(p)) continue;
        seenProbe.add(p);
        probed += 1;
        if (((await pageItems(doc, p)) as Item[]).length > 0) pagesWithText += 1;
      }
      // В отчёт идёт доля от проб, а не от всех страниц.
      pagesWithText = Math.round((pagesWithText / probed) * doc.numPages);
    }

    const parsed = pumps.length - before;

    if (isSperoni) {
      reports.push({ file, pages: doc.numPages, pagesWithText, pumps: parsed, status: 'parsed' });
    } else if (pagesWithText === 0) {
      reports.push({
        file,
        pages: doc.numPages,
        pagesWithText,
        pumps: 0,
        status: 'skipped',
        reason:
          'Сканированный каталог: текстового слоя нет ни на одной странице. ' +
          'Без распознавания брать данные неоткуда, а придумывать точки кривой нельзя.',
      });
    } else {
      reports.push({
        file,
        pages: doc.numPages,
        pagesWithText,
        pumps: 0,
        status: 'skipped',
        reason:
          'Рабочие характеристики даны только графиками: числовых таблиц Q–H в тексте нет. ' +
          'Привязать кривую к модели можно лишь по подписям у линий, то есть вручную по одной ' +
          'модели; ошибка привязки даёт правдоподобную кривую не от того насоса.',
      });
    }
  }

  /*
   * LEO: распознанный каталог. Разбор и его ограничения — в
   * `lib/leo-tables.mjs`; сюда попадают только строки, сошедшиеся без починки
   * потерянных десятичных точек.
   */
  const leoPdf = path.join(contentDir, LEO_PDF_FILE);
  if (!only && existsSync(leoPdf)) {
    const doc = await loadPdf(leoPdf);
    const cached: Array<{ page: number; items: Item[] }> = [];
    for (let p = 1; p <= doc.numPages; p += 1) {
      cached.push({ page: p, items: (await pageItems(doc, p)) as Item[] });
    }

    const { pumps: leoPumps, stats } = parseLeoPages(cached);

    for (const p of leoPumps) {
      const curve = [...p.curve].sort((a, b) => a.qM3h - b.qM3h);
      pumps.push({
        brand: 'LEO',
        model: p.model,
        ...(p.altModel ? { altModel: p.altModel } : {}),
        series: 'LEO Industrial Pumps',
        type: pumpType(p.model),
        powerKwMin: p.powerKw,
        powerKwMax: p.powerKw,
        powerHp: null,
        voltage: 'уточнить по каталогу',
        qMaxM3h: curve[curve.length - 1]!.qM3h,
        hMaxM: curve[0]!.hM,
        sourceFile: LEO_PDF_FILE,
        sourcePage: p.page,
        digitized: true,
        digitizedNote:
          `Страница ${p.page} распознанного каталога. Значения взяты из таблицы по ` +
          'координатам столбцов; строки, где распознавание потеряло десятичную точку, ' +
          'отброшены, а не восстановлены.',
        curve,
      });
    }

    reports.push({
      file: LEO_PDF_FILE,
      pages: doc.numPages,
      pagesWithText: doc.numPages,
      pumps: leoPumps.length,
      status: 'parsed',
      reason:
        `Распознанный каталог: таблиц ${stats.tables}, принято строк ${stats.accepted}, ` +
        `отброшено с потерянной десятичной точкой ${stats.rejectedRepairable}, ` +
        `битых ${stats.rejectedBroken}.`,
    });
  }

  if (!only && existsSync(path.join(contentDir, LEO_TEXT_FILE))) {
    reports.push({
      file: LEO_TEXT_FILE,
      pages: 0,
      pagesWithText: 0,
      pumps: 0,
      status: 'skipped',
      reason:
        'Тот же распознанный каталог, но плоским текстом без координат. ' +
        'Разбирается PDF-версия: по координатам столбцы выравниваются надёжнее.',
    });
  }

  // Дубликаты моделей: одна и та же машина встречается в каталоге дважды
  // (например, в разделе насосов и в разделе станций). Оставляем первую.
  const seen = new Set<string>();
  const unique = pumps.filter((p) => {
    const key = `${p.brand}|${p.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'pumps.json'),
    `${JSON.stringify(
      {
        note:
          'Каталоги насосов, извлечённые из PDF в /content скриптом scripts/extract-pump-catalogs.ts. ' +
          'Точки кривой Q–H взяты из напечатанных таблиц; ни одна точка не достроена и не интерполирована. ' +
          'Править файл вручную нельзя — правки затрёт следующая сборка.',
        extractedAt: new Date().toISOString().slice(0, 10),
        generator: 'scripts/extract-pump-catalogs.ts',
        files: reports,
        pumps: unique,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(`Насосов извлечено: ${unique.length} (из ${pumps.length} строк)`);
  for (const r of reports) {
    console.log(
      ` ${r.status === 'parsed' ? '✓' : '·'} ${r.file}: ${r.pumps} моделей, ` +
        `страниц ${r.pages}, с текстом ${r.pagesWithText}${r.reason ? ` — ${r.reason}` : ''}`,
    );
  }
}

await run();
