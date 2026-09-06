import type { Db } from '../connection.js';
import type { LessonBlock } from '../../../shared/academy.js';
import type {
  SafetyCategory,
  SafetyTopicDetail,
  SafetyTopicSummary,
} from '../../../shared/safety.js';

/**
 * Раздел «Безопасность и границы» (§3.8).
 *
 * Тема отмечается прочитанной по факту открытия: здесь нет ни теста, ни
 * упражнения, и требовать от пользователя лишнего действия ради галочки
 * незачем — он пришёл прочитать, он прочитал.
 */

interface TopicRow {
  id: number;
  key: string;
  category: SafetyCategory;
  title: string;
  content: string;
  order_index: number;
  read_at: string | null;
}

interface StoredContent {
  summary: string;
  blocks: LessonBlock[];
  lessonKeys: string[];
}

const EMPTY: StoredContent = { summary: '', blocks: [], lessonKeys: [] };

function parse(json: string): StoredContent {
  try {
    return { ...EMPTY, ...(JSON.parse(json) as Partial<StoredContent>) };
  } catch {
    return EMPTY;
  }
}

const TOPIC_SELECT = `
  SELECT t.id, t.key, t.category, t.title, t.content, t.order_index, p.read_at
  FROM safety_topics t
  LEFT JOIN safety_progress p ON p.topic_id = t.id AND p.profile_id = ?
`;

function toSummary(row: TopicRow): SafetyTopicSummary {
  return {
    id: row.id,
    key: row.key,
    category: row.category,
    title: row.title,
    summary: parse(row.content).summary,
    read: row.read_at !== null,
  };
}

export function safetyTopics(db: Db, profileId: number): SafetyTopicSummary[] {
  const rows = db
    .prepare(`${TOPIC_SELECT} ORDER BY t.order_index, t.id`)
    .all(profileId) as unknown as TopicRow[];
  return rows.map(toSummary);
}

export function safetyTopic(db: Db, profileId: number, key: string): SafetyTopicDetail {
  const row = db.prepare(`${TOPIC_SELECT} WHERE t.key = ?`).get(profileId, key) as unknown as
    | TopicRow
    | undefined;
  if (!row) throw new Error(`Тема безопасности «${key}» не найдена.`);

  const content = parse(row.content);

  // Уроки подтягиваются по ключам: если урок ещё не наполнен, ссылка на него
  // просто не показывается, а не ведёт в пустой экран.
  const lessons = content.lessonKeys
    .map((lessonKey) => {
      const lesson = db.prepare('SELECT key, title FROM lessons WHERE key = ?').get(lessonKey) as
        | { key: string; title: string }
        | undefined;
      return lesson ?? null;
    })
    .filter((l): l is { key: string; title: string } => l !== null);

  return {
    ...toSummary(row),
    blocks: content.blocks,
    lessons,
  };
}

/** Отмечает тему прочитанной. Повторное открытие ничего не меняет. */
export function markSafetyTopicRead(
  db: Db,
  profileId: number,
  key: string,
): { read: number; total: number } {
  const row = db.prepare('SELECT id FROM safety_topics WHERE key = ?').get(key) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Тема безопасности «${key}» не найдена.`);

  db.prepare(
    `INSERT INTO safety_progress (profile_id, topic_id) VALUES (?, ?)
     ON CONFLICT(profile_id, topic_id) DO NOTHING`,
  ).run(profileId, row.id);

  const read = db
    .prepare('SELECT COUNT(*) AS n FROM safety_progress WHERE profile_id = ?')
    .get(profileId) as { n: number };
  const total = db.prepare('SELECT COUNT(*) AS n FROM safety_topics').get() as { n: number };

  return { read: Number(read.n), total: Number(total.n) };
}
