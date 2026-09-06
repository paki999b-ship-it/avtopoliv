import type {
  AppInfo,
  CalcHistoryDraft,
  CalcHistoryEntry,
  ExportResult,
  Profile,
  ProfileDraft,
  ProfilePatch,
  ProgressSummary,
} from './types.js';
import type {
  ReferenceQuery,
  ReferenceResult,
  ReferenceSectionInfo,
  SearchResult,
} from './reference.js';
import type {
  AcademyLevel,
  LessonDetail,
  LessonSummary,
  LevelInfo,
  QuizQuestion,
  QuizResult,
  QuizSubmission,
} from './academy.js';
import type { SafetyTopicDetail, SafetyTopicSummary } from './safety.js';
import type { PumpDto, PumpSelectionRequest, PumpSelectionResult } from './pumps.js';
import type {
  Certificate,
  ExamHistoryEntry,
  ExamPaper,
  ExamResult,
  ExamSubmission,
} from './exam.js';
import type {
  DiagnosticsSymptomDetail,
  DiagnosticsSymptomSummary,
} from './diagnostics.js';
import type {
  AssemblyResult,
  AssemblySubmission,
  AssemblyTaskDetail,
  AssemblyTaskSummary,
} from './assembly.js';
import type {
  ScenarioDetail,
  ScenarioResult,
  ScenarioSubmission,
  ScenarioSummary,
} from './scenarios.js';
import type {
  LayoutAttemptDraft,
  LayoutAttemptResult,
  LayoutReference,
  LayoutTaskDetail,
  LayoutTaskSummary,
} from './layout.js';

/**
 * Контракт IPC. Карта «канал → (аргумент, ответ)» описана типом, поэтому
 * main и renderer расходятся на этапе компиляции, а не в рантайме.
 */
export interface IpcContract {
  'app:info': { args: []; result: AppInfo };

  'profiles:list': { args: []; result: Profile[] };
  'profiles:create': { args: [draft: ProfileDraft]; result: Profile };
  'profiles:update': { args: [id: number, patch: ProfilePatch]; result: Profile };
  'profiles:delete': { args: [id: number]; result: { deleted: boolean } };
  /** Отмечает активность профиля на сегодня и пересчитывает стрик (§3.10). */
  'profiles:touch': { args: [id: number]; result: Profile };

  'progress:summary': { args: [profileId: number]; result: ProgressSummary };

  /** История расчётов профиля (§3.2). */
  'calc:save': {
    args: [profileId: number, draft: CalcHistoryDraft];
    result: CalcHistoryEntry;
  };
  'calc:list': {
    args: [profileId: number, calculatorKey?: string];
    result: CalcHistoryEntry[];
  };
  'calc:delete': { args: [profileId: number, id: number]; result: { deleted: boolean } };
  'calc:clear': { args: [profileId: number, calculatorKey?: string]; result: { removed: number } };

  /** Выгрузка в CSV через системный диалог сохранения. */
  'calc:exportCsv': {
    args: [suggestedName: string, csv: string];
    result: ExportResult;
  };
  /** Копирование текста расчёта в буфер обмена. */
  'clipboard:write': { args: [text: string]; result: { copied: boolean } };

  /** Справочники §3.3: состав разделов и выборка строк с фильтром и сортировкой. */
  'reference:sections': { args: []; result: ReferenceSectionInfo[] };
  'reference:query': { args: [request: ReferenceQuery]; result: ReferenceResult };
  /** Глобальный поиск по всему приложению (Ctrl+F). */
  'search:global': { args: [query: string]; result: SearchResult };

  /** Академия §3.1: уровни, уроки, мини-тесты. */
  'academy:levels': { args: [profileId: number]; result: LevelInfo[] };
  'academy:lessons': {
    args: [profileId: number, level: AcademyLevel];
    result: LessonSummary[];
  };
  'academy:lesson': { args: [profileId: number, key: string]; result: LessonDetail };
  'academy:quiz': { args: [lessonKey: string]; result: QuizQuestion[] };
  'academy:submit': {
    args: [profileId: number, submission: QuizSubmission];
    result: QuizResult;
  };

