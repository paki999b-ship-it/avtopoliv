import { describe, expect, it } from 'vitest';
import { daysBetween, levelFromXp, localDateKey, nextStreak, xpForLevel } from './xp.js';

describe('XP и уровни (§3.10)', () => {
  it('первый уровень стоит 100 XP, дальше по +50 за уровень', () => {
    expect(xpForLevel(1)).toBe(100);
    expect(xpForLevel(2)).toBe(150);
    expect(xpForLevel(5)).toBe(300);
  });

  it('нулевой опыт — первый уровень без набранного прогресса', () => {
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 });
  });

  it('ровно на границе уровень переключается, остаток обнуляется', () => {
    expect(levelFromXp(100)).toEqual({ level: 2, xpIntoLevel: 0, xpForNextLevel: 150 });
    expect(levelFromXp(99)).toEqual({ level: 1, xpIntoLevel: 99, xpForNextLevel: 100 });
    // 100 + 150 = 250 — начало третьего уровня.
    expect(levelFromXp(250)).toEqual({ level: 3, xpIntoLevel: 0, xpForNextLevel: 200 });
    expect(levelFromXp(300)).toEqual({ level: 3, xpIntoLevel: 50, xpForNextLevel: 200 });
  });

  it('отрицательный и дробный опыт не ломают расчёт', () => {
    expect(levelFromXp(-10).level).toBe(1);
    expect(levelFromXp(120.9).level).toBe(2);
  });

  it('сумма стоимостей уровней сходится с обратным преобразованием', () => {
    let total = 0;
    for (let level = 1; level <= 12; level += 1) {
      // На последней единице до границы уровень ещё прежний.
      expect(levelFromXp(total + xpForLevel(level) - 1).level).toBe(level);
      total += xpForLevel(level);
      expect(levelFromXp(total).level).toBe(level + 1);
    }
  });
});

describe('Стрик по дням (§3.10)', () => {
  it('первый заход задаёт стрик в один день', () => {
    expect(nextStreak(null, 0, '2026-08-29')).toBe(1);
  });

  it('повторный заход в тот же день ничего не меняет', () => {
    expect(nextStreak('2026-08-29', 5, '2026-08-29')).toBe(5);
  });

  it('заход на следующий день продлевает стрик', () => {
    expect(nextStreak('2026-08-28', 5, '2026-08-29')).toBe(6);
  });

  it('пропуск дня обнуляет стрик до единицы', () => {
    expect(nextStreak('2026-08-27', 5, '2026-08-29')).toBe(1);
  });

  it('переход через границу месяца считается как один день', () => {
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
    expect(nextStreak('2026-08-31', 3, '2026-09-01')).toBe(4);
  });

  it('переход через смену года считается как один день', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(nextStreak('2026-12-31', 9, '2027-01-01')).toBe(10);
  });

  it('дата из будущего в базе не роняет стрик в ноль', () => {
    // Такое бывает после перевода системных часов назад.
    expect(nextStreak('2026-09-10', 7, '2026-08-29')).toBe(7);
  });

  it('ключ даты берётся по локальному времени, а не по UTC', () => {
    // 23:30 по местному времени — это всё ещё сегодняшний день пользователя,
    // хотя в UTC уже может быть завтра.
    const late = new Date(2026, 7, 29, 23, 30, 0);
    expect(localDateKey(late)).toBe('2026-08-29');
  });
});
