/**
 * Минимальный кодек PNG и вписывание картинки в квадрат.
 *
 * ── Почему свой код, а не библиотека ───────────────────────────────────────
 * Нужны две операции: уменьшить логотип и вписать его в квадрат. Ради них
 * тянуть sharp нельзя (нативный модуль, а политика Application Control на
 * целевой машине их блокирует — DECISIONS.md, решение 1), а jimp — это десятки
 * мегабайт зависимостей в проекте, который собирается офлайн. PNG без
 * интерлейса распаковывается штатным zlib и полусотней строк кода.
 *
 * Поддерживается ровно тот формат, в котором лежит логотип: 8 бит, RGBA,
 * без интерлейса. Любой другой — ошибка, а не молчаливая порча картинки.
 *
 * Модуль общий для иконки Windows (`build-app-icon.ts`) и набора иконок
 * Android (`build-android-icons.ts`): второй кодек PNG в проекте не нужен.
 */

import { deflateSync, inflateSync } from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, по 4 байта на пиксель. */
  data: Buffer;
}

export const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);



// ── Чтение ─────────────────────────────────────────────────────────────────

export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error('Это не PNG');

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  let offset = 8;
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.subarray(offset + 4, offset + 8).toString('latin1');
    const body = file.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      const colorType = body[9];
      const interlace = body[12];
      if (depth !== 8) throw new Error(`Поддерживается только 8 бит на канал, а здесь ${depth}`);
      if (colorType !== 6) throw new Error(`Поддерживается только RGBA, а тип цвета здесь ${colorType}`);
      if (interlace !== 0) throw new Error('Интерлейсный PNG не поддерживается');
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }

    offset += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const data = Buffer.alloc(width * height * bpp);

  /*
   * Снятие фильтров построчно. Каждая строка начинается байтом фильтра, и
   * предсказание берётся из уже восстановленных пикселей — своих слева и
   * строки сверху.
   */
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[position + x]!;
      const left = x >= bpp ? data[rowStart + x - bpp]! : 0;
      const up = y > 0 ? data[prevStart + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? data[prevStart + x - bpp]! : 0;

      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          restored = value + predictor;
          break;
        }
        default:
          throw new Error(`Неизвестный фильтр строки: ${filter}`);
      }

      data[rowStart + x] = restored & 0xff;
    }

    position += stride;
  }

  return { width, height, data };
}

// ── Масштабирование ────────────────────────────────────────────────────────

/**
 * Усреднение по исходному прямоугольнику (box filter).
 *
 * Ближайший сосед на уменьшении в два с лишним раза съедает тонкие линии
 * знака: у логотипа это обводка плашки и ветви деревьев. Усреднение их
 * сохраняет. Цвет считается с учётом альфы, иначе прозрачные пиксели по краю
 * затягивают контур в чёрный.
 */
export function resize(src: Image, width: number, height: number): Image {
  const out = Buffer.alloc(width * height * 4);
  const scaleX = src.width / width;
  const scaleY = src.height / height;

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));

    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let weight = 0;

      for (let sy = y0; sy < y1 && sy < src.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < src.width; sx += 1) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.data[i + 3]! / 255;
          r += src.data[i]! * alpha;
          g += src.data[i + 1]! * alpha;
          b += src.data[i + 2]! * alpha;
          a += src.data[i + 3]!;
          weight += alpha;
        }
      }

      const count = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      // Делим на суммарную альфу: усреднять цвет прозрачных пикселей нельзя.
      out[o] = weight > 0 ? Math.round(r / weight) : 0;
      out[o + 1] = weight > 0 ? Math.round(g / weight) : 0;
      out[o + 2] = weight > 0 ? Math.round(b / weight) : 0;
      out[o + 3] = Math.round(a / count);
    }
  }

  return { width, height, data: out };
}

/**
 * Обрезка полностью прозрачных полей вокруг знака.
 *
 * Без неё пустые поля исходника складываются с нашими, и знак в иконке
 * оказывается заметно мельче, чем мог бы, — а на 32×32 в панели задач важен
 * каждый пиксель.
 */
export function trimTransparent(src: Image): Image {
  let top = 0;
  let bottom = src.height - 1;
  let left = 0;
  let right = src.width - 1;

  const rowEmpty = (y: number): boolean => {
    for (let x = 0; x < src.width; x += 1) {
      if (src.data[(y * src.width + x) * 4 + 3]! !== 0) return false;
    }
    return true;
  };
  const columnEmpty = (x: number): boolean => {
    for (let y = 0; y < src.height; y += 1) {
      if (src.data[(y * src.width + x) * 4 + 3]! !== 0) return false;
    }
    return true;
  };

  while (top < bottom && rowEmpty(top)) top += 1;
  while (bottom > top && rowEmpty(bottom)) bottom -= 1;
  while (left < right && columnEmpty(left)) left += 1;
  while (right > left && columnEmpty(right)) right -= 1;

  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width === src.width && height === src.height) return src;

  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y + top) * src.width + left) * 4;
    src.data.copy(data, y * width * 4, from, from + width * 4);
  }
  return { width, height, data };
}

/** Вписывание в квадрат с полями, по центру. Фон прозрачный. */
export function fitIntoSquare(src: Image, side: number, margin: number): Image {
  const box = Math.round(side * (1 - margin * 2));
  const scale = Math.min(box / src.width, box / src.height);
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));

  const scaled = resize(src, width, height);
  const out = Buffer.alloc(side * side * 4); // прозрачный по умолчанию

  const dx = Math.round((side - width) / 2);
  const dy = Math.round((side - height) / 2);

  for (let y = 0; y < height; y += 1) {
    const from = y * width * 4;
    const to = ((y + dy) * side + dx) * 4;
    scaled.data.copy(out, to, from, from + width * 4);
  }

  return { width: side, height: side, data: out };
}

// ── Запись ─────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, tail]);
}

export function encodePng(image: Image): Buffer {
  const stride = image.width * 4;
  // Фильтр 0 у каждой строки: картинка маленькая, экономия на фильтрах здесь
  // не стоит усложнения кодировщика.
  const raw = Buffer.alloc((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    raw[y * (stride + 1)] = 0;
    image.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8; // бит на канал
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
