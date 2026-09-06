/**
 * Реализация той части `node:path`, которой пользуется слой работы с базой.
 *
 * Подставляется вместо `node:path` алиасом из `vite.config.ts`. Разделитель
 * здесь всегда «/»: настоящих путей в мобильной сборке нет — есть виртуальные
 * пути к вшитому контенту, и они собираются только этими двумя функциями.
 */

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) return index === 0 ? '/' : '.';
  return path.slice(0, index);
}

export function join(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export default { dirname, join, resolve, basename };
