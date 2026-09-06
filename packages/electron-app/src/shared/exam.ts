import type { QuizAnswer, QuizQuestion } from './academy.js';

/**
 * Экзамен и сертификат (§3.9 ТЗ).
 *
 * 60 вопросов по всем восьми категориям, доля расчётных не ниже 25 %,
 * проходной балл 75 %, таймер.
 *
 * Ключевое требование §3.9 — порядок завершения: **рассчитать → сохранить →
 * перейти на экран результатов**. Поэтому `exam:submit` делает расчёт и запись
 * в одной операции и возвращает готовый результат: интерфейсу нечего терять
 * между шагами, а переход происходит уже после успешного ответа.
 */

export type ExamCategory =
  | 'basics'
  | 'water_plants'
  | 'hydraulics'
  | 'equipment'
  | 'design'
  | 'automation_electrical'
  | 'installation_maintenance'
  | 'safety';

export const EXAM_CATEGORY_TITLES: Record<ExamCategory, string> = {
  basics: 'Основы',
  water_plants: 'Вода и растения',
  hydraulics: 'Гидравлика',
  equipment: 'Оборудование',
  design: 'Проектирование',
  automation_electrical: 'Автоматика и электрика',
  installation_maintenance: 'Монтаж и эксплуатация',
  safety: 'Безопасность',
};

/** Вопрос экзамена: тот же, что в мини-тесте, плюс категория для разбора. */
export interface ExamQuestion extends QuizQuestion {
  category: ExamCategory;
}

export interface ExamPaper {
  questions: ExamQuestion[];
  /** Сколько минут отведено. */
  timeLimitMinutes: number;
  passScore: number;
  numericCount: number;
  /** Сколько вопросов по каждой категории — состав объявляется заранее. */
  byCategory: Array<{ category: ExamCategory; count: number }>;
}

export interface ExamSubmission {
  startedAt: string;
  durationSec: number;
  answers: Array<{ questionId: number; answer: QuizAnswer }>;
}

export interface ExamAnswerReview {
  questionId: number;
  category: ExamCategory;
  prompt: string;
  correct: boolean;
  /** Ответ пользователя в человекочитаемом виде. */
  givenAnswer: string;
  correctAnswer: string;
  explanation: string;
  deviationPercent?: number;
  lessonKey: string | null;
  lessonTitle: string | null;
}

export interface ExamCategoryScore {
  category: ExamCategory;
  total: number;
  correct: number;
}

export interface ExamResult {
  id: number;
  score: number;
  total: number;
  correctCount: number;
  numericShare: number;
  passed: boolean;
  durationSec: number;
  /** Номер сертификата — только у сданного экзамена. */
  certificateNo: string | null;
  createdAt: string;
  byCategory: ExamCategoryScore[];
  review: ExamAnswerReview[];
  xpAwarded: number;
  profileXp: number;
}

export interface ExamHistoryEntry {
  id: number;
  score: number;
  total: number;
  correctCount: number;
  passed: boolean;
  durationSec: number;
  certificateNo: string | null;
  createdAt: string;
}

export interface Certificate {
  certificateNo: string;
  profileName: string;
  skillLevelTitle: string;
  score: number;
  correctCount: number;
  total: number;
  issuedAt: string;
  /** §3.9 и §10 п.7: оговорка печатается на самом сертификате. */
  disclaimer: string;
}
