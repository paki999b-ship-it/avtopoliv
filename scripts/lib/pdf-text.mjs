/**
 * Извлечение текста из PDF с координатами. Основа для разбора таблиц каталога.
 * Возвращает по странице список элементов { str, x, y, w, h }.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);

// На Windows require.resolve возвращает путь с диском — для ESM его нужно
// превратить в file:// URL, иначе загрузчик отказывается его принимать.
const pdfjsPath = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
const pdfjs = await import(pdfjsPath);

export async function loadPdf(filePath) {
  const data = new Uint8Array(await (await import('node:fs/promises')).readFile(filePath));
  return pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
}

export async function pageItems(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const vp = page.getViewport({ scale: 1 });
  const items = content.items
    .filter((i) => 'str' in i && i.str.trim() !== '')
    .map((i) => ({
      str: i.str,
      x: i.transform[4],
      y: vp.height - i.transform[5],
      w: i.width,
      h: i.height,
    }));
  page.cleanup();
  return items;
}

/** Склеивает элементы в строки по близости координаты Y. */
export function toRows(items, tolerance = 3) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
    if (row) {
      row.items.push(it);
      row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => a.y - b.y);
}

export const rowText = (row) => row.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
