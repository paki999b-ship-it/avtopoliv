/**
 * XP, уровни пользователя и стрик по дням — §3.10 ТЗ.
 *
 * Формулы лежат в shared, потому что нужны обеим сторонам: main пишет XP в
 * базу, renderer рисует прогресс до следующего уровня. Дублировать нельзя.
 */

/** Сколько XP нужно набрать, находясь на уровне `level`, чтобы уйти на следующий. */
export function xpForLevel(level: number): number {
  return 100 + (Math.max(1, level) - 1) * 50;
}

export interface LevelInfo {
  level: number;
  /** XP, накопленные внутри текущего уровня. */
  xpIntoLevel: number;
  /** Сколько XP всего нужно на текущем уровне. */
  xpForNextLevel: number;
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));

  // Уровней немного, кривая простая — цикл честнее, чем обратная формула.
  while (remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level += 1;
  }

  return { level, xpIntoLevel: remaining, xpForNextLevel: xpForLevel(level) };
}

/** Дата в виде `ГГГГ-ММ-ДД` по локальному времени — стрик считается по дням пользователя. */
export function localDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Разница в целых днях между двумя ключами дат `ГГГГ-ММ-ДД`. */
export function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00`);
  const to = Date.parse(`${toKey}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;
  return Math.round((to - from) / 86_400_000);
}

/**
 * Новое значение стрика при заходе в приложение.
 * Тот же день — без изменений, вчера — плюс день, дальше — счёт с единицы.
 */
export function nextStreak(
  lastActiveDate: string | null,
  streakDays: number,
  today: string = localDateKey(),
): number {
  if (!lastActiveDate) return 1;
  const gap = daysBetween(lastActiveDate, today);
  if (Number.isNaN(gap) || gap < 0) return Math.max(1, streakDays);
  if (gap === 0) return Math.max(1, streakDays);
  if (gap === 1) return streakDays + 1;
  return 1;
}
