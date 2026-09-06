/**
 * Форматирование для русского интерфейса.
 *
 * Числовое форматирование живёт в движке (`fmt` из `@irrigo/core`); здесь —
 * то, что нужно только представлению: склонение, локальное время и подписи
 * каталожных изделий.
 */
import { fmt } from '@irrigo/core';

/**
 * Склонение существительного по числу: 1 запись, 2 записи, 5 записей.
 *
 * Правило русского языка, а не «(-ей)»: подписи вида «1 записей» выглядят
 * как недоделка, а их в интерфейсе много.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;

  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «5 записей» — число вместе со склонённым словом. */
export function pluralize(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}

/**
 * Время из базы в локальное время пользователя.
 *
 * SQLite пишет `datetime('now')` в UTC и без указания зоны, поэтому строку
 * нужно явно пометить как UTC — иначе браузер прочитает её как локальную и
 * покажет расчёт, сделанный минуту назад, сделанным несколько часов назад.
 */
export function formatDbTime(value: string): string {
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Паспортный расход насоса в подписи: «LEO EvP6-7 (до 6,0 м³/ч)».
 *
 * Без него название модели ничего не говорит о классе машины: в списке подбора
 * рядом стоят насос на шесть кубометров в час и станция на двадцать четыре, и
 * различить их можно было только по кривой на графике.
 */
export function pumpTitle(pump: { brand: string; model: string; qMaxM3h: number }): string {
  return `${pump.brand} ${pump.model} (до ${fmt(pump.qMaxM3h, 1)} м³/ч)`;
}
