import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Тесты слоя приложения: миграции, репозитории, стрик и XP.
 *
 * Запускаются на обычном Node (не в Electron): `node:sqlite` встроен в
 * рантайм, а в тестируемых файлах нет импортов из `electron` — модули,
 * которым нужен `app`, вынесены в `main/content/paths.ts`.
 */

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Почему подменяется — см. комментарий в test/node-sqlite-shim.ts.
      'node:sqlite': resolve(__dirname, 'test/node-sqlite-shim.ts'),
    },
  },
});
