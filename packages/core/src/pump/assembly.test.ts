import { describe, expect, it } from 'vitest';
import { scoreAssembly, slotsOfLine } from './assembly.js';
import type { AssemblySlot } from './assembly.js';

const SLOTS: AssemblySlot[] = [
  { key: 's1', line: 'suction', order: 1, correct: 'foot-valve' },
  { key: 's2', line: 'suction', order: 2, correct: 'shutoff' },
  { key: 'd1', line: 'discharge', order: 1, correct: 'check-valve' },
  { key: 'd2', line: 'discharge', order: 2, correct: 'gauge' },
  { key: 'd3', line: 'discharge', order: 3, correct: 'shutoff' },
];

describe('Сборка узла насоса', () => {
  it('полностью верная расстановка даёт единицу', () => {
    const outcome = scoreAssembly(SLOTS, {
      s1: 'foot-valve',
      s2: 'shutoff',
      d1: 'check-valve',
      d2: 'gauge',
      d3: 'shutoff',
    });

    expect(outcome.score).toBe(1);
    expect(outcome.correctCount).toBe(5);
    expect(outcome.emptyCount).toBe(0);
    expect(outcome.results.every((r) => r.isCorrect)).toBe(true);
  });

  it('перепутанные местами элементы засчитываются как две ошибки', () => {
    // Манометр после обратного клапана, а не до него.
    const outcome = scoreAssembly(SLOTS, {
      s1: 'foot-valve',
      s2: 'shutoff',
      d1: 'gauge',
      d2: 'check-valve',
      d3: 'shutoff',
    });

    expect(outcome.correctCount).toBe(3);
    expect(outcome.score).toBeCloseTo(0.6, 4);
    expect(outcome.results.find((r) => r.slotKey === 'd1')!.isCorrect).toBe(false);
    expect(outcome.results.find((r) => r.slotKey === 'd2')!.isCorrect).toBe(false);
  });

  it('пустая позиция — ошибка, но названа отдельно', () => {
    const outcome = scoreAssembly(SLOTS, {
      s1: 'foot-valve',
      s2: 'shutoff',
      d1: 'check-valve',
      d2: 'gauge',
    });

    expect(outcome.emptyCount).toBe(1);
    expect(outcome.correctCount).toBe(4);
    expect(outcome.results.find((r) => r.slotKey === 'd3')!.placed).toBeNull();
  });

  it('один элемент в двух позициях не может быть верным дважды', () => {
    const outcome = scoreAssembly(SLOTS, {
      s1: 'shutoff',
      s2: 'shutoff',
      d1: 'shutoff',
      d2: 'shutoff',
      d3: 'shutoff',
    });

    // Верны только те позиции, где кран и должен стоять по эталону.
    expect(outcome.correctCount).toBe(2);
  });

  it('эталон в ответе есть у каждой позиции — для разбора ошибок', () => {
    const outcome = scoreAssembly(SLOTS, {});
    expect(outcome.results.map((r) => r.correct)).toEqual([
      'foot-valve',
      'shutoff',
      'check-valve',
      'gauge',
      'shutoff',
    ]);
    expect(outcome.score).toBe(0);
  });

  it('задание без позиций отвергается, а не считается пустым результатом', () => {
    expect(() => scoreAssembly([], {})).toThrow(/ни одной позиции/);
  });

  it('позиции ветки отдаются по порядку вдоль трубы', () => {
    expect(slotsOfLine(SLOTS, 'discharge').map((s) => s.key)).toEqual(['d1', 'd2', 'd3']);
    expect(slotsOfLine(SLOTS, 'suction').map((s) => s.key)).toEqual(['s1', 's2']);
  });
});
