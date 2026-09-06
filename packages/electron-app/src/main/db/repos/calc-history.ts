import type { Db } from '../connection.js';
import type { CalcHistoryDraft, CalcHistoryEntry } from '../../../shared/types.js';

/**
 * История расчётов профиля (§3.2 ТЗ).
 *
 * Хранятся и вход, и выход: по записи расчёт открывается заново ровно с теми
 * же числами, а не «примерно с теми же». Записей на калькулятор держим
 * ограниченное число — иначе список превращается в свалку.
 */

const MAX_PER_CALCULATOR = 50;

interface HistoryRow {
  id: number;
  calculator_key: string;
  title: string;
  inputs_json: string;
  outputs_json: string;
  created_at: string;
}

function toEntry(row: HistoryRow): CalcHistoryEntry {
  return {
    id: row.id,
    calculatorKey: row.calculator_key,
    title: row.title,
    inputs: safeParse(row.inputs_json),
    outputs: safeParse(row.outputs_json),
    createdAt: row.created_at,
  };
}

/**
 * Битая запись не должна ронять весь список: одна испорченная строка истории
 * не стоит того, чтобы пользователь потерял доступ к остальным.
 */
function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function saveCalculation(
  db: Db,
  profileId: number,
  draft: CalcHistoryDraft,
): CalcHistoryEntry {
  if (!draft.calculatorKey.trim()) throw new Error('Не указан калькулятор.');

  const info = db
    .prepare(
      'INSERT INTO calc_history (profile_id, calculator_key, title, inputs_json, outputs_json) ' +
        'VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      profileId,
      draft.calculatorKey,
      draft.title.slice(0, 200),
      JSON.stringify(draft.inputs),
      JSON.stringify(draft.outputs),
    );

  trimHistory(db, profileId, draft.calculatorKey);

  const row = db
    .prepare(
      'SELECT id, calculator_key, title, inputs_json, outputs_json, created_at ' +
        'FROM calc_history WHERE id = ?',
    )
    .get(Number(info.lastInsertRowid)) as unknown as HistoryRow | undefined;

  if (!row) throw new Error('Расчёт сохранён, но не читается обратно.');
  return toEntry(row);
}

/** Оставляет последние `MAX_PER_CALCULATOR` записей по каждому калькулятору. */
function trimHistory(db: Db, profileId: number, calculatorKey: string): void {
  db.prepare(
    `DELETE FROM calc_history
     WHERE profile_id = ? AND calculator_key = ? AND id NOT IN (
       SELECT id FROM calc_history
       WHERE profile_id = ? AND calculator_key = ?
       ORDER BY id DESC LIMIT ?
     )`,
  ).run(profileId, calculatorKey, profileId, calculatorKey, MAX_PER_CALCULATOR);
}

export function listCalculations(
  db: Db,
  profileId: number,
  calculatorKey?: string,
): CalcHistoryEntry[] {
  const rows = (
    calculatorKey
      ? db
          .prepare(
            'SELECT id, calculator_key, title, inputs_json, outputs_json, created_at ' +
              'FROM calc_history WHERE profile_id = ? AND calculator_key = ? ORDER BY id DESC',
          )
          .all(profileId, calculatorKey)
      : db
          .prepare(
            'SELECT id, calculator_key, title, inputs_json, outputs_json, created_at ' +
              'FROM calc_history WHERE profile_id = ? ORDER BY id DESC LIMIT 200',
          )
          .all(profileId)
  ) as unknown as HistoryRow[];

  return rows.map(toEntry);
}

export function deleteCalculation(
  db: Db,
  profileId: number,
  id: number,
): { deleted: boolean } {
  // profile_id в условии обязателен: без него чужую запись можно было бы
  // удалить, подставив её id.
  const info = db
    .prepare('DELETE FROM calc_history WHERE id = ? AND profile_id = ?')
    .run(id, profileId);
  return { deleted: info.changes > 0 };
}

export function clearCalculations(
  db: Db,
  profileId: number,
  calculatorKey?: string,
): { removed: number } {
  const info = calculatorKey
    ? db
        .prepare('DELETE FROM calc_history WHERE profile_id = ? AND calculator_key = ?')
        .run(profileId, calculatorKey)
    : db.prepare('DELETE FROM calc_history WHERE profile_id = ?').run(profileId);

  return { removed: Number(info.changes) };
}
