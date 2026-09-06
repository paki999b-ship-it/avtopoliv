import {
  ACADEMY_PLAN,
  checkMatchAnswer,
  checkMultiAnswer,
  checkNumericAnswer,
  checkSingleAnswer,
  fmt,
} from '@irrigo/core';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';
import { addXp } from './profiles.js';
import type {
  AcademyLevel,
  LessonDetail,
  LessonSummary,
  LevelInfo,
  QuizQuestion,
  QuizResult,
  QuizSubmission,
} from '../../../shared/academy.js';
import type { LessonBlock } from '../../../shared/academy.js';

/**
 * Академия (§3.1, §12 п.6).
 *
 * Проверка ответов идёт функциями `@irrigo/core` — теми же, что и в экзамене.
 * Расчётный вопрос сравнивается с допуском, а не строкой (§3.7 ТЗ), поэтому
 * «3,9» и «3.90» — один и тот же правильный ответ.
 *
 * Все уровни доступны с самого начала: курс читают и подряд, и выборочно —
 * монтажнику может понадобиться сразу раздел о монтаже, не проходя основы.
 * Порядок уровней остаётся рекомендацией, а не запретом.
 */

/** Проходной балл мини-теста урока. Урок засчитывается с этого результата. */
const LESSON_PASS_SCORE = 0.7;

interface LessonRow {
  id: number;
  key: string;
  level: AcademyLevel;
  order_index: number;
  title: string;
  summary: string;
  reading_minutes: number;
  xp_award: number;
  calculator_key: string | null;
  status: string | null;
  questions: number;
}

const LESSON_SELECT = `
  SELECT l.id, l.key, l.level, l.order_index, l.title, l.summary,
         l.reading_minutes, l.xp_award, l.calculator_key,
         p.status AS status,
         (SELECT COUNT(*) FROM questions q WHERE q.lesson_id = l.id AND q.pool = 'lesson') AS questions
  FROM lessons l
  LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.profile_id = ?
`;

function toSummary(row: LessonRow): LessonSummary {
  return {
    id: row.id,
    key: row.key,
    level: row.level,
    order: row.order_index,
    title: row.title,
    summary: row.summary,
    readingMinutes: row.reading_minutes,
    xpAward: row.xp_award,
    status: (row.status as LessonSummary['status']) ?? 'not_started',
    calculatorKey: row.calculator_key,
    questions: Number(row.questions),
  };
}

/** Уровни курса со статистикой прохождения профиля. */
export function academyLevels(db: Db, profileId: number): LevelInfo[] {
  const rows = db.prepare(`${LESSON_SELECT} ORDER BY l.level, l.order_index`).all(profileId) as
    unknown as LessonRow[];

  const byLevel = new Map<string, LessonRow[]>();
  for (const row of rows) {
    const list = byLevel.get(row.level) ?? [];
    list.push(row);
    byLevel.set(row.level, list);
  }

  return ACADEMY_PLAN.map((plan) => {
    const lessons = byLevel.get(plan.key) ?? [];
    const completed = lessons.filter((l) => l.status === 'completed').length;
    const xpAvailable = lessons.reduce((sum, l) => sum + l.xp_award, 0);
    const xpEarned = lessons
      .filter((l) => l.status === 'completed')
      .reduce((sum, l) => sum + l.xp_award, 0);

    return {
      key: plan.key,
      order: plan.order,
      title: plan.title,
      subtitle: plan.subtitle,
      icon: plan.icon,
      lessons: lessons.length,
      completed,
      xpAvailable,
      xpEarned,
    };
  });
}

export function levelLessons(db: Db, profileId: number, level: AcademyLevel): LessonSummary[] {
  const rows = db
    .prepare(`${LESSON_SELECT} WHERE l.level = ? ORDER BY l.order_index`)
    .all(profileId, level) as unknown as LessonRow[];
  return rows.map(toSummary);
}

export function lessonDetail(db: Db, profileId: number, key: string): LessonDetail {
  const row = db.prepare(`${LESSON_SELECT} WHERE l.key = ?`).get(profileId, key) as unknown as
    | (LessonRow & { blocks_json: string; source: string })
    | undefined;

  if (!row) throw new Error(`Урок «${key}» не найден.`);

  const full = db.prepare('SELECT blocks_json, source FROM lessons WHERE id = ?').get(row.id) as {
    blocks_json: string;
    source: string;
  };

  const plan = ACADEMY_PLAN.find((l) => l.key === row.level);
  const order = plan ? plan.lessons.indexOf(key) : -1;
  const neighbours = plan ? plan.lessons : [];

  return {
    ...toSummary(row),
    blocks: parseBlocks(full.blocks_json),
    source: full.source,
    previousKey: order > 0 ? (neighbours[order - 1] ?? null) : null,
    nextKey: order >= 0 && order < neighbours.length - 1 ? (neighbours[order + 1] ?? null) : null,
  };
}

