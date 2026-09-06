/**
 * Тренажёр «Сборка узла насоса» (уровень 7 Академии).
 *
 * Задание — обвязка, разложенная на позиции: несколько на всасе, несколько на
 * напоре. Пользователь ставит в каждую позицию элемент из палитры.
 *
 * Эталон наружу до проверки не отдаётся: renderer получает только позиции с
 * их подписями и список доступных элементов. Иначе задание решается чтением
 * ответа, а не разбором схемы — то же правило, что и в «Найди ошибку».
 */

import type { RigLine } from '@irrigo/core';

export type AssemblyLine = RigLine;

/** Элемент палитры в том виде, в каком его видит пользователь. */
export interface AssemblyPart {
  key: string;
  label: string;
  hint: string;
}

/** Позиция обвязки до проверки: где она, но не что в ней должно быть. */
export interface AssemblySlotView {
  key: string;
  line: AssemblyLine;
  order: number;
  title: string;
}

export interface AssemblyTaskSummary {
  id: number;
  key: string;
  title: string;
  difficulty: number;
  slotCount: number;
  bestScore: number | null;
  attempts: number;
  completed: boolean;
}

export interface AssemblyTaskDetail extends AssemblyTaskSummary {
  brief: string;
  parts: AssemblyPart[];
  slots: AssemblySlotView[];
}

export interface AssemblySubmission {
  taskKey: string;
  /** Ключ позиции → ключ поставленного элемента. */
  placement: Record<string, string | null>;
}

/** Разбор одной позиции — приходит только в ответе на проверку. */
export interface AssemblySlotReview {
  slotKey: string;
  title: string;
  line: AssemblyLine;
  order: number;
  placed: string | null;
  placedLabel: string | null;
  correct: string;
  correctLabel: string;
  isCorrect: boolean;
  /** Почему здесь должен стоять именно этот элемент. */
  why: string;
  /** Что не так с тем, что поставили, — из описания самого элемента. */
  misplacedNote: string | null;
}

export interface AssemblyResult {
  score: number;
  passed: boolean;
  bestScore: number;
  attempts: number;
  completed: boolean;
  correctCount: number;
  emptyCount: number;
  total: number;
  xpAwarded: number;
  profileXp: number;
  review: AssemblySlotReview[];
}
