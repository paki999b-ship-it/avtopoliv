import type { Db } from '../connection.js';
import type { Profile, ProfileDraft, ProfilePatch } from '../../../shared/types.js';
import { localDateKey, nextStreak } from '../../../shared/xp.js';

interface ProfileRow {
  id: number;
  name: string;
  avatar: string;
  skill_level: Profile['skillLevel'];
  unit_system: Profile['unitSystem'];
  theme: Profile['theme'];
  xp: number;
  streak_days: number;
  last_active_date: string | null;
  created_at: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    skillLevel: row.skill_level,
    unitSystem: row.unit_system,
    theme: row.theme,
    xp: row.xp,
    streakDays: row.streak_days,
    lastActiveDate: row.last_active_date,
    createdAt: row.created_at,
  };
}

const SELECT = `
  SELECT id, name, avatar, skill_level, unit_system, theme, xp, streak_days,
         last_active_date, created_at
  FROM profiles
`;

export function listProfiles(db: Db): Profile[] {
  const rows = db
    .prepare(`${SELECT} ORDER BY last_active_date DESC NULLS LAST, id ASC`)
    .all() as unknown as ProfileRow[];
  return rows.map(toProfile);
}

export function getProfile(db: Db, id: number): Profile | null {
  const row = db.prepare(`${SELECT} WHERE id = ?`).get(id) as unknown as
    | ProfileRow
    | undefined;
  return row ? toProfile(row) : null;
}

export function createProfile(db: Db, draft: ProfileDraft): Profile {
  const name = draft.name.trim();
  if (!name) throw new Error('Имя профиля не может быть пустым.');
  if (name.length > 40) throw new Error('Имя профиля длиннее 40 символов.');

  const info = db
    .prepare(
      'INSERT INTO profiles (name, avatar, skill_level, unit_system, theme) VALUES (?, ?, ?, ?, ?)',
    )
    .run(name, draft.avatar || '💧', draft.skillLevel, draft.unitSystem, draft.theme ?? 'dark');

  const created = getProfile(db, Number(info.lastInsertRowid));
  if (!created) throw new Error('Профиль создан, но не читается обратно.');
  return created;
}

export function updateProfile(db: Db, id: number, patch: ProfilePatch): Profile {
  const current = getProfile(db, id);
  if (!current) throw new Error(`Профиль ${id} не найден.`);

  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (!name) throw new Error('Имя профиля не может быть пустым.');

  db.prepare(
    'UPDATE profiles SET name = ?, avatar = ?, skill_level = ?, unit_system = ?, theme = ? WHERE id = ?',
  ).run(
    name,
    patch.avatar ?? current.avatar,
    patch.skillLevel ?? current.skillLevel,
    patch.unitSystem ?? current.unitSystem,
    patch.theme ?? current.theme,
    id,
  );

  const updated = getProfile(db, id);
  if (!updated) throw new Error(`Профиль ${id} исчез при обновлении.`);
  return updated;
}

export function deleteProfile(db: Db, id: number): { deleted: boolean } {
  const info = db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  return { deleted: info.changes > 0 };
}

/**
 * Отмечает вход в приложение: пересчитывает стрик и запоминает дату.
 * Вызывается при выборе профиля, а не при каждом действии.
 */
export function touchProfile(db: Db, id: number, today = localDateKey()): Profile {
  const current = getProfile(db, id);
  if (!current) throw new Error(`Профиль ${id} не найден.`);

  const streak = nextStreak(current.lastActiveDate, current.streakDays, today);
  db.prepare('UPDATE profiles SET streak_days = ?, last_active_date = ? WHERE id = ?').run(
    streak,
    today,
    id,
  );

  return { ...current, streakDays: streak, lastActiveDate: today };
}

/** Начисляет XP. Возвращает новое значение — уровень считает shared/xp. */
export function addXp(db: Db, id: number, amount: number): number {
  if (amount <= 0) return getProfile(db, id)?.xp ?? 0;
  db.prepare('UPDATE profiles SET xp = xp + ? WHERE id = ?').run(Math.floor(amount), id);
  return getProfile(db, id)?.xp ?? 0;
}