  /** Тренажёр раскладки §3.4. */
  'layout:tasks': { args: [profileId: number]; result: LayoutTaskSummary[] };
  'layout:task': { args: [profileId: number, key: string]; result: LayoutTaskDetail };
  'layout:reference': { args: [profileId: number, key: string]; result: LayoutReference };
  'layout:submit': {
    args: [profileId: number, draft: LayoutAttemptDraft];
    result: LayoutAttemptResult;
  };
  /** Тренажёр «Найди ошибку» §3.5. */
  'scenarios:list': { args: [profileId: number]; result: ScenarioSummary[] };
  'scenarios:detail': { args: [profileId: number, key: string]; result: ScenarioDetail };
  'scenarios:submit': {
    args: [profileId: number, submission: ScenarioSubmission];
    result: ScenarioResult;
  };

  /** Тренажёр «Сборка узла насоса» (уровень 7). */
  'assembly:tasks': { args: [profileId: number]; result: AssemblyTaskSummary[] };
  'assembly:task': { args: [profileId: number, key: string]; result: AssemblyTaskDetail };
  'assembly:submit': {
    args: [profileId: number, submission: AssemblySubmission];
    result: AssemblyResult;
  };

  /** Диагностика §3.6. */
  'diagnostics:symptoms': { args: [profileId: number]; result: DiagnosticsSymptomSummary[] };
  'diagnostics:symptom': {
    args: [profileId: number, key: string];
    result: DiagnosticsSymptomDetail;
  };
  /** Отмечает, что профиль дошёл до исхода по симптому. */
  'diagnostics:resolved': {
    args: [profileId: number, symptomKey: string];
    result: { visited: number };
  };

  /** Безопасность и границы §3.8. */
  'safety:topics': { args: [profileId: number]; result: SafetyTopicSummary[] };
  'safety:topic': { args: [profileId: number, key: string]; result: SafetyTopicDetail };
  'safety:read': {
    args: [profileId: number, key: string];
    result: { read: number; total: number };
  };

  /** Экзамен и сертификат §3.9. */
  'exam:paper': { args: []; result: ExamPaper };
  /**
   * Завершение экзамена. Одна операция: расчёт → сохранение → результат.
   * Пока она не вернулась, интерфейсу некуда переходить, и терять нечего.
   */
  'exam:submit': {
    args: [profileId: number, submission: ExamSubmission];
    result: ExamResult;
  };
  'exam:history': { args: [profileId: number]; result: ExamHistoryEntry[] };
  'exam:certificate': { args: [profileId: number, resultId: number]; result: Certificate };

  /** Каталоги насосов §5.11: подбор под требуемую точку и карточка модели. */
  'pumps:select': { args: [request: PumpSelectionRequest]; result: PumpSelectionResult };
  'pumps:get': { args: [id: number]; result: PumpDto };

  /** Выгрузка плана в PNG: renderer присылает изображение в base64. */
  'layout:exportPng': {
    args: [suggestedName: string, base64: string];
    result: ExportResult;
  };
}

export type IpcChannel = keyof IpcContract;
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args'];
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result'];

/** Список каналов — используется preload'ом для белого списка. */
export const IPC_CHANNELS = [
  'app:info',
  'profiles:list',
  'profiles:create',
  'profiles:update',
  'profiles:delete',
  'profiles:touch',
  'progress:summary',
  'calc:save',
  'calc:list',
  'calc:delete',
  'calc:clear',
  'calc:exportCsv',
  'clipboard:write',
  'reference:sections',
  'reference:query',
  'search:global',
  'academy:levels',
  'academy:lessons',
  'academy:lesson',
  'academy:quiz',
  'academy:submit',
  'layout:tasks',
  'layout:task',
  'layout:reference',
  'layout:submit',
  'layout:exportPng',
  'scenarios:list',
  'scenarios:detail',
  'scenarios:submit',
  'assembly:tasks',
  'assembly:task',
  'assembly:submit',
  'diagnostics:symptoms',
  'diagnostics:symptom',
  'diagnostics:resolved',
  'safety:topics',
  'safety:topic',
  'safety:read',
  'exam:paper',
  'exam:submit',
  'exam:history',
  'exam:certificate',
  'pumps:select',
  'pumps:get',
] as const satisfies readonly IpcChannel[];

/** Мост, который preload кладёт в `window.irrigo`. */
export interface IrrigoBridge {
  invoke<C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>>;
}
