import { CONTENT_FILES } from './content.js';

/**
 * Реализация той части `node:fs`, которой пользуется слой наполнения базы.
 *
 * В мобильной сборке этот модуль подставляется вместо `node:fs` алиасом из
 * `vite.config.ts`. Читать он умеет только вшитый в бандл контент (см.
 * `content.ts`) — настоящей файловой системы у страницы в WebView нет, и
 * подделывать её целиком незачем: `packages/electron-app/src/main/db` обходится
 * тремя функциями чтения.
 */

export function existsSync(path: string): boolean {
  if (CONTENT_FILES.has(path)) return true;
  // Каталогов в карте нет, поэтому существование папки проверяется по префиксу.
  const prefix = `${path}/`;
  for (const key of CONTENT_FILES.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

export function readFileSync(path: string, _encoding?: string): string {
  const text = CONTENT_FILES.get(path);
  if (text === undefined) {
    throw new Error(`Файл контента отсутствует в сборке: ${path}`);
  }
  return text;
}

/** Имена файлов каталога — как и `node:fs`, без пути и без сортировки. */
export function readdirSync(dir: string): string[] {
  const prefix = `${dir}/`;
  const names = new Set<string>();
  for (const key of CONTENT_FILES.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    // Вложенных каталогов в /content нет, но вести себя как readdir полезнее:
    // отдаём первый сегмент, а не весь остаток пути.
    const slash = rest.indexOf('/');
    names.add(slash === -1 ? rest : rest.slice(0, slash));
  }
  return [...names];
}

/** Каталоги создавать нечего и негде: база лежит в памяти, контент — в бандле. */
export function mkdirSync(_path: string, _options?: unknown): undefined {
  return undefined;
}

export default { existsSync, readFileSync, readdirSync, mkdirSync };
