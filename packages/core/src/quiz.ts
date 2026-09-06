/**
 * Проверка ответов на вопросы теста (§3.7).
 *
 * Расчётные вопросы (`numeric`) проверяются здесь, а не сравнением строк:
 * ответ засчитывается, если укладывается в допуск `tolerancePercent`.
 * Тот же движок используется мини-тестами Академии и экзаменом.
 */

import { round } from './format.js';

export type QuestionType = 'single' | 'multi' | 'numeric' | 'match' | 'scenario';

export interface NumericCheckResult {
  correct: boolean;
  /** Отклонение от эталона, %. */
  deviationPercent: number;
  /** Допустимый интервал. */
  acceptedRange: { min: number; max: number };
}

/**
 * Проверка числового ответа с допуском.
 * Допуск по умолчанию — 5 %, как в большинстве инженерных задач курса.
 */
export function checkNumericAnswer(
  given: number,
  expected: number,
  tolerancePercent = 5,
): NumericCheckResult {
  if (!Number.isFinite(given)) {
    return {
      correct: false,
      deviationPercent: Number.POSITIVE_INFINITY,
      acceptedRange: { min: expected, max: expected },
    };
  }
  const tol = Math.abs(expected) * (tolerancePercent / 100);
  // Для эталона, равного нулю, допуск считается абсолютным.
  const span = expected === 0 ? tolerancePercent / 100 : tol;
  const min = expected - span;
  const max = expected + span;
  const deviation = expected === 0 ? Math.abs(given) * 100 : ((given - expected) / expected) * 100;
  return {
    correct: given >= min && given <= max,
    deviationPercent: round(deviation, 2),
    acceptedRange: { min: round(min, 4), max: round(max, 4) },
  };
}

/** Одиночный выбор: индекс варианта. */
export function checkSingleAnswer(given: number, correctIndex: number): boolean {
  return given === correctIndex;
}

/**
 * Множественный выбор: засчитывается только полное совпадение множества.
 * Частично верный ответ в инженерных проверках — неверный ответ.
 */
export function checkMultiAnswer(given: number[], correct: number[]): boolean {
  if (given.length !== correct.length) return false;
  const a = [...given].sort((x, y) => x - y);
  const b = [...correct].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

/** Сопоставление: пары «левый элемент → правый элемент». */
export function checkMatchAnswer(
  given: Record<string, string>,
  correct: Record<string, string>,
): { correct: boolean; correctPairs: number; totalPairs: number } {
  const keys = Object.keys(correct);
  const hits = keys.filter((k) => given[k] === correct[k]).length;
  return { correct: hits === keys.length, correctPairs: hits, totalPairs: keys.length };
}

/**
 * Сценарий «что не так на схеме»: пользователь отмечает ошибки по их id.
 * Ложные срабатывания штрафуются, чтобы нельзя было отметить всё подряд.
 */
export function checkScenarioAnswer(
  given: string[],
  correct: string[],
): { correct: boolean; found: number; missed: number; falsePositives: number; score: number } {
  const givenSet = new Set(given);
  const correctSet = new Set(correct);
  const found = correct.filter((id) => givenSet.has(id)).length;
  const falsePositives = given.filter((id) => !correctSet.has(id)).length;
  const missed = correct.length - found;
  const raw = correct.length === 0 ? 0 : (found - falsePositives) / correct.length;
  const score = Math.max(0, Math.min(1, raw));
  return { correct: found === correct.length && falsePositives === 0, found, missed, falsePositives, score };
}

export interface ExamScore {
  totalQuestions: number;
  correctAnswers: number;
  percent: number;
  passed: boolean;
  passThresholdPercent: number;
  /** Доля расчётных вопросов в билете, %. */
  numericSharePercent: number;
}

/** Проходной балл экзамена — 75 % (ТЗ §3.9). */
export const EXAM_PASS_PERCENT = 75;
/** Обязательная доля расчётных вопросов в билете — не менее 25 % (ТЗ §3.9). */
export const EXAM_MIN_NUMERIC_SHARE = 25;

export function scoreExam(
  results: { correct: boolean; type: QuestionType }[],
  passThresholdPercent = EXAM_PASS_PERCENT,
): ExamScore {
  const total = results.length;
  if (total === 0) throw new Error('Экзамен без вопросов');
  const correct = results.filter((r) => r.correct).length;
  const percent = (correct / total) * 100;
  const numeric = results.filter((r) => r.type === 'numeric').length;
  return {
    totalQuestions: total,
    correctAnswers: correct,
    percent: round(percent, 1),
    passed: percent >= passThresholdPercent,
    passThresholdPercent,
    numericSharePercent: round((numeric / total) * 100, 1),
  };
}
