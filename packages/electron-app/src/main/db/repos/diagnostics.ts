import { CALCULATORS } from '@irrigo/core';
import type { Db } from '../connection.js';
import type {
  DiagnosticsCause,
  DiagnosticsNode,
  DiagnosticsSymptomDetail,
  DiagnosticsSymptomSummary,
} from '../../../shared/diagnostics.js';

/**
 * Диагностика (§3.6).
 *
 * В базе дерево лежит плоско — строкой на узел со ссылкой на родителя.
 * Здесь оно собирается обратно во вложенный вид и отдаётся целиком: интерфейс
 * ходит по нему сам, без запроса на каждый ответ.
 */

interface NodeRow {
  key: string;
  parent_key: string | null;
  is_symptom: number;
  symptom_or_question: string;
  answers_json: string;
  conclusion: string | null;
  causes_json: string;
  measure_hint: string | null;
  action_hint: string | null;
  lesson_key: string | null;
  lesson_title: string | null;
  related_calculator_key: string | null;
  hint: string | null;
  order_index: number;
}

const NODE_SELECT = `
  SELECT n.key, n.parent_key, n.is_symptom, n.symptom_or_question, n.answers_json,
         n.conclusion, n.causes_json, n.measure_hint, n.action_hint,
         l.key AS lesson_key, l.title AS lesson_title,
         n.related_calculator_key, n.hint, n.order_index
  FROM diagnostics_nodes n
  LEFT JOIN lessons l ON l.id = n.related_lesson_id
`;

function parse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const CALCULATOR_TITLES = new Map(CALCULATORS.map((c) => [c.key as string, c.title]));

/** Разворачивает поддерево от узла `key`, читая узлы из готовой карты. */
function buildNode(key: string, byKey: Map<string, NodeRow>): DiagnosticsNode {
  const row = byKey.get(key);
  if (!row) throw new Error(`Узел диагностики «${key}» не найден.`);

  const answers = parse<Array<{ label: string; nextKey: string }>>(row.answers_json, []);

  if (answers.length > 0) {
    return {
      kind: 'question',
      key: row.key,
      question: row.symptom_or_question,
      answers: answers.map((a) => ({ label: a.label, next: buildNode(a.nextKey, byKey) })),
    };
  }

  const calculatorKey = row.related_calculator_key ?? undefined;

  return {
    kind: 'conclusion',
    key: row.key,
    conclusion: row.conclusion ?? row.symptom_or_question,
    causes: parse<DiagnosticsCause[]>(row.causes_json, []),
    measure: row.measure_hint ?? '',
    action: row.action_hint ?? '',
    lessonKey: row.lesson_key ?? '',
    lessonTitle: row.lesson_title ?? '',
    ...(calculatorKey
      ? { calculatorKey, calculatorTitle: CALCULATOR_TITLES.get(calculatorKey) ?? calculatorKey }
      : {}),
  };
}

/** Сколько исходов у поддерева — считается по самому дереву, а не хранится. */
function countOutcomes(node: DiagnosticsNode): number {
  return node.kind === 'conclusion'
    ? 1
    : node.answers.reduce((sum, a) => sum + countOutcomes(a.next), 0);
}

function symptomTree(db: Db, symptomKey: string): DiagnosticsNode {
  // Дерево одного симптома невелико, поэтому оно читается целиком одним
  // рекурсивным запросом, а не обходом с запросом на каждый узел.
  const rows = db
    .prepare(
      `WITH RECURSIVE subtree(key) AS (
         SELECT key FROM diagnostics_nodes WHERE parent_key = ?
         UNION ALL
         SELECT n.key FROM diagnostics_nodes n JOIN subtree s ON n.parent_key = s.key
       )
       ${NODE_SELECT} WHERE n.key IN (SELECT key FROM subtree)`,
    )
    .all(symptomKey) as unknown as NodeRow[];

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const root = rows.find((row) => row.parent_key === symptomKey);
  if (!root) throw new Error(`У симптома «${symptomKey}» нет дерева разбора.`);

  return buildNode(root.key, byKey);
}

export function diagnosticsSymptoms(db: Db, profileId: number): DiagnosticsSymptomSummary[] {
  const rows = db
    .prepare(`${NODE_SELECT} WHERE n.is_symptom = 1 ORDER BY n.order_index, n.id`)
    .all() as unknown as NodeRow[];

  const visited = new Set(
    (
      db
        .prepare('SELECT symptom_key FROM diagnostics_progress WHERE profile_id = ?')
        .all(profileId) as unknown as Array<{ symptom_key: string }>
    ).map((r) => r.symptom_key),
  );

  return rows.map((row) => ({
    key: row.key,
    title: row.symptom_or_question,
    hint: row.hint ?? '',
    outcomes: countOutcomes(symptomTree(db, row.key)),
    visited: visited.has(row.key),
  }));
}

export function diagnosticsSymptom(
  db: Db,
  profileId: number,
  key: string,
): DiagnosticsSymptomDetail {
  const row = db.prepare(`${NODE_SELECT} WHERE n.key = ? AND n.is_symptom = 1`).get(key) as
    | NodeRow
    | undefined;
  if (!row) throw new Error(`Симптом «${key}» не найден.`);

  const root = symptomTree(db, key);
  const visited = db
    .prepare('SELECT 1 AS x FROM diagnostics_progress WHERE profile_id = ? AND symptom_key = ?')
    .get(profileId, key) as { x: number } | undefined;

  return {
    key: row.key,
    title: row.symptom_or_question,
    hint: row.hint ?? '',
    outcomes: countOutcomes(root),
    visited: Boolean(visited),
    root,
  };
}

/**
 * Отмечает, что профиль дошёл по симптому до исхода.
 *
 * Именно до исхода, а не «открыл экран»: раздел в прогрессе должен означать
 * разобранные симптомы, а не просмотренный список.
 */
export function markDiagnosticsResolved(
  db: Db,
  profileId: number,
  symptomKey: string,
): { visited: number } {
  const exists = db
    .prepare('SELECT 1 AS x FROM diagnostics_nodes WHERE key = ? AND is_symptom = 1')
    .get(symptomKey) as { x: number } | undefined;
  if (!exists) throw new Error(`Симптом «${symptomKey}» не найден.`);

  db.prepare(
    `INSERT INTO diagnostics_progress (profile_id, symptom_key) VALUES (?, ?)
     ON CONFLICT(profile_id, symptom_key) DO NOTHING`,
  ).run(profileId, symptomKey);

  const row = db
    .prepare('SELECT COUNT(*) AS n FROM diagnostics_progress WHERE profile_id = ?')
    .get(profileId) as { n: number };

  return { visited: Number(row.n) };
}
