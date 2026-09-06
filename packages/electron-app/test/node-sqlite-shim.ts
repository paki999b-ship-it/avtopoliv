/**
 * Обходной путь для тестов.
 *
 * Node 24 сообщает встроенный модуль в `builtinModules` как «node:sqlite»
 * — c префиксом, тогда как остальные перечислены без него. Vite 5 проверяет
 * принадлежность к встроенным по имени без префикса, не находит «sqlite» и
 * пытается искать пакет на диске. Здесь модуль подгружается напрямую через
 * `createRequire`, минуя резолвер Vite. В сборке приложения esbuild
 * справляется сам, поэтому подмена действует только под vitest.
 */
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
const sqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export const DatabaseSync = sqlite.DatabaseSync;
export const StatementSync = sqlite.StatementSync;
export default sqlite;
