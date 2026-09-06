/**
 * Режим разработки: Vite отдаёт renderer, esbuild пересобирает main/preload,
 * Electron открывает окно на адрес dev-сервера.
 *
 * Перезапуск Electron при правке main делается вручную (Ctrl+C и заново) —
 * автоперезапуск на этом этапе только мешал бы отладке базы.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({ configFile: resolve(root, 'vite.config.ts') });
await server.listen();
server.printUrls();

const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error('Vite не сообщил адрес dev-сервера.');

const esbuildProc = spawn(process.execPath, [resolve(root, 'scripts/build-electron.mjs')], {
  stdio: 'inherit',
});
await new Promise((done, fail) => {
  esbuildProc.on('exit', (code) => (code === 0 ? done() : fail(new Error(`esbuild: ${code}`))));
});

const electronBin = (await import('electron')).default;
const child = spawn(electronBin, [root], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, NODE_ENV: 'development' },
});

child.on('close', async () => {
  await server.close();
  process.exit(0);
});