/** Битые блоки не должны ронять урок целиком. */
function parseBlocks(json: string): LessonBlock[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as LessonBlock[]) : [];
  } catch {
    return [];
  }
}

/** Отмечает, что урок открыт. Прогресс «в процессе» не даёт XP. */
export function markLessonOpened(db: Db, profileId: number, key: string): void {
  const lesson = db.prepare('SELECT id FROM lessons WHERE key = ?').get(key) as
    | { id: number }
    | undefined;
  if (!lesson) return;

  db.prepare(
    `INSERT INTO lesson_progress (profile_id, lesson_id, status)
     VALUES (?, ?, 'in_progress')
     ON CONFLICT(profile_id, lesson_id) DO NOTHING`,
  ).run(profileId, lesson.id);
}

/**
 * Строка вопроса в том виде, в каком её читают и мини-тест, и экзамен.
 * Проверка ответа и описание правильного варианта живут здесь в одном
 * экземпляре: дублировать их в экзамене — значит завести второй источник
 * правды о том, что считается верным ответом.
 */
export interface QuestionRow {
  id: number;
  key: string;
  type: 'single' | 'multi' | 'numeric' | 'match';
  prompt: string;
  options_json: string | null;
  match_options_json: string | null;
  correct_json: string;
  unit: string | null;
  tolerance_percent: number | null;
  explanation: string;
  difficulty: number;
}

function questionRows(db: Db, lessonKey: string): QuestionRow[] {
  return db
    .prepare(
      `SELECT q.id, q.key, q.type, q.prompt, q.options_json, q.match_options_json,
              q.correct_json, q.unit, q.tolerance_percent, q.explanation, q.difficulty
       FROM questions q
       JOIN lessons l ON l.id = q.lesson_id
       WHERE l.key = ? AND q.pool = 'lesson'
       ORDER BY q.order_index, q.id`,
    )
    .all(lessonKey) as unknown as QuestionRow[];
}

export function parseJson<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Вопросы мини-теста без правильных ответов — их renderer знать не должен. */
export function lessonQuiz(db: Db, lessonKey: string): QuizQuestion[] {
  return questionRows(db, lessonKey).map((row) => ({
    id: row.id,
    key: row.key,
    type: row.type,
    prompt: row.prompt,
    options: parseJson<string[]>(row.options_json, []),
    matchOptions: parseJson<string[] | undefined>(row.match_options_json, undefined),
    unit: row.unit,
    difficulty: row.difficulty,
  }));
}

/** Правильный ответ в человекочитаемом виде — для разбора после теста. */
export function describeCorrect(row: QuestionRow): string {
  const options = parseJson<string[]>(row.options_json, []);
  const correct = parseJson<number | number[]>(row.correct_json, 0);

  switch (row.type) {
    case 'single':
      return options[Number(correct)] ?? String(correct);
    case 'multi':
      return (Array.isArray(correct) ? correct : [])
        .map((i) => options[i] ?? String(i))
        .join('; ');
    case 'match': {
      const right = parseJson<string[]>(row.match_options_json, []);
      return (Array.isArray(correct) ? correct : [])
        .map((target, index) => `${options[index] ?? index} → ${right[target] ?? target}`)
        .join('; ');
    }
    case 'numeric':
      return `${fmt(Number(correct), 2)}${row.unit ? ` ${row.unit}` : ''}`;
    default:
      return String(correct);
  }
}

export function checkAnswer(
  row: QuestionRow,
  answer: unknown,
): { correct: boolean; deviationPercent?: number } {
  const correct = parseJson<number | number[]>(row.correct_json, 0);

  switch (row.type) {
    case 'single':
      return { correct: typeof answer === 'number' && checkSingleAnswer(answer, Number(correct)) };

    case 'multi':
      return {
        correct:
          Array.isArray(answer) &&
          checkMultiAnswer(answer as number[], Array.isArray(correct) ? correct : []),
      };

    case 'match': {
      // Движок сравнивает пары как записи «левое → правое»; в контенте они
      // заданы массивом индексов правой колонки, поэтому переводим.
      if (!Array.isArray(answer)) return { correct: false };
      const toPairs = (list: number[]): Record<string, string> =>
        Object.fromEntries(list.map((target, index) => [String(index), String(target)]));

      const outcome = checkMatchAnswer(
        toPairs(answer as number[]),
        toPairs(Array.isArray(correct) ? correct : []),
      );
      return { correct: outcome.correct };
    }

    case 'numeric': {
      // Пустой ответ — не ноль: ноль может оказаться правильным.
      if (answer === null || answer === undefined || answer === '') return { correct: false };
      const given = typeof answer === 'number' ? answer : Number(String(answer).replace(',', '.'));
      if (!Number.isFinite(given)) return { correct: false };

      const result = checkNumericAnswer(given, Number(correct), row.tolerance_percent ?? 5);
      return { correct: result.correct, deviationPercent: result.deviationPercent };
    }

    default:
      return { correct: false };
  }
}

