/**
 * Иконки запуска и заставка Android из логотипа бренда.
 *
 * Запуск:  node scripts/build-android-icons.ts
 * Выход:   packages/mobile-app/android/app/src/main/res/
 *            mipmap-<плотность>: ic_launcher, ic_launcher_round,
 *                                ic_launcher_foreground
 *            drawable-port-<плотность>, drawable-land-<плотность>: splash
 *
 * Capacitor кладёт в проект собственные картинки-заглушки, и без этого шага
 * приложение выходило бы с чужим знаком на рабочем столе. Скрипт переписывает
 * их из того же `content/ARTlogo.png`, из которого делается иконка Windows, —
 * второго источника бренда в проекте быть не должно.
 *
 * Кодек PNG и масштабирование — общие, в `lib/png.ts`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePng,
  encodePng,
  fitIntoSquare,
  trimTransparent,
  type Image,
} from './lib/png.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const SOURCE = path.join(projectRoot, 'content', 'ARTlogo.png');
const RES = path.join(
  projectRoot,
  'packages/mobile-app/android/app/src/main/res',
);

/**
 * Фон иконки и заставки — тёмный тон темы (`--iw-bg`, packages/ui/src/theme/theme.css).
 * Логотип светлый, на белом фоне пусковой иконки он терялся бы.
 */
const BACKGROUND: [number, number, number] = [0x08, 0x19, 0x10];

/** Плотности экрана и множитель к базовому размеру в dp. */
const DENSITIES: Array<{ suffix: string; scale: number }> = [
  { suffix: 'mdpi', scale: 1 },
  { suffix: 'hdpi', scale: 1.5 },
  { suffix: 'xhdpi', scale: 2 },
  { suffix: 'xxhdpi', scale: 3 },
  { suffix: 'xxxhdpi', scale: 4 },
];

/** Поля вокруг знака у обычной иконки. */
const ICON_MARGIN = 0.08;

/**
 * Поля у слоя адаптивной иконки.
 *
 * Холст адаптивной иконки — 108 dp, но система обрезает его произвольной
 * формой и гарантирует видимой только центральную область 66 dp. Отсюда поле
 * (108 − 66) / 2 / 108 ≈ 0,195: при меньшем знак срежет на устройствах с
 * круглой маской.
 */
const ADAPTIVE_MARGIN = 0.195;

/** Заставка: знак занимает треть короткой стороны, остальное — фон. */
const SPLASH_LOGO_SHARE = 0.34;

// ── Вспомогательное ────────────────────────────────────────────────────────

/** Кладёт непрозрачный фон под картинку с альфой. */
function onBackground(src: Image, color: [number, number, number]): Image {
  const out = Buffer.alloc(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = src.data[i + 3]! / 255;
    out[i] = Math.round(src.data[i]! * alpha + color[0] * (1 - alpha));
    out[i + 1] = Math.round(src.data[i + 1]! * alpha + color[1] * (1 - alpha));
    out[i + 2] = Math.round(src.data[i + 2]! * alpha + color[2] * (1 - alpha));
    out[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

/**
 * Круглая маска для `ic_launcher_round`.
 *
 * Прошивки, которые просят круглую иконку, сами её не обрезают — они ждут уже
 * круглую картинку. Без маски знак вышел бы квадратом среди круглых соседей.
 */
function circleMask(src: Image): Image {
  const out = Buffer.from(src.data);
  const radius = src.width / 2;
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const dx = x + 0.5 - radius;
      const dy = y + 0.5 - radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Сглаживание по краю в один пиксель: без него окружность «лесенкой».
      const alpha = Math.min(1, Math.max(0, radius - distance));
      const i = (y * src.width + x) * 4;
      out[i + 3] = Math.round(src.data[i + 3]! * alpha);
    }
  }
  return { width: src.width, height: src.height, data: out };
}

/** Знак по центру прямоугольного холста заданного цвета. */
function centeredOnCanvas(
  logo: Image,
  width: number,
  height: number,
  color: [number, number, number],
): Image {
  const side = Math.round(Math.min(width, height) * SPLASH_LOGO_SHARE);
  // Поля нулевые: холст уже больше знака, второй раз ужимать незачем.
  const scaled = fitIntoSquare(logo, side, 0);

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }

  const dx = Math.round((width - side) / 2);
  const dy = Math.round((height - side) / 2);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const from = (y * side + x) * 4;
      const to = ((y + dy) * width + (x + dx)) * 4;
      const alpha = scaled.data[from + 3]! / 255;
      data[to] = Math.round(scaled.data[from]! * alpha + color[0] * (1 - alpha));
      data[to + 1] = Math.round(scaled.data[from + 1]! * alpha + color[1] * (1 - alpha));
      data[to + 2] = Math.round(scaled.data[from + 2]! * alpha + color[2] * (1 - alpha));
    }
  }

  return { width, height, data };
}

function write(dir: string, name: string, image: Image): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), encodePng(image));
}

// ── Сборка ─────────────────────────────────────────────────────────────────

if (!existsSync(RES)) {
  throw new Error(
    `Каталог ресурсов Android не найден: ${RES}\n` +
      'Сначала создайте нативный проект: npm run android:add -w @irrigo/mobile-app',
  );
}

const logo = trimTransparent(decodePng(readFileSync(SOURCE)));

let files = 0;

for (const { suffix, scale } of DENSITIES) {
  const mipmap = path.join(RES, `mipmap-${suffix}`);

  // Обычная и круглая иконка: 48 dp.
  const side = Math.round(48 * scale);
  const square = onBackground(fitIntoSquare(logo, side, ICON_MARGIN), BACKGROUND);
  write(mipmap, 'ic_launcher.png', square);
  write(mipmap, 'ic_launcher_round.png', circleMask(square));

  // Слой адаптивной иконки: 108 dp, фон рисует система по @color/ic_launcher_background.
  const adaptive = Math.round(108 * scale);
  write(mipmap, 'ic_launcher_foreground.png', fitIntoSquare(logo, adaptive, ADAPTIVE_MARGIN));
  files += 3;

  // Заставка: те же плотности, отдельно книжная и альбомная ориентация.
  const shortSide = Math.round(320 * scale);
  const longSide = Math.round(480 * scale);
  write(
    path.join(RES, `drawable-port-${suffix}`),
    'splash.png',
    centeredOnCanvas(logo, shortSide, longSide, BACKGROUND),
  );
  write(
    path.join(RES, `drawable-land-${suffix}`),
    'splash.png',
    centeredOnCanvas(logo, longSide, shortSide, BACKGROUND),
  );
  files += 2;
}

// Заставка без указания плотности — запасной вариант для нестандартных экранов.
write(
  path.join(RES, 'drawable'),
  'splash.png',
  centeredOnCanvas(logo, 480, 800, BACKGROUND),
);
files += 1;

console.log(`Логотип: ${logo.width}×${logo.height}`);
console.log(`Записано файлов: ${files} → ${path.relative(projectRoot, RES)}`);
