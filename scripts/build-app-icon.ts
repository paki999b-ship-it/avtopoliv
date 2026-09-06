/**
 * Иконка приложения для Windows из логотипа бренда.
 *
 * Запуск:  node scripts/build-app-icon.ts
 * Выход:   build/icon.png — квадрат 512×512, из которого electron-builder
 *          сам собирает .ico со всеми нужными размерами.
 *
 * Кодек PNG и масштабирование живут в `lib/png.ts` — они общие с набором
 * иконок Android (`build-android-icons.ts`).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, fitIntoSquare, trimTransparent } from './lib/png.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const SOURCE = path.join(projectRoot, 'content', 'ARTlogo.png');
const OUT_DIR = path.join(projectRoot, 'build');
const OUT = path.join(OUT_DIR, 'icon.png');

/** Сторона квадрата. electron-builder требует не меньше 256. */
const SIDE = 512;
/** Поля вокруг знака, доля стороны: вплотную к краю иконка выглядит обрезанной. */
const MARGIN = 0.06;

const source = decodePng(readFileSync(SOURCE));
const trimmed = trimTransparent(source);
const icon = fitIntoSquare(trimmed, SIDE, MARGIN);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, encodePng(icon));

console.log(`Логотип: ${source.width}×${source.height}`);
console.log(`Без полей: ${trimmed.width}×${trimmed.height}`);
console.log(`Иконка:  ${icon.width}×${icon.height} → ${path.relative(projectRoot, OUT)}`);
