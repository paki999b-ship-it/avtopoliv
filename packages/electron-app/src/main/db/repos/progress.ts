import type { Db } from '../connection.js';
import type { ProgressSummary, SectionKey, SectionProgress } from '../../../shared/types.js';
import { levelFromXp } from '../../../shared/xp.js';
import { getProfile } from './profiles.js';

function count(db: Db, sql: string, ...params: Array<number | string>): number {
  const row = db.prepare(sql).get(...params) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * Считает прогресс по разделам §3.10.
 *
 * Разделы, контент которых ещё не наполнен, дают `total = 0` — UI показывает
 * их как «скоро», а не как ноль процентов из ста.
 */
export function sectionProgress(db: Db, profileId: number): SectionProgress[] {
  const sections: Array<{ key: SectionKey; done: number; total: number }> = [
    {
      key: 'academy',
      total: count(db, 'SELECT COUNT(*) AS n FROM lessons'),
      done: count(
        db,
        "SELECT COUNT(*) AS n FROM lesson_progress WHERE profile_id = ? AND status = 'completed'",
        profileId,
      ),
    },
    {
      key: 'calculators',
      total: count(db, 'SELECT COUNT(*) AS n FROM calculators'),
      done: count(
        db,
        'SELECT COUNT(DISTINCT calculator_key) AS n FROM calc_history WHERE profile_id = ?',
        profileId,
      ),
    },
    {
      key: 'layout',
      total: count(db, 'SELECT COUNT(*) AS n FROM layout_tasks'),
      done: count(
        db,
        'SELECT COUNT(DISTINCT task_id) AS n FROM layout_attempts WHERE profile_id = ? AND score >= 0.75',
        profileId,
      ),
    },
    {
      key: 'assembly',
      total: count(db, 'SELECT COUNT(*) AS n FROM assembly_tasks'),
      done: count(
        db,
        'SELECT COUNT(DISTINCT task_id) AS n FROM assembly_attempts WHERE profile_id = ? AND score >= 0.75',
        profileId,
      ),
    },
    {
      key: 'errors',
      total: count(db, 'SELECT COUNT(*) AS n FROM error_scenarios'),
      done: count(
        db,
        'SELECT COUNT(DISTINCT scenario_id) AS n FROM error_attempts WHERE profile_id = ? AND score >= 0.75',
        profileId,
      ),
    },
    {
      key: 'diagnostics',
      total: count(db, 'SELECT COUNT(*) AS n FROM diagnostics_nodes WHERE is_symptom = 1'),
      done: count(
        db,
        'SELECT COUNT(*) AS n FROM diagnostics_progress WHERE profile_id = ?',
        profileId,
      ),
    },
    {
      key: 'safety',
      total: count(db, 'SELECT COUNT(*) AS n FROM safety_topics'),
      done: count(db, 'SELECT COUNT(*) AS n FROM safety_progress WHERE profile_id = ?', profileId),
    },
  ];

  // Прогресс не может превысить сто процентов, даже если контент удалили.
  return sections.map((s) => ({ ...s, done: Math.min(s.done, s.total) }));
}

export function progressSummary(db: Db, profileId: number): ProgressSummary {
  const profile = getProfile(db, profileId);
  if (!profile) throw new Error(`Профиль ${profileId} не найден.`);

  const { level, xpIntoLevel, xpForNextLevel } = levelFromXp(profile.xp);

  return {
    profileId,
    xp: profile.xp,
    level,
    xpIntoLevel,
    xpForNextLevel,
    streakDays: profile.streakDays,
    sections: sectionProgress(db, profileId),
  };
}
