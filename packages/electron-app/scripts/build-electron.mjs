/**
 * Сборка main и preload через esbuild.
 *
 * Почему esbuild, а не Vite: на целевой машине политика Application Control
 * блокирует нативные .node-аддоны, поэтому Rollup работает WASM-сборкой и
 * медленно. esbuild поставляется отдельным .exe и запускается нормально
 * (DECISIONS.md, решение 2).
 *
 * Формат — CJS: main обращается к __dirname, а preload в Electron надёжнее
 * грузится именно как CommonJS.
 */
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  // Electron и встроенные модули Node подставляет рантайм, а не бандл.
  external: ['electron', 'node:sqlite'],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
};

const targets = [
  { entryPoints: [resolve(root, 'src/main/index.ts')], outfile: resolve(root, 'dist/main/index.cjs') },
  { entryPoints: [resolve(root, 'src/preload/index.ts')], outfile: resolve(root, 'dist/preload/index.cjs') },
];

if (watch) {
  for (const target of targets) {
    const ctx = await context({ ...common, ...target });
    await ctx.watch();
  }
  console.log('[esbuild] main и preload в режиме watch');
} else {
  await Promise.all(targets.map((target) => build({ ...common, ...target })));
}
