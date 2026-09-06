import type { LessonBlock } from './academy.js';

/**
 * Раздел «Безопасность и границы» (§3.8 ТЗ).
 *
 * Содержимое темы описано теми же блоками, что и урок Академии: врезки,
 * списки, таблицы, переходы на калькулятор и справочник, переключение подачи
 * по уровню профиля. Второй формат разметки ради восьми тем завести можно,
 * но поддерживать пришлось бы оба.
 */

export type SafetyCategory =
  | 'electrical'
  | 'backflow'
  | 'well_pump'
  | 'excavation'
  | 'chemicals'
  | 'pressure'
  | 'blowout'
  | 'first_aid';

/** Порядок разделов в интерфейсе — он же порядок §3.8. */
export const SAFETY_CATEGORIES: SafetyCategory[] = [
  'electrical',
  'backflow',
  'well_pump',
  'excavation',
  'chemicals',
  'pressure',
  'blowout',
  'first_aid',
];

export const SAFETY_CATEGORY_TITLES: Record<SafetyCategory, string> = {
  electrical: 'Электробезопасность',
  backflow: 'Питьевая вода',
  well_pump: 'Скважина и насос',
  excavation: 'Земляные работы',
  chemicals: 'Химия и фертигация',
  pressure: 'Давление',
  blowout: 'Продувка',
  first_aid: 'Первая помощь',
};

export const SAFETY_CATEGORY_ICONS: Record<SafetyCategory, string> = {
  electrical: '⚡',
  backflow: '🚰',
  well_pump: '🕳️',
  excavation: '⛏️',
  chemicals: '🧪',
  pressure: '📈',
  blowout: '💨',
  first_aid: '🩹',
};

export interface SafetyTopicSummary {
  id: number;
  key: string;
  category: SafetyCategory;
  title: string;
  summary: string;
  /** Профиль уже открывал тему. */
  read: boolean;
}

export interface SafetyTopicDetail extends SafetyTopicSummary {
  blocks: LessonBlock[];
  /** Уроки Академии, где тема разбирается подробно. */
  lessons: Array<{ key: string; title: string }>;
}
