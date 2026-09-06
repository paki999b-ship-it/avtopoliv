/**
 * Учебный контент, вшитый в бандл на этапе сборки.
 *
 * Под Windows каталог `/content` лежит рядом с приложением обычными файлами, и
 * main-процесс читает их через `node:fs` (§8 ТЗ: контент собирается в базу при
 * первом запуске). На Android у страницы в WebView файловой системы нет, а APK
 * неизменяем — поэтому те же JSON попадают внутрь бандла на сборке, а
 * `node:fs` подменяется шимом `fs.ts` поверх этой карты. Источник правды
 * остаётся один: правится `/content`, пересобирается APK.
 *
 * Файлы берутся как текст (`?raw`), а не как разобранный JSON: наполнение
 * базы само зовёт `JSON.parse`, и подпись контента считается по тем же
 * данным, что и на десктопе.
 */

/** Виртуальный путь к каталогу контента — его получает `seedReferenceData`. */
export const CONTENT_DIR = '/content';

const modules = import.meta.glob('../../../../content/**/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

/** Из «../../../../content/academy/01.json» делает «/content/academy/01.json». */
function virtualPath(moduleKey: string): string {
  const marker = '/content/';
  const index = moduleKey.lastIndexOf(marker);
  return index === -1 ? moduleKey : `${CONTENT_DIR}/${moduleKey.slice(index + marker.length)}`;
}

/** Карта «виртуальный путь → содержимое файла». */
export const CONTENT_FILES = new Map(
  Object.entries(modules).map(([key, text]) => [virtualPath(key), text]),
);

/**
 * Отсутствие контента — это не «пустая база», а сломанная сборка: без него
 * не откроется ни один раздел, и молчать об этом нельзя.
 */
export function assertContentBundled(): void {
  if (CONTENT_FILES.size === 0) {
    throw new Error(
      'Учебный контент не попал в сборку: каталог /content не найден на этапе сборки APK.',
    );
  }
}
