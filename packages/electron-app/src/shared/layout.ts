import type { LayoutHead, LayoutPlan } from '@irrigo/core';

/**
 * Тренажёр раскладки (§3.4 ТЗ): задания, попытки и сравнение с эталоном.
 *
 * Геометрия и оценка живут в `@irrigo/core` — здесь только то, что ходит
 * между главным процессом и интерфейсом.
 */

export interface LayoutTaskSummary {
  id: number;
  key: string;
  title: string;
  brief: string;
  difficulty: number;
  qaVerified: boolean;
  areaM2: number;
  /** Лучший результат профиля по этому заданию, 0…1. */
  bestScore: number | null;
  attempts: number;
  /** Задание засчитано: оценка не ниже проходной. */
  completed: boolean;
}

export interface LayoutTaskDetail extends LayoutTaskSummary {
  plan: LayoutPlan;
  /** Чему учит задание — показывается после сравнения с эталоном. */
  lesson: string;
  qaNotes: string;
  /** Последняя раскладка профиля, чтобы продолжить с того же места. */
  lastAttempt: LayoutHead[] | null;
}

export interface LayoutAttemptDraft {
  taskKey: string;
  heads: LayoutHead[];
}

export interface LayoutAttemptResult {
  score: number;
  passed: boolean;
  bestScore: number;
  attempts: number;
  completed: boolean;
}

/** Эталонное решение отдаётся только после первой попытки. */
export interface LayoutReference {
  heads: LayoutHead[];
  lesson: string;
  qaNotes: string;
}
