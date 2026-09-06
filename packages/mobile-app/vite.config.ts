import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Сборка веб-бандла, который Capacitor кладёт внутрь APK как ассеты.
 *
 * Ключевая мысль конфигурации: мобильная сборка не содержит собственной копии
 * приложения. Экраны берутся из `packages/electron-app/src/renderer`, правила
 * работы с базой — из `.../src/main/db`, а всё, что на десктопе даёт Node,
 * подменяется алиасами на модули из `src/platform`:
 *
 *   node:sqlite → sql.js (SQLite в WebAssembly, синхронный API как у node)
 *   node:fs     → чтение вшитого в бандл каталога /content
 *   node:path   → минимальные dirname/join поверх «/»
 *
 * Благодаря этому под Android не существует второй реализации ни расчётов, ни
 * запросов к базе, ни наполнения справочников.
 */

const repoRoot = resolve(__dirname, '../..');
const electronApp = resolve(repoRoot, 'packages/electron-app');

/**
 * Послабление CSP только для dev-сервера.
 *
 * Боевая политика в `index.html` запрещает инлайновые скрипты, а Vite в режиме
 * разработки вставляет ровно такой скрипт для горячей перезагрузки и общается
 * с сервером по ws://. Ослаблять боевую политику ради этого нельзя, поэтому
 * послабление живёт здесь и в сборку не попадает.
 */
function devCsp(): Plugin {
  return {
    name: 'irrigo-mobile-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
        .replace("connect-src 'self'", "connect-src 'self' ws: http://localhost:*");
    },
  };
}

export default defineConfig({
  root: __dirname,
  // Пути к ассетам относительные: WebView отдаёт бандл с https://localhost
  // либо с file:// в зависимости от версии Android.
  base: './',

  resolve: {
    alias: [
      // Подмена узловых модулей — см. комментарий в шапке файла.
      { find: /^node:sqlite$/, replacement: resolve(__dirname, 'src/platform/node-sqlite.ts') },
      { find: /^node:fs$/, replacement: resolve(__dirname, 'src/platform/node-fs.ts') },
      { find: /^node:path$/, replacement: resolve(__dirname, 'src/platform/node-path.ts') },

      // Те же псевдонимы, что и в настольной сборке, плюс доступ к слою main:
      // под Android он выполняется прямо на странице.
      { find: '@shared', replacement: resolve(electronApp, 'src/shared') },
      { find: '@renderer', replacement: resolve(electronApp, 'src/renderer') },
      { find: '@main', replacement: resolve(electronApp, 'src/main') },
    ],
  },

  plugins: [react(), devCsp()],

  server: {
    port: 5274,
    strictPort: true,
    // Renderer и контент лежат вне корня этого пакета: без явного разрешения
    // dev-сервер откажется их отдавать.
    fs: { allow: [repoRoot] },
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // Учебный контент вшит в бандл (2–3 МБ JSON), sql.js — эмскриптеновский
    // модуль: крупные чанки здесь по природе, и предупреждение только шумит.
    chunkSizeWarningLimit: 4000,
  },

  // sql.js — UMD-модуль от Emscripten: предварительная оптимизация ломает его
  // загрузчик wasm, а размер бандла от неё не меняется.
  optimizeDeps: { exclude: ['sql.js'] },
});
