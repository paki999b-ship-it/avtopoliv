import { evaluateLayout } from '@irrigo/core';
import type { LayoutHead, LayoutPlan } from '@irrigo/core';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';
import type {
  LayoutAttemptDraft,
  LayoutAttemptResult,
  LayoutReference,
  LayoutTaskDetail,
  LayoutTaskSummary,
} from '../../../shared/layout.js';

/**
 * Тренажёр раскладки (§3.4).
 *
 * Оценку считает главный процесс тем же движком, что и интерфейс во время
 * редактирования: renderer показывает её вживую, но записывается в прогресс
 * только то, что пересчитал main. Иначе оценку можно было бы прислать любую.
 */

/** С какой оценки задание считается выполненным. */
export const LAYOUT_PASS_SCORE = 0.75;

/** Шаг сетки при зачёте: мельче, чем в интерфейсе, — результат должен быть надёжным. */
const SCORING_CELL_SIZE_M = 0.25;

interface TaskRow {
  id: number;
  key: string;
  title: string;
  brief: string;
  difficulty: number;
  plan_json: string;
  reference_solution_json: string;
  qa_verified: number;
  qa_notes: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

interface StoredPlan {
  plan: LayoutPlan;
  lesson: string;
  areaM2: number;
}

function storedPlan(row: TaskRow): StoredPlan {
  return parse<StoredPlan>(row.plan_json, {
    plan: { boundary: { points: [] }, obstacles: [], plantings: [], sourceFlowM3h: 0 },
    lesson: '',
    areaM2: 0,
  });
}

interface AttemptStats {
  bestScore: number | null;
  attempts: number;
}

function attemptStats(db: Db, profileId: number, taskId: number): AttemptStats {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MAX(score) AS best FROM layout_attempts WHERE profile_id = ? AND task_id = ?',
    )
    .get(profileId, taskId) as { n: number; best: number | null } | undefined;

  return {
    attempts: Number(row?.n ?? 0),
    bestScore: row?.best === null || row?.best === undefined ? null : Number(row.best),
  };
}

function toSummary(db: Db, profileId: number, row: TaskRow): LayoutTaskSummary {
  const stats = attemptStats(db, profileId, row.id);
  const stored = storedPlan(row);

  return {
    id: row.id,
    key: row.key,
    title: row.title,
    brief: row.brief,
    difficulty: row.difficulty,
    qaVerified: row.qa_verified === 1,
    areaM2: stored.areaM2,
    bestScore: stats.bestScore,
    attempts: stats.attempts,
    completed: (stats.bestScore ?? 0) >= LAYOUT_PASS_SCORE,
  };
}

const TASK_SELECT = `
  SELECT id, key, title, brief, difficulty, plan_json, reference_solution_json,
         qa_verified, qa_notes
  FROM layout_tasks
`;

export function layoutTasks(db: Db, profileId: number): LayoutTaskSummary[] {
  const rows = db
    .prepare(`${TASK_SELECT} ORDER BY difficulty, id`)
    .all() as unknown as TaskRow[];
  return rows.map((row) => toSummary(db, profileId, row));
}

export function layoutTask(db: Db, profileId: number, key: string): LayoutTaskDetail {
  const row = db.prepare(`${TASK_SELECT} WHERE key = ?`).get(key) as unknown as
    | TaskRow
    | undefined;
  if (!row) throw new Error(`Задание «${key}» не найдено.`);

  const stored = storedPlan(row);

  // Последняя раскладка возвращается, чтобы продолжить с того же места:
  // терять расставленные головы при выходе из задания незачем.
  const last = db
    .prepare(
      'SELECT solution_json FROM layout_attempts WHERE profile_id = ? AND task_id = ? ORDER BY id DESC LIMIT 1',
    )
    .get(profileId, row.id) as { solution_json: string } | undefined;

  return {
    ...toSummary(db, profileId, row),
    plan: stored.plan,
    lesson: stored.lesson,
    qaNotes: row.qa_notes,
    lastAttempt: last ? parse<LayoutHead[]>(last.solution_json, []) : null,
  };
}

/**
 * Эталонное решение (§3.4 «сравнить с эталоном»).
 *
 * Отдаётся только после первой попытки: смысл задания в том, чтобы сначала
 * решить самому. Проверка на стороне главного процесса, а не подсказка в UI.
 */
export function layoutReference(db: Db, profileId: number, key: string): LayoutReference {
  const row = db.prepare(`${TASK_SELECT} WHERE key = ?`).get(key) as unknown as
    | TaskRow
    | undefined;
  if (!row) throw new Error(`Задание «${key}» не найдено.`);

  const stats = attemptStats(db, profileId, row.id);
  if (stats.attempts === 0) {
    throw new Error('Эталон открывается после первой попытки — сначала расставьте головы сами.');
  }

  return {
    heads: parse<LayoutHead[]>(row.reference_solution_json, []),
    lesson: storedPlan(row).lesson,
    qaNotes: row.qa_notes,
  };
}

export function saveLayoutAttempt(
  db: Db,
  profileId: number,
  draft: LayoutAttemptDraft,
): LayoutAttemptResult {
  const row = db
    .prepare('SELECT id, plan_json FROM layout_tasks WHERE key = ?')
    .get(draft.taskKey) as { id: number; plan_json: string } | undefined;
  if (!row) throw new Error(`Задание «${draft.taskKey}» не найдено.`);

  const stored = parse<StoredPlan>(row.plan_json, {
    plan: { boundary: { points: [] }, obstacles: [], plantings: [], sourceFlowM3h: 0 },
    lesson: '',
    areaM2: 0,
  });

  // Оценка пересчитывается здесь, а не берётся из присланного значения.
  const evaluation = evaluateLayout(stored.plan, draft.heads, {
    cellSizeM: SCORING_CELL_SIZE_M,
  });

  inTransaction(db, () => {
    db.prepare(
      'INSERT INTO layout_attempts (profile_id, task_id, solution_json, score, issues_json) VALUES (?, ?, ?, ?, ?)',
    ).run(
      profileId,
      row.id,
      JSON.stringify(draft.heads),
      evaluation.score,
      JSON.stringify(evaluation.notes.filter((n) => n.severity !== 'info')),
    );

    // История попыток по заданию не должна расти бесконечно: интересны
    // последняя и лучшая, остальные — шум.
    db.prepare(
      `DELETE FROM layout_attempts
       WHERE profile_id = ? AND task_id = ? AND id NOT IN (
         SELECT id FROM layout_attempts
         WHERE profile_id = ? AND task_id = ?
         ORDER BY id DESC LIMIT 20
       )`,
    ).run(profileId, row.id, profileId, row.id);
  });

  const stats = attemptStats(db, profileId, row.id);
  const best = stats.bestScore ?? evaluation.score;

  return {
    score: evaluation.score,
    passed: evaluation.score >= LAYOUT_PASS_SCORE,
    bestScore: best,
    attempts: stats.attempts,
    completed: best >= LAYOUT_PASS_SCORE,
  };
}
