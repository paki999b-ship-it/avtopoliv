import { describe, expect, it } from 'vitest';
import {
  ACADEMY_LESSON_KEYS,
  ACADEMY_PLAN,
  academyLevel,
  isAcademyLessonKey,
  levelOfLesson,
} from './academy-plan.js';
import { CALCULATORS } from './registry.js';

/**
 * Программа курса — единственный источник правды о составе Академии.
 * Эти тесты держат её согласованной с тем, что на неё ссылается.
 */

describe('Программа курса (§4)', () => {
  it('содержит уровни курса в заданном порядке', () => {
    // Шесть уровней курса из §4 плюс седьмой, добавленный отдельной задачей:
    // обвязка и защита насосного агрегата.
    expect(ACADEMY_PLAN).toHaveLength(7);
    expect(ACADEMY_PLAN.map((l) => l.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(ACADEMY_PLAN.map((l) => l.key)).toEqual([
      'basics',
      'water_plants',
      'equipment',
      'design',
      'automation',
      'operation',
      'pump_rig',
    ]);
  });

  it('у каждого уровня число уроков в границах §4', () => {
    // §4 задаёт вилки: 8–10 уроков для уровней 1, 2, 5, 6 и 10–12 для 3 и 4.
    const bounds: Record<string, [number, number]> = {
      basics: [8, 10],
      water_plants: [8, 10],
      equipment: [10, 12],
      design: [10, 12],
      automation: [8, 10],
      operation: [8, 10],
      // Уровень 7 задан не вилкой §4, а составом тем задачи: десять
      // обязательных элементов обвязки плюс дополнительные и итоговая схема.
      pump_rig: [10, 14],
    };

    for (const level of ACADEMY_PLAN) {
      const [min, max] = bounds[level.key]!;
      expect(level.lessons.length, level.key).toBeGreaterThanOrEqual(min);
      expect(level.lessons.length, level.key).toBeLessThanOrEqual(max);
    }
  });

  it('ключи уроков уникальны по всему курсу', () => {
    expect(new Set(ACADEMY_LESSON_KEYS).size).toBe(ACADEMY_LESSON_KEYS.length);
  });

  it('каждый урок принадлежит ровно одному уровню', () => {
    for (const key of ACADEMY_LESSON_KEYS) {
      const owners = ACADEMY_PLAN.filter((l) => l.lessons.includes(key));
      expect(owners, key).toHaveLength(1);
      expect(levelOfLesson(key)?.key).toBe(owners[0]!.key);
    }
  });

  it('ключи уроков записаны в едином виде', () => {
    for (const key of ACADEMY_LESSON_KEYS) {
      expect(key, key).toMatch(/^[a-z]+(-[a-z0-9]+)+$/);
    }
  });
});

describe('Ссылки на уроки не ведут в пустоту', () => {
  it('каждый калькулятор ссылается на урок из программы (§3.2)', () => {
    for (const calculator of CALCULATORS) {
      expect(
        isAcademyLessonKey(calculator.lessonKey),
        `${calculator.key} → ${calculator.lessonKey}`,
      ).toBe(true);
    }
  });

  it('на неизвестный уровень отвечает ошибкой', () => {
    expect(() => academyLevel('nope' as never)).toThrow(/Неизвестный уровень/);
  });

  it('несуществующий ключ урока не выдаётся за существующий', () => {
    expect(isAcademyLessonKey('basics-nonexistent')).toBe(false);
    expect(levelOfLesson('basics-nonexistent')).toBeUndefined();
  });
});
