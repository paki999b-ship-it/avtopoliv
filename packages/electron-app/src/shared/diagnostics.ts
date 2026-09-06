/**
 * Диагностика (§3.6 ТЗ): симптом → уточняющие вопросы → вероятные причины
 * с приоритетом → что замерить → что сделать.
 *
 * Дерево отдаётся целиком одним запросом и разворачивается в интерфейсе.
 * Прятать в нём нечего — это справочник, а не тест, — а хождение в базу на
 * каждый ответ только добавило бы задержку между вопросом и следующим.
 */

/** Насколько вероятна причина. Порядок в списке — от более вероятной к менее. */
export type CauseLikelihood = 'high' | 'medium' | 'low';

export const LIKELIHOOD_TITLES: Record<CauseLikelihood, string> = {
  high: 'частая причина',
  medium: 'встречается',
  low: 'редко',
};

export interface DiagnosticsCause {
  title: string;
  likelihood: CauseLikelihood;
  note: string;
}

/** Исход ветки: причины, замер и действие. Всегда связан с уроком (§3.6). */
export interface DiagnosticsConclusion {
  kind: 'conclusion';
  key: string;
  conclusion: string;
  causes: DiagnosticsCause[];
  /** Что замерить, чтобы отличить одну причину от другой. */
  measure: string;
  /** Что сделать по результату замера. */
  action: string;
  lessonKey: string;
  lessonTitle: string;
  calculatorKey?: string;
  calculatorTitle?: string;
}

export interface DiagnosticsAnswer {
  label: string;
  next: DiagnosticsNode;
}

export interface DiagnosticsQuestion {
  kind: 'question';
  key: string;
  question: string;
  answers: DiagnosticsAnswer[];
}

export type DiagnosticsNode = DiagnosticsQuestion | DiagnosticsConclusion;

export interface DiagnosticsSymptomSummary {
  key: string;
  title: string;
  hint: string;
  /** Сколько исходов у дерева — видно, насколько разветвлён разбор. */
  outcomes: number;
  /** Профиль уже доходил по этому симптому до какого-либо исхода. */
  visited: boolean;
}

export interface DiagnosticsSymptomDetail extends DiagnosticsSymptomSummary {
  root: DiagnosticsNode;
}
