import type { SkillLevel } from './types.js';

/**
 * Академия (§3.1, §4 ТЗ).
 *
 * Урок хранится не одной строкой markdown, а списком типизированных блоков.
 * Причина — §1 ТЗ: один и тот же материал подаётся на трёх уровнях сложности.
 * У блока есть поле `audience`, и переключатель в профиле показывает или
 * прячет блок целиком. Так текст пишется один раз, а не трижды, и владелец
 * участка не видит вывод формулы, тогда как проектировщик видит.
 *
 * Разбирать markdown полностью не нужно: во встроенном тексте работают только
 * `**жирный**`, `` `моноширинный` `` и `[[термин]]` — ссылка на глоссарий.
 */

/** Кому показывать блок. `all` — всем. */
export type Audience = 'all' | SkillLevel;

export type CalloutTone = 'note' | 'warning' | 'danger' | 'success';

interface BlockBase {
  audience?: Audience | Audience[];
}

/** Обычный абзац. */
export interface TextBlock extends BlockBase {
  type: 'text';
  text: string;
}

/** Заголовок внутри урока. */
export interface HeadingBlock extends BlockBase {
  type: 'heading';
  text: string;
}

/** Маркированный или нумерованный список. */
export interface ListBlock extends BlockBase {
  type: 'list';
  ordered?: boolean;
  items: string[];
}

/** Врезка: замечание, предупреждение, запрет, подтверждение. */
export interface CalloutBlock extends BlockBase {
  type: 'callout';
  tone: CalloutTone;
  title?: string;
  text: string;
}

/** Формула с расшифровкой обозначений. Обычно для проектировщика. */
export interface FormulaBlock extends BlockBase {
  type: 'formula';
  formula: string;
  /** Подстановка чисел — чтобы формула не висела абстракцией. */
  substitution?: string;
  result?: string;
  where?: string[];
}

/** Небольшая таблица прямо в уроке. */
export interface TableBlock extends BlockBase {
  type: 'table';
  columns: string[];
  rows: string[][];
  caption?: string;
}

/** Встроенный мини-калькулятор: кнопка перехода на расчёт §5. */
export interface CalculatorBlock extends BlockBase {
  type: 'calculator';
  calculatorKey: string;
  title: string;
  text: string;
}

/** Ссылка на строку справочника. */
export interface ReferenceBlock extends BlockBase {
  type: 'reference';
  section: string;
  table?: string;
  title: string;
  text: string;
}

/** Схема, нарисованная встроенным SVG: внешних картинок в приложении нет. */
export interface FigureBlock extends BlockBase {
  type: 'figure';
  /** Ключ схемы из библиотеки иллюстраций renderer'а. */
  figureKey: string;
  caption: string;
}

export type LessonBlock =
  | TextBlock
  | HeadingBlock
  | ListBlock
  | CalloutBlock
  | FormulaBlock
  | TableBlock
  | CalculatorBlock
  | ReferenceBlock
  | FigureBlock;

/** Уровень курса — §3.1 ТЗ. */
export type AcademyLevel =
  | 'basics'
  | 'water_plants'
  | 'equipment'
  | 'design'
  | 'automation'
  | 'operation'
  | 'pump_rig';

export interface LevelInfo {
  key: AcademyLevel;
  order: number;
  title: string;
  subtitle: string;
  icon: string;
  lessons: number;
  completed: number;
  xpAvailable: number;
  xpEarned: number;
}

export interface LessonSummary {
  id: number;
  key: string;
  level: AcademyLevel;
  order: number;
  title: string;
  summary: string;
  readingMinutes: number;
  xpAward: number;
  status: 'not_started' | 'in_progress' | 'completed';
  calculatorKey: string | null;
  /** Сколько вопросов в мини-тесте урока. */
  questions: number;
}

export interface LessonDetail extends LessonSummary {
  blocks: LessonBlock[];
  source: string;
  /** Ключ следующего урока — чтобы читать курс подряд. */
  nextKey: string | null;
  previousKey: string | null;
}

/** Вопрос мини-теста, каким его видит renderer: без правильного ответа. */
export interface QuizQuestion {
  id: number;
  key: string;
  type: 'single' | 'multi' | 'numeric' | 'match';
  prompt: string;
  /** Варианты для single/multi; левая колонка для match. */
  options: string[];
  /** Правая колонка для match. */
  matchOptions?: string[];
  unit: string | null;
  difficulty: number;
}

/** Ответ пользователя. Форма зависит от типа вопроса. */
export type QuizAnswer = number | number[] | string | null;

export interface QuizSubmission {
  lessonKey: string;
  startedAt: string;
  answers: Array<{ questionId: number; answer: QuizAnswer }>;
}

export interface QuizAnswerResult {
  questionId: number;
  correct: boolean;
  /** Правильный ответ в человекочитаемом виде. */
  correctAnswer: string;
  /** §3.7: пояснение обязательно у каждого вопроса. */
  explanation: string;
  /** Для расчётных: насколько ответ отличается от эталона, %. */
  deviationPercent?: number;
}

export interface QuizResult {
  lessonKey: string;
  total: number;
  correctCount: number;
  score: number;
  passed: boolean;
  xpAwarded: number;
  /** Полный XP профиля после начисления. */
  profileXp: number;
  lessonCompleted: boolean;
  answers: QuizAnswerResult[];
}
