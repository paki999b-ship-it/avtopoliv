/**
 * Каталог Hunter Vol. 41 (RU), разбитый на части.
 *
 * Каталог лежит в `/content` не одним файлом, а несколькими: части названы по
 * диапазону полос («…-1-124.pdf», «…-125-228.pdf»). Скрипты извлечения
 * оперируют **номерами полос каталога**, а не листами внутри части: `source_page`
 * в базе обязан указывать на настоящую страницу издания, иначе ссылка «стр. 3
 * файла part-2» никому ничего не говорит.
 *
 * ── Почему порядок не берётся из имён ──────────────────────────────────────
 * Алфавитная сортировка имён не обязана совпадать с порядком полос: «-1-124»
 * и «-125-228» сортируются верно случайно, а «-9-…» встало бы после «-10-…».
 * Поэтому диапазон объявлен явно, а при открытии сверяется с **печатным
 * номером полосы** внутри самого документа. Если каталог переразобьют иначе,
 * сборка упадёт с внятной ошибкой, а не молча сдвинет все ссылки.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..', '..');
const contentDir = path.join(projectRoot, 'content');

const pdfText = await import(pathToFileURL(path.join(here, 'pdf-text.mjs')).href);
const { loadPdf, pageItems, toRows, rowText } = pdfText;

/** Части каталога: файл и диапазон полос издания, который в нём лежит. */
export const CATALOG_PARTS = [
  { file: '00-RC-001-CA-Vol41-HunterCatalog-RU-1-124.pdf', firstPage: 1, lastPage: 124 },
  { file: '00-RC-001-CA-Vol41-HunterCatalog-RU-125-228.pdf', firstPage: 125, lastPage: 228 },
];

export const CATALOG_SOURCE = 'Каталог Hunter, издание 41 (RU)';

/** Печатный номер полосы: в подвале страницы каталога стоит одинокое число. */
function printedFolio(rows) {
  const tail = rows.slice(-3).map(rowText).join(' ');
  const numbers = [...tail.matchAll(/\b(\d{1,3})\b/g)].map((m) => Number(m[1]));
  return numbers.length > 0 ? numbers[numbers.length - 1] : null;
}

/**
 * Открывает все части и возвращает читалку по номерам полос каталога.
 *
 * Проверяются три вещи: файлы на месте, число листов совпадает с объявленным
 * диапазоном, а печатный номер полосы на контрольном листе сходится с
 * расчётным. Любое расхождение — ошибка, а не предупреждение: молча съехавшая
 * на страницу нумерация превращает все ссылки на источник в ложные.
 */
export async function openCatalog() {
  const parts = [];

  for (const part of CATALOG_PARTS) {
    const full = path.join(contentDir, part.file);
    if (!existsSync(full)) {
      throw new Error(
        `Нет части каталога «${part.file}». Ожидались файлы: ` +
          CATALOG_PARTS.map((p) => p.file).join(', '),
      );
    }

    const doc = await loadPdf(full);
    const expected = part.lastPage - part.firstPage + 1;
    if (doc.numPages !== expected) {
      throw new Error(
        `${part.file}: листов ${doc.numPages}, а по диапазону ${part.firstPage}–${part.lastPage} ` +
          `должно быть ${expected}`,
      );
    }

    /*
     * Сверка нумерации. Проб несколько, потому что подвал есть не на каждом
     * листе: на титуле, разделителях и разворотах номера нет вовсе, и одна
     * неудачная проба ничего не доказывает. Расхождение хотя бы на одной
     * найденной полосе — ошибка; полное отсутствие номеров — тоже, иначе
     * проверка выродилась бы в её отсутствие.
     */
    const probes = [];
    for (const fraction of [0.15, 0.35, 0.55, 0.75, 0.95]) {
      const local = Math.max(1, Math.min(doc.numPages, Math.round(doc.numPages * fraction)));
      if (probes.includes(local)) continue;
      probes.push(local);
    }

    let matched = 0;
    for (const local of probes) {
      const folio = printedFolio(toRows(await pageItems(doc, local)));
      if (folio === null || folio < 1 || folio > 400) continue;

      const expectedFolio = part.firstPage + local - 1;
      if (folio !== expectedFolio) {
        throw new Error(
          `${part.file}: на листе ${local} напечатана полоса ${folio}, ` +
            `а по диапазону ожидалась ${expectedFolio} — части перепутаны или разбиты иначе`,
        );
      }
      matched += 1;
    }

    if (matched === 0) {
      throw new Error(
        `${part.file}: ни на одной из проб (${probes.join(', ')}) не нашлось номера полосы — ` +
          'сверить сквозную нумерацию нечем',
      );
    }

    parts.push({ ...part, doc, file: part.file });
  }

  parts.sort((a, b) => a.firstPage - b.firstPage);

  // Диапазоны должны идти встык, без пропусков и нахлёстов: пропуск означает
  // потерянные страницы, нахлёст — дубли в выгрузке.
  for (let i = 1; i < parts.length; i += 1) {
    if (parts[i].firstPage !== parts[i - 1].lastPage + 1) {
      throw new Error(
        `Разрыв между частями: ${parts[i - 1].file} кончается на ${parts[i - 1].lastPage}, ` +
          `${parts[i].file} начинается с ${parts[i].firstPage}`,
      );
    }
  }

  const totalPages = parts[parts.length - 1].lastPage;

  const partOf = (catalogPage) => {
    const part = parts.find((p) => catalogPage >= p.firstPage && catalogPage <= p.lastPage);
    if (!part) throw new Error(`Полосы ${catalogPage} нет в каталоге (всего ${totalPages})`);
    return part;
  };

  return {
    totalPages,
    parts: parts.map((p) => ({ file: p.file, firstPage: p.firstPage, lastPage: p.lastPage })),

    /** Элементы текста полосы каталога — номер сквозной, как в издании. */
    async items(catalogPage) {
      const part = partOf(catalogPage);
      return pageItems(part.doc, catalogPage - part.firstPage + 1);
    },

    /** Строки полосы каталога. */
    async rows(catalogPage) {
      return toRows(await this.items(catalogPage));
    },

    /** В какой части лежит полоса — для отчёта о стыках. */
    fileOf(catalogPage) {
      return partOf(catalogPage).file;
    },

    /** Полоса стоит на стыке частей: последняя в своей части или первая. */
    onSeam(catalogPage) {
      const part = partOf(catalogPage);
      return catalogPage === part.firstPage || catalogPage === part.lastPage;
    },
  };
}
