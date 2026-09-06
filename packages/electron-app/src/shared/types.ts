/**
 * Типы, общие для main и renderer. Здесь не должно быть импортов из Electron
 * и из React: файл попадает в оба бандла.
 */

export type SkillLevel = 'owner' | 'installer' | 'designer';

/** Подпись уровня подачи — используется и в интерфейсе, и на сертификате. */
export const SKILL_LEVEL_TITLES: Record<SkillLevel, string> = {
  owner: 'Владелец участка',
  installer: 'Монтажник',
  designer: 'Проектировщик',
};
export type UnitSystem = 'metric' | 'imperial';

/** Оформление приложения. Хранится в профиле, как и система единиц. */
export type ThemeName = 'dark' | 'light';

export const THEMES: Array<{ value: ThemeName; title: string; description: string }> = [
  { value: 'dark', title: 'Тёмная', description: 'Приглушённая зелень, по умолчанию' },
  { value: 'light', title: 'Светлая', description: 'Белый фон, тот же акцент бренда' },
];

export interface Profile {
  id: number;
  name: string;
  avatar: string;
  skillLevel: SkillLevel;
  unitSystem: UnitSystem;
  theme: ThemeName;
  xp: number;
  streakDays: number;
  lastActiveDate: string | null;
  createdAt: string;
}

export interface ProfileDraft {
  name: string;
  avatar: string;
  skillLevel: SkillLevel;
  unitSystem: UnitSystem;
  /** Необязательно при создании: новый профиль заводится с тёмной темой. */
  theme?: ThemeName;
}

export type ProfilePatch = Partial<ProfileDraft>;

/** Разделы приложения, по которым §3.10 требует прогресс-бары. */
export type SectionKey =
  | 'academy'
  | 'calculators'
  | 'layout'
  | 'assembly'
  | 'errors'
  | 'diagnostics'
  | 'safety';

export interface SectionProgress {
  key: SectionKey;
  /** Сколько единиц освоено и сколько всего. */
  done: number;
  total: number;
}

export interface ProgressSummary {
  profileId: number;
  xp: number;
  /** Уровень пользователя, посчитанный из XP. */
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  streakDays: number;
  sections: SectionProgress[];
}

export interface AppInfo {
  appVersion: string;
  /** Человекочитаемое имя среды: «Electron 44 · Node 24» либо «Android 14». */
  runtime: string;
  /** Оболочка, в которой запущено приложение: настольная или мобильная. */
  platform: 'windows' | 'android';
  /** Издание каталога оборудования — §10 п.2 требует его показывать. */
  catalogEdition: string;
  contentVersion: string;
  databasePath: string;
  /** Приложение работает офлайн и не хранит ключей — §13. */
  offline: true;
}

/** Запись в истории расчётов профиля (§3.2, таблица `calc_history` §7). */
export interface CalcHistoryEntry {
  id: number;
  calculatorKey: string;
  /** Короткая подпись расчёта: чем он отличается от соседних в списке. */
  title: string;
  /** Значения полей формы — расчёт открывается повторно ровно с ними. */
  inputs: Record<string, unknown>;
  /** Числовой результат, каким его показали пользователю. */
  outputs: Record<string, unknown>;
  createdAt: string;
}

export interface CalcHistoryDraft {
  calculatorKey: string;
  title: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

/** Результат выгрузки в файл: пользователь мог закрыть диалог. */
export interface ExportResult {
  saved: boolean;
  path?: string;
}
