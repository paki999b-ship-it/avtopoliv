import { describe, expect, it } from 'vitest';
import { formatDbTime, plural, pluralize, pumpTitle } from './format.js';

describe('Склонение по числу', () => {
  it('следует правилу русского языка, а не «(-ей)»', () => {
    const форма = (n: number) => plural(n, 'запись', 'записи', 'записей');

    expect(форма(1)).toBe('запись');
    expect(форма(2)).toBe('записи');
    expect(форма(4)).toBe('записи');
    expect(форма(5)).toBe('записей');
    expect(форма(10)).toBe('записей');
    // Одиннадцать–четырнадцать — исключение: «одиннадцать записей».
    expect(форма(11)).toBe('записей');
    expect(форма(12)).toBe('записей');
    expect(форма(14)).toBe('записей');
    expect(форма(21)).toBe('запись');
    expect(форма(22)).toBe('записи');
    expect(форма(25)).toBe('записей');
    expect(форма(101)).toBe('запись');
    expect(форма(111)).toBe('записей');
  });

  it('ноль берёт форму множественного числа', () => {
    expect(plural(0, 'урок', 'урока', 'уроков')).toBe('уроков');
  });

  it('подставляет число вместе со словом', () => {
    expect(pluralize(1, 'зона', 'зоны', 'зон')).toBe('1 зона');
    expect(pluralize(3, 'зона', 'зоны', 'зон')).toBe('3 зоны');
    expect(pluralize(8, 'зона', 'зоны', 'зон')).toBe('8 зон');
  });
});

describe('Время из базы', () => {
  it('читается как UTC и переводится в локальную зону', () => {
    // SQLite пишет datetime('now') в UTC без указания зоны.
    const utc = '2026-08-29 10:46:34';
    const expected = new Date('2026-08-29T10:46:34Z').toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    expect(formatDbTime(utc)).toBe(expected);
  });

  it('не сдвигает время, у которого зона уже указана', () => {
    const iso = '2026-08-29T10:46:34Z';
    expect(formatDbTime(iso)).toBe(formatDbTime('2026-08-29 10:46:34'));
  });

  it('нечитаемую строку отдаёт как есть, а не «Invalid Date»', () => {
    expect(formatDbTime('не дата')).toBe('не дата');
  });
});

describe('Подпись насоса', () => {
  it('содержит паспортный расход в скобках', () => {
    expect(pumpTitle({ brand: 'LEO', model: 'EvP6-7', qMaxM3h: 6 })).toBe(
      'LEO EvP6-7 (до 6,0 м³/ч)',
    );
  });

  it('дробный расход не округляется до целого', () => {
    expect(pumpTitle({ brand: 'Speroni', model: 'SCMX 6-7 L', qMaxM3h: 8.4 })).toContain(
      '8,4 м³/ч',
    );
  });
});
