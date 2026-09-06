import { scoreScenario } from '@irrigo/core';
import type { Db } from '../connection.js';
import { inTransaction } from '../connection.js';
import { addXp } from './profiles.js';
import type {
  ScenarioCategory,
  ScenarioDetail,
  ScenarioItemReview,
  ScenarioResult,
  ScenarioSubmission,
  ScenarioSummary,
} from '../../../shared/scenarios.js';

/**
 * Тренажёр «Найди ошибку» (§3.5).
 *
 * Два свойства, ради которых проверка живёт в главном процессе, а не в UI:
 * до отправки ответа renderer вообще не знает, какие карточки ошибочны,
 * и оценку в прогресс пишет тот, кто её посчитал.
 */

/** С какой оценки сценарий считается разобранным (как в разделе прогресса). */
export const SCENARIO_PASS_SCORE = 0.75;

/** XP за разобранный сценарий; начисляется один раз. */
const SCENARIO_XP = 15;

interface ScenarioRow {
  id: number;
  key: string;
  title: string;
  description: string;
  category: ScenarioCategory;
  difficulty: number;
  scene_json: string;
  errors_json: string;
}

interface StoredItem {
  key: string;
  group: string;
  label: string;
  isError: boolean;
  explanation: string;
  lessonKey?: string;
  calculatorKey?: string;
}

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function storedItems(row: ScenarioRow): StoredItem[] {
  return parse<{ items: StoredItem[] }>(row.scene_json, { items: [] }).items;
}

const SCENARIO_SELECT = `
  SELECT id, key, title, description, category, difficulty, scene_json, errors_json
  FROM error_scenarios
`;

interface AttemptStats {
  bestScore: number | null;
  attempts: number;
}

function attemptStats(db: Db, profileId: number, scenarioId: number): AttemptStats {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n, MAX(score) AS best FROM error_attempts WHERE profile_id = ? AND scenario_id = ?',
    )
    .get(profileId, scenarioId) as { n: number; best: number | null } | undefined;

  return {
    attempts: Number(row?.n ?? 0),
    bestScore: row?.best === null || row?.best === undefined ? null : Number(row.best),
  };
}

function toSummary(db: Db, profileId: number, row: ScenarioRow): ScenarioSummary {
  const stats = attemptStats(db, profileId, row.id);

  return {
    id: row.id,
    key: row.key,
    title: row.title,
    category: row.category,
    difficulty: row.difficulty,
    errorCount: parse<string[]>(row.errors_json, []).length,
    bestScore: stats.bestScore,
    attempts: stats.attempts,
    completed: (stats.bestScore ?? 0) >= SCENARIO_PASS_SCORE,
  };
}

export function scenarioList(db: Db, profileId: number): ScenarioSummary[] {
  const rows = db
    .prepare(`${SCENARIO_SELECT} ORDER BY category, difficulty, id`)
    .all() as unknown as ScenarioRow[];
  return rows.map((row) => toSummary(db, profileId, row));
}

function scenarioRow(db: Db, key: string): ScenarioRow {
  const row = db.prepare(`${SCENARIO_SELECT} WHERE key = ?`).get(key) as unknown as
    | ScenarioRow
    | undefined;
  if (!row) throw new Error(`Сценарий «${key}» не найден.`);
  return row;
}

export function scenarioDetail(db: Db, profileId: number, key: string): ScenarioDetail {
  const row = scenarioRow(db, key);

  return {
    ...toSummary(db, profileId, row),
    description: row.description,
    // Наружу уходят только видимые поля карточки: ни `isError`, ни разбор.
    items: storedItems(row).map((item) => ({
      key: item.key,
      group: item.group,
      label: item.label,
    })),
  };
}

export function submitScenario(
  db: Db,
  profileId: number,
  submission: ScenarioSubmission,
): ScenarioResult {
  const row = scenarioRow(db, submission.scenarioKey);
  const items = storedItems(row);

  const outcome = scoreScenario(items, submission.markedKeys);
  const passed = outcome.score >= SCENARIO_PASS_SCORE;

  const before = attemptStats(db, profileId, row.id);
  const alreadyCompleted = (before.bestScore ?? 0) >= SCENARIO_PASS_SCORE;
  // XP один раз за сценарий: пересдача улучшает результат, но не накручивает опыт.
  const xpAwarded = passed && !alreadyCompleted ? SCENARIO_XP : 0;

  const marked = new Set(outcome.found.concat(outcome.falsePositives));

  const profileXp = inTransaction(db, () => {
    db.prepare(
      'INSERT INTO error_attempts (profile_id, scenario_id, found_json, score) VALUES (?, ?, ?, ?)',
    ).run(profileId, row.id, JSON.stringify([...marked]), outcome.score);

    // История попыток по сценарию не растёт бесконечно: интересны последняя
    // и лучшая, остальные — шум.
    db.prepare(
      `DELETE FROM error_attempts
       WHERE profile_id = ? AND scenario_id = ? AND id NOT IN (
         SELECT id FROM error_attempts
         WHERE profile_id = ? AND scenario_id = ?
         ORDER BY id DESC LIMIT 20
       )`,
    ).run(profileId, row.id, profileId, row.id);

    return xpAwarded > 0 ? addXp(db, profileId, xpAwarded) : currentXp(db, profileId);
  });

  const after = attemptStats(db, profileId, row.id);
  const best = after.bestScore ?? outcome.score;

  const review: ScenarioItemReview[] = items.map((item) => ({
    key: item.key,
    group: item.group,
    label: item.label,
    isError: item.isError,
    marked: marked.has(item.key),
    explanation: item.explanation,
    ...(item.lessonKey ? { lessonKey: item.lessonKey } : {}),
    ...(item.calculatorKey ? { calculatorKey: item.calculatorKey } : {}),
  }));

  return {
    score: outcome.score,
    passed,
    bestScore: best,
    attempts: after.attempts,
    completed: best >= SCENARIO_PASS_SCORE,
    totalErrors: outcome.totalErrors,
    foundCount: outcome.found.length,
    falsePositiveCount: outcome.falsePositives.length,
    xpAwarded,
    profileXp,
    review,
  };
}

function currentXp(db: Db, profileId: number): number {
  const row = db.prepare('SELECT xp FROM profiles WHERE id = ?').get(profileId) as
    | { xp: number }
    | undefined;
  return Number(row?.xp ?? 0);
}
