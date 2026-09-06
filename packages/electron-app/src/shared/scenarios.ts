/**
 * Тренажёр «Найди ошибку» (§3.5 ТЗ).
 *
 * Сценарий = описание объекта + набор карточек-фактов о нём. Часть карточек
 * описывает ошибку, часть — правильно выполненный узел. Пользователь отмечает
 * ошибки, движок считает результат.
 *
 * Пояснения приходят только вместе с проверкой: до отправки ответа сервер их
 * не отдаёт, иначе задание решалось бы чтением ответа сети.
 */

export type ScenarioCategory =
  | 'hydraulics'
  | 'layout'
  | 'control_unit'
  | 'drip'
  | 'electrical'
  | 'source'
  | 'operation'
  | 'safety';

export const SCENARIO_CATEGORIES: Record<ScenarioCategory, string> = {
  hydraulics: 'Гидравлика',
  layout: 'Раскладка',
  control_unit: 'Узел управления',
  drip: 'Капельный полив',
  electrical: 'Электрика',
  source: 'Источник',
  operation: 'Эксплуатация',
  safety: 'Безопасность',
};

/** Карточка-факт в том виде, в каком её видит пользователь до проверки. */
export interface ScenarioItem {
  key: string;
  /** Узел объекта: «Расход», «Кабель», «Продувка» — карточки группируются по нему. */
  group: string;
  label: string;
}

/** Разбор карточки — приходит только в ответе на проверку. */
export interface ScenarioItemReview extends ScenarioItem {
  isError: boolean;
  /** Отмечена ли она пользователем. */
  marked: boolean;
  explanation: string;
  lessonKey?: string;
  calculatorKey?: string;
}

export interface ScenarioSummary {
  id: number;
  key: string;
  title: string;
  category: ScenarioCategory;
  difficulty: number;
  /** Сколько ошибок спрятано — счёт объявляется заранее, это не подсказка. */
  errorCount: number;
  bestScore: number | null;
  attempts: number;
  completed: boolean;
}

export interface ScenarioDetail extends ScenarioSummary {
  description: string;
  items: ScenarioItem[];
}

export interface ScenarioSubmission {
  scenarioKey: string;
  markedKeys: string[];
}

export interface ScenarioResult {
  score: number;
  passed: boolean;
  bestScore: number;
  attempts: number;
  completed: boolean;
  totalErrors: number;
  foundCount: number;
  falsePositiveCount: number;
  xpAwarded: number;
  profileXp: number;
  review: ScenarioItemReview[];
}
