import { describe, expect, it } from 'vitest';
import { scoreScenario } from './score.js';

/**
 * Оценка «Найди ошибку»: главное свойство — угадывание не окупается.
 */

const ITEMS = [
  { key: 'a', isError: true },
  { key: 'b', isError: true },
  { key: 'c', isError: true },
  { key: 'd', isError: false },
  { key: 'e', isError: false },
] as const;

describe('scoreScenario', () => {
  it('все ошибки найдены и ничего лишнего — единица', () => {
    const result = scoreScenario(ITEMS, ['a', 'b', 'c']);

    expect(result.score).toBe(1);
    expect(result.found).toEqual(['a', 'b', 'c']);
    expect(result.missed).toEqual([]);
    expect(result.falsePositives).toEqual([]);
  });

  it('ничего не отмечено — ноль, а не «две трети за бездействие»', () => {
    const result = scoreScenario(ITEMS, []);

    expect(result.score).toBe(0);
    expect(result.missed).toHaveLength(3);
  });

  it('отмечено всё подряд — стратегия не окупается', () => {
    // 3 находки минус 2 ложных = 1 из 3.
    const result = scoreScenario(ITEMS, ['a', 'b', 'c', 'd', 'e']);

    expect(result.score).toBeCloseTo(1 / 3, 3);
    expect(result.falsePositives).toEqual(['d', 'e']);
  });

  it('ложное срабатывание весит столько же, сколько находка', () => {
    const clean = scoreScenario(ITEMS, ['a', 'b']);
    const dirty = scoreScenario(ITEMS, ['a', 'b', 'd']);

    // Оценка округляется до тысячных, поэтому разность сравнивается до сотых.
    expect(clean.score - dirty.score).toBeCloseTo(1 / 3, 2);
  });

  it('оценка не уходит ниже нуля', () => {
    const result = scoreScenario(ITEMS, ['d', 'e']);

    expect(result.score).toBe(0);
    expect(result.found).toEqual([]);
  });

  it('повторные и незнакомые ключи не влияют на счёт', () => {
    const result = scoreScenario(ITEMS, ['a', 'a', 'b', 'c', 'zzz']);

    expect(result.score).toBe(1);
    expect(result.falsePositives).toEqual([]);
  });

  it('сценарий без ошибок даёт ноль, а не деление на ноль', () => {
    const result = scoreScenario([{ key: 'x', isError: false }], ['x']);

    expect(result.score).toBe(0);
    expect(Number.isFinite(result.score)).toBe(true);
  });
});
