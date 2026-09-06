import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Тесты мобильной оболочки идут в Node, но с теми же подменами модулей, что и
 * сборка APK: иначе проверялся бы не тот код, который попадает на устройство.
 *
 * Подменяются те же три модуля, что и в `vite.config.ts`. Ничего, кроме кода
 * приложения, их не импортирует, поэтому окружению тестов подмена не мешает.
 */

const repoRoot = resolve(__dirname, '../..');
const electronApp = resolve(repoRoot, 'packages/electron-app');

export default defineConfig({
  resolve: {
    alias: [
      { find: /^node:sqlite$/, replacement: resolve(__dirname, 'src/platform/node-sqlite.ts') },
      { find: /^node:fs$/, replacement: resolve(__dirname, 'src/platform/node-fs.ts') },
      { find: /^node:path$/, replacement: resolve(__dirname, 'src/platform/node-path.ts') },
      { find: '@shared', replacement: resolve(electronApp, 'src/shared') },
      { find: '@renderer', replacement: resolve(electronApp, 'src/renderer') },
      { find: '@main', replacement: resolve(electronApp, 'src/main') },
    ],
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Наполнение справочников из реального /content под SQLite в WebAssembly
    // заметно медленнее нативного драйвера — это и есть предмет проверки.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
