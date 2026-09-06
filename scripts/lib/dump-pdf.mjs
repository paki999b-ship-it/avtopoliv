/** Утилита: печать текста PDF по страницам. Использование: node scripts/lib/dump-pdf.mjs <файл> [регэксп] */
import { loadPdf, pageItems, toRows, rowText } from './pdf-text.mjs';
const [file, pattern] = process.argv.slice(2);
const re = pattern ? new RegExp(pattern, 'i') : null;
const doc = await loadPdf(file);
console.error(`Страниц: ${doc.numPages}`);
for (let p = 1; p <= doc.numPages; p++) {
  const rows = toRows(await pageItems(doc, p)).map(rowText);
  const text = rows.join('\n');
  if (!re || re.test(text)) {
    console.log(`\n===== стр. ${p} =====`);
    console.log(text);
  }
}
