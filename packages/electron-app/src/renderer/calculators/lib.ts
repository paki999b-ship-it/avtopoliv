import type { FormValues } from './types.js';

/**
 * Чтение значений формы. Формы хранят «сырые» значения (число, строка,
 * пусто), а движок требует чисел и объектов — этот слой их разбирает и
 * внятно ругается, если поле не заполнено.
 */

export function num(values: FormValues, name: string): number {
  const raw = values[name];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`Заполните поле «${name}».`);
  }
  return raw;
}

/** Необязательное число: пустое поле превращается в `undefined`. */
export function optNum(values: FormValues, name: string): number | undefined {
  const raw = values[name];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

export function str(values: FormValues, name: string, fallback = ''): string {
  const raw = values[name];
  return typeof raw === 'string' && raw.length > 0 ? raw : fallback;
}

export function bool(values: FormValues, name: string): boolean {
  return values[name] === true;
}

export function list(values: FormValues, name: string): FormValues[] {
  const raw = values[name];
  return Array.isArray(raw) ? raw : [];
}

/** Значение поля внутри строки списка. */
export function itemNum(item: FormValues, name: string, label: string): number {
  const raw = item[name];
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`Заполните «${label}» во всех строках.`);
  }
  return raw;
}

export function itemStr(item: FormValues, name: string, fallback: string): string {
  const raw = item[name];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

/** Сравнение для подсветки плиток: значение попало в диапазон. */
export function within(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}
