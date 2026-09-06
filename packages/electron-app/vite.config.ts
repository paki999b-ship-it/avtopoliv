import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * В сборке действует строгая CSP из `index.html` — приложение офлайн и не
 * должно иметь возможности обратиться наружу (§13 ТЗ). Dev-сервер Vite при
 * этом требует inline-скриптов и WebSocket для HMR, поэтому на время
 * разработки политика ослабляется — но только для localhost и только в dev.
 */
function devCsp(): Plugin {
  const DEV_POLICY =
    "default-src 'none'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    'img-src \'self\' data:; ' +
    'font-src \'self\' data:; ' +
    "connect-src 'self' ws://localhost:* http://localhost:*";

  return {
    name: 'irrigo-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        `$1${DEV_POLICY}$2`,
      );
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Обязательно: в собранном приложении страница грузится по file://,
  // абсолютные пути к ассетам там не находятся.
  base: './',
  plugins: [react(), devCsp()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    // Один бандл вместо разбиения по chunk'ам: страница грузится с диска по
    // file://, а динамический import() оттуда упирается в ограничения
    // источника. Для настольного приложения размер бандла роли не играет —
    // сети здесь нет вовсе.
    chunkSizeWarningLimit: 1200,
  },
  server: { port: 5273, strictPort: true },
  clearScreen: false,
});
