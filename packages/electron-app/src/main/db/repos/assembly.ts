import { scoreAssembly } from '@irrigo/core';
import type { AssemblySlot } from '@irrigo/core';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';
import { addXp } from './profiles.js';
import type {
  AssemblyPart,
  AssemblyResult,
  AssemblySlotReview,
  AssemblySubmission,
  AssemblyTaskDetail,
  AssemblyTaskSummary,
} from '../../../shared/assembly.js';

/**
 * Тренажёр «Сборка узла насоса».
 *
 * Проверка живёт здесь, а не в интерфейсе, ровно по тем же причинам, что и в
 * «Найди ошибку»: до отправки ответа renderer не знает эталона, а оценку в
 * прогресс пишет тот, кто её посчитал.
 */

/** С какой оценки задание считается собранным. */
export const ASSEMBLY_PASS_SCORE = 0.75;

/** XP за собранный узел; начисляется один раз на задание. */
const ASSEMBLY_XP = 15;

interface TaskRow {
  id: number;
  key: string;
  title: string;
  brief: string;
  difficulty: number;
  parts_json: string;
  slots_json: string;
}

interface StoredPart extends AssemblyPart {
  misplaced: string;
}

interface StoredSlot extends AssemblySlot {
  title: string;
  why: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const storedParts = (row: TaskRow): StoredPart[] =>
  parse<{ parts: StoredPart[] }>(row.parts_json, { parts: [] }).parts;

const storedSlots = (row: TaskRow): StoredSlot[] =>
  parse<{ slots: StoredSlot[] }>(row.slots_json, { slots: [] }).slots;

function currentXp(db: Db, profileId: number): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE id = ?').get(profileId) as
    | { xp: number }
    | undefined;
  return Number(row?.xp ?? 0);
}

const TASK_SELECT = `
  SELECT id, key, title, brief, difficulty, parts_json, slots_json
  FROM assembly_tasks
`;

function attemptStats(
  db: Db,
  profileId: number,
  taskId: number,
): { bestScore: number | null; attempts: number } {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MAX(score) AS best FROM assembly_attempts WHERE profile_id = ? AND task_id = ?',
    )
    .get(profileId, taskId) as { n: number; best: number | null } | undefined;

  return {
    attempts: Number(row?.n ?? 0),
    bestScore: row?.best === null || row?.best === undefined ? null : Number(row.best),
  };
}

function toSummary(db: Db, profileId: number, row: TaskRow): AssemblyTaskSummary {
  const stats = attemptStats(db, profileId, row.id);
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    difficulty: row.difficulty,
    slotCount: storedSlots(row).length,
    bestScore: stats.bestScore,
    attempts: stats.attempts,
    completed: (stats.bestScore ?? 0) >= ASSEMBLY_PASS_SCORE,
  };
}

export function assemblyTasks(db: Db, profileId: number): AssemblyTaskSummary[] {
  const rows = db
    .prepare(`${TASK_SELECT} ORDER BY order_index, id`)
    .all() as unknown as TaskRow[];
  return rows.map((row) => toSummary(db, profileId, row));
}

function taskRow(db: Db, key: string): TaskRow {
  const row = db.prepare(`${TASK_SELECT} WHERE key = ?`).get(key) as unknown as TaskRow | undefined;
  if (!row) throw new Error(`Задание «${key}» не найдено.`);
  return row;
}

export function assemblyTaskDetail(db: Db, profileId: number, key: string): AssemblyTaskDetail {
  const row = taskRow(db, key);

  return {
    ...toSummary(db, profileId, row),
    brief: row.brief,
    // Наружу уходит палитра без разбора неверной установки и позиции без
    // эталона: всё, что нужно для решения, и ничего, что его выдаёт.
    parts: storedParts(row).map((p) => ({ key: p.key, label: p.label, hint: p.hint })),
    slots: storedSlots(row).map((s) => ({
      key: s.key,
      line: s.line,
      order: s.order,
      title: s.title,
    })),
  };
}

export function submitAssembly(
  db: Db,
  profileId: number,
  submission: AssemblySubmission,
): AssemblyResult {
  const row = taskRow(db, submission.taskKey);
  const slots = storedSlots(row);
  const parts = new Map(storedParts(row).map((p) => [p.key, p]));

  const outcome = scoreAssembly(slots, submission.placement);
  const passed = outcome.score >= ASSEMBLY_PASS_SCORE;

  const before = attemptStats(db, profileId, row.id);
  const alreadyDone = (before.bestScore ?? 0) >= ASSEMBLY_PASS_SCORE;
  const xpAwarded = passed && !alreadyDone ? ASSEMBLY_XP : 0;

  const profileXp = inTransaction(db, () => {
    db.prepare(
      'INSERT INTO assembly_attempts (profile_id, task_id, placement_json, score) VALUES (?, ?, ?, ?)',
    ).run(profileId, row.id, JSON.stringify(submission.placement), outcome.score);

    return xpAwarded > 0 ? addXp(db, profileId, xpAwarded) : currentXp(db, profileId);
  });

  const after = attemptStats(db, profileId, row.id);

  const review: AssemblySlotReview[] = slots.map((slot) => {
    const result = outcome.results.find((r) => r.slotKey === slot.key)!;
    const placedPart = result.placed ? parts.get(result.placed) : undefined;
    const correctPart = parts.get(slot.correct);

    return {
      slotKey: slot.key,
      title: slot.title,
      line: slot.line,
      order: slot.order,
      placed: result.placed,
      placedLabel: placedPart?.label ?? null,
      correct: slot.correct,
      correctLabel: correctPart?.label ?? slot.correct,
      isCorrect: result.isCorrect,
      why: slot.why,
      // Разбор неверной установки берётся у того элемента, который поставили:
      // «манометр за обратным клапаном показывает систему, а не насос».
      misplacedNote: result.isCorrect ? null : (placedPart?.misplaced ?? null),
    };
  });

  return {
    score: outcome.score,
    passed,
    bestScore: after.bestScore ?? outcome.score,
    attempts: after.attempts,
    completed: (after.bestScore ?? 0) >= ASSEMBLY_PASS_SCORE,
    correctCount: outcome.correctCount,
    emptyCount: outcome.emptyCount,
    total: outcome.total,
    xpAwarded,
    profileXp,
    review,
  };
}