/**
 * Проверка мини-теста урока.
 *
 * Порядок как в §3.9 для экзамена: сначала посчитать, потом сохранить, потом
 * вернуть результат. Всё в одной транзакции — попытка и ответы либо
 * записываются вместе, либо не записываются вовсе.
 */
export function submitLessonQuiz(
  db: Db,
  profileId: number,
  submission: QuizSubmission,
): QuizResult {
  const lesson = db
    .prepare('SELECT id, key, xp_award FROM lessons WHERE key = ?')
    .get(submission.lessonKey) as { id: number; key: string; xp_award: number } | undefined;

  if (!lesson) throw new Error(`Урок «${submission.lessonKey}» не найден.`);

  const rows = questionRows(db, submission.lessonKey);
  if (rows.length === 0) throw new Error(`У урока «${submission.lessonKey}» нет вопросов.`);

  const given = new Map(submission.answers.map((a) => [a.questionId, a.answer]));

  const answers = rows.map((row) => {
    const outcome = checkAnswer(row, given.get(row.id) ?? null);
    return {
      questionId: row.id,
      correct: outcome.correct,
      correctAnswer: describeCorrect(row),
      explanation: row.explanation,
      ...(outcome.deviationPercent === undefined
        ? {}
        : { deviationPercent: outcome.deviationPercent }),
    };
  });

  const correctCount = answers.filter((a) => a.correct).length;
  const score = correctCount / rows.length;
  const passed = score >= LESSON_PASS_SCORE;

  const alreadyCompleted =
    (
      db
        .prepare(
          "SELECT status FROM lesson_progress WHERE profile_id = ? AND lesson_id = ? AND status = 'completed'",
        )
        .get(profileId, lesson.id) as { status: string } | undefined
    )?.status === 'completed';

  // XP начисляется один раз за урок: пересдача улучшает результат, но не
  // превращается в способ накручивать опыт.
  const xpAwarded = passed && !alreadyCompleted ? lesson.xp_award : 0;

  const profileXp = inTransaction(db, () => {
    const attempt = db
      .prepare(
        `INSERT INTO quiz_attempts
           (profile_id, kind, level, lesson_id, score, total, correct_count, passed, started_at)
         VALUES (?, 'lesson_quiz', NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        profileId,
        lesson.id,
        score,
        rows.length,
        correctCount,
        passed ? 1 : 0,
        submission.startedAt,
      );

    const attemptId = Number(attempt.lastInsertRowid);
    const insertAnswer = db.prepare(
      'INSERT INTO quiz_answers (attempt_id, question_id, answer_json, is_correct) VALUES (?, ?, ?, ?)',
    );

    for (const row of rows) {
      const answer = given.get(row.id) ?? null;
      const outcome = answers.find((a) => a.questionId === row.id);
      insertAnswer.run(attemptId, row.id, JSON.stringify(answer), outcome?.correct ? 1 : 0);
    }

    if (passed) {
      db.prepare(
        `INSERT INTO lesson_progress (profile_id, lesson_id, status, completed_at)
         VALUES (?, ?, 'completed', datetime('now'))
         ON CONFLICT(profile_id, lesson_id)
         DO UPDATE SET status = 'completed',
                       completed_at = COALESCE(lesson_progress.completed_at, datetime('now'))`,
      ).run(profileId, lesson.id);
    } else {
      db.prepare(
        `INSERT INTO lesson_progress (profile_id, lesson_id, status)
         VALUES (?, ?, 'in_progress')
         ON CONFLICT(profile_id, lesson_id) DO NOTHING`,
      ).run(profileId, lesson.id);
    }

    return xpAwarded > 0 ? addXp(db, profileId, xpAwarded) : currentXp(db, profileId);
  });

  return {
    lessonKey: lesson.key,
    total: rows.length,
    correctCount,
    score: Math.round(score * 100) / 100,
    passed,
    xpAwarded,
    profileXp,
    lessonCompleted: passed,
    answers,
  };
}

function currentXp(db: Db, profileId: number): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE id = ?').get(profileId) as
    | { xp: number }
    | undefined;
  return Number(row?.xp ?? 0);
}

export { LESSON_PASS_SCORE };
