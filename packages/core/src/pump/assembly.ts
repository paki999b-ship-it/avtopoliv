/**
 * Тренажёр «Сборка узла насоса».
 *
 * Задание — обвязка насоса, разложенная на позиции: несколько на всасе,
 * несколько на напоре. Пользователь ставит в каждую позицию элемент из
 * палитры, движок сверяет с эталоном.
 *
 * Почему проверка здесь, а не в интерфейсе: по той же причине, что и в
 * «Найди ошибку» — эталон не должен попадать в renderer до отправки ответа,
 * иначе задание решается чтением ответа, а не разбором схемы. Плюс правило
 * счёта у тренажёров должно быть одно, а не своё в каждом экране.
 */

import { round } from '../format.js';

export type RigLine = 'suction' | 'discharge';

export interface AssemblySlot {
  key: string;
  /** Всас или напор — на схеме это две разные ветки относительно насоса. */
  line: RigLine;
  /** Порядок вдоль ветки, от источника к насосу и от насоса к системе. */
  order: number;
  /** Ключ элемента, который здесь должен стоять. */
  correct: string;
}

export interface AssemblySlotResult {
  slotKey: string;
  /** Что поставил пользователь; `null` — позиция осталась пустой. */
  placed: string | null;
  correct: string;
  isCorrect: boolean;
}

export interface AssemblyOutcome {
  score: number;
  correctCount: number;
  /** Позиции, оставленные пустыми, — считаются как ошибка, но названы отдельно. */
  emptyCount: number;
  total: number;
  results: AssemblySlotResult[];
}

/**
 * Сверка расстановки с эталоном.
 *
 * Один элемент не может стоять в двух позициях сразу: палитра расходуемая, и
 * повторно поставленный элемент — это ошибка расстановки, а не «почти верно».
 * Поэтому дубли не отсеиваются молча: каждая позиция сверяется со своим
 * эталоном, и обе позиции с одним и тем же элементом не могут быть верными.
 */
export function scoreAssembly(
  slots: readonly AssemblySlot[],
  placements: Readonly<Record<string, string | null | undefined>>,
): AssemblyOutcome {
  if (slots.length === 0) throw new Error('В задании нет ни одной позиции обвязки');

  const results: AssemblySlotResult[] = slots.map((slot) => {
    const placed = placements[slot.key] ?? null;
    return {
      slotKey: slot.key,
      placed,
      correct: slot.correct,
      isCorrect: placed === slot.correct,
    };
  });

  const correctCount = results.filter((r) => r.isCorrect).length;
  const emptyCount = results.filter((r) => r.placed === null).length;

  return {
    score: round(correctCount / slots.length, 4),
    correctCount,
    emptyCount,
    total: slots.length,
    results,
  };
}

/** Позиции ветки по порядку — общий для проверки и для отрисовки схемы. */
export function slotsOfLine(
  slots: readonly AssemblySlot[],
  line: RigLine,
): AssemblySlot[] {
  return slots.filter((s) => s.line === line).sort((a, b) => a.order - b.order);
}
