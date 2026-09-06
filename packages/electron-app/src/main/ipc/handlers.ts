import type { Db } from '../db/connection.js';
import { getMeta } from '../db/connection.js';
import {
  createProfile,
  deleteProfile,
  listProfiles,
  touchProfile,
  updateProfile,
} from '../db/repos/profiles.js';
import { progressSummary } from '../db/repos/progress.js';
import {
  clearCalculations,
  deleteCalculation,
  listCalculations,
  saveCalculation,
} from '../db/repos/calc-history.js';
import { queryReference, referenceSections } from '../db/repos/reference.js';
import { globalSearch } from '../db/repos/search.js';
import {
  academyLevels,
  lessonDetail,
  lessonQuiz,
  levelLessons,
  markLessonOpened,
  submitLessonQuiz,
} from '../db/repos/academy.js';
import {
  layoutReference,
  layoutTask,
  layoutTasks,
  saveLayoutAttempt,
} from '../db/repos/layout.js';
import { scenarioDetail, scenarioList, submitScenario } from '../db/repos/scenarios.js';
import { assemblyTaskDetail, assemblyTasks, submitAssembly } from '../db/repos/assembly.js';
import {
  diagnosticsSymptom,
  diagnosticsSymptoms,
  markDiagnosticsResolved,
} from '../db/repos/diagnostics.js';
import { markSafetyTopicRead, safetyTopic, safetyTopics } from '../db/repos/safety.js';
import { buildExamPaper, certificate, examHistory, submitExam } from '../db/repos/exam.js';
import { pump, selectPumps } from '../db/repos/pumps.js';
import type { ExportResult } from '../../shared/types.js';
import type { IpcChannel, IpcContract } from '../../shared/ipc.js';

/**
 * Обработчики каналов — единственная реализация прикладного слоя на обе
 * оболочки.
 *
 * Под Windows этот модуль вызывает main-процесс Electron через ipcMain, под
 * Android — прямо страница в WebView (мост `window.irrigo` там ставит
 * `packages/mobile-app/src/bridge.ts`). Всё, что зависит от оболочки — версия
 * среды, буфер обмена, сохранение файла — вынесено в `PlatformServices`, и
 * второй копии правил работы с базой не существует.
 */

/** То, чего нет в базе и что каждая оболочка делает по-своему. */
export interface PlatformServices {
  /** Версия приложения и человекочитаемое имя среды выполнения. */
  appVersion: string;
  runtime: string;
  platform: 'windows' | 'android';
  /** Где лежит файл базы — показывается в разделе «О приложении». */
  databasePath: string;
  exportCsv(suggestedName: string, csv: string): Promise<ExportResult>;
  exportPng(suggestedName: string, base64: string): Promise<ExportResult>;
  writeClipboard(text: string): Promise<{ copied: boolean }> | { copied: boolean };
  /**
   * Вызывается после каждой операции, изменившей базу. Под Windows база лежит
   * на диске и запись идёт сама; под Android она живёт в памяти WebView, и её
   * образ нужно сбрасывать в файл вручную — иначе прогресс не переживёт
   * закрытие приложения.
   */
  onMutate?: () => void;
}

export type Handlers = {
  [C in IpcChannel]: (
    ...args: IpcContract[C]['args']
  ) => IpcContract[C]['result'] | Promise<IpcContract[C]['result']>;
};

/**
 * Карта «канал → обработчик». Тип `Handlers` не даёт зарегистрировать канал,
 * которого нет в контракте, и забыть тот, который есть.
 */
export function createHandlers(db: Db, platform: PlatformServices): Handlers {
  /** Обёртка вокруг операций, меняющих базу: см. `onMutate`. */
  const mutating = <A extends unknown[], R>(fn: (...args: A) => R) => {
    return (...args: A): R => {
      const result = fn(...args);
      platform.onMutate?.();
      return result;
    };
  };

  return {
    'app:info': () => ({
      appVersion: platform.appVersion,
      runtime: platform.runtime,
      platform: platform.platform,
      catalogEdition: getMeta(db, 'catalog_edition') ?? 'Каталог не загружен',
      contentVersion: getMeta(db, 'content_signature') ?? '—',
      databasePath: platform.databasePath,
      offline: true,
    }),

    'profiles:list': () => listProfiles(db),
    'profiles:create': mutating((draft) => createProfile(db, draft)),
    'profiles:update': mutating((id, patch) => updateProfile(db, id, patch)),
    'profiles:delete': mutating((id) => deleteProfile(db, id)),
    'profiles:touch': mutating((id) => touchProfile(db, id)),

    'progress:summary': (profileId) => progressSummary(db, profileId),

    'calc:save': mutating((profileId, draft) => saveCalculation(db, profileId, draft)),
    'calc:list': (profileId, calculatorKey) => listCalculations(db, profileId, calculatorKey),
    'calc:delete': mutating((profileId, id) => deleteCalculation(db, profileId, id)),
    'calc:clear': mutating((profileId, key) => clearCalculations(db, profileId, key)),

    'calc:exportCsv': (suggestedName, csv) => platform.exportCsv(suggestedName, csv),
    'clipboard:write': (text) => platform.writeClipboard(text),

    'reference:sections': () => referenceSections(db),
    'reference:query': (request) => queryReference(db, request),
    'search:global': (query) => globalSearch(db, query),

    'academy:levels': (profileId) => academyLevels(db, profileId),
    'academy:lessons': (profileId, level) => levelLessons(db, profileId, level),
    'academy:lesson': mutating((profileId, key) => {
      // Открытие урока сразу помечает его начатым: иначе прогресс появлялся бы
      // только после теста, и брошенный на середине урок выглядел бы нетронутым.
      markLessonOpened(db, profileId, key);
      return lessonDetail(db, profileId, key);
    }),
    'academy:quiz': (lessonKey) => lessonQuiz(db, lessonKey),
    'academy:submit': mutating((profileId, s) => submitLessonQuiz(db, profileId, s)),

    'layout:tasks': (profileId) => layoutTasks(db, profileId),
    'layout:task': (profileId, key) => layoutTask(db, profileId, key),
    'layout:reference': (profileId, key) => layoutReference(db, profileId, key),
    'layout:submit': mutating((profileId, draft) => saveLayoutAttempt(db, profileId, draft)),
    'layout:exportPng': (suggestedName, base64) => platform.exportPng(suggestedName, base64),

    'scenarios:list': (profileId) => scenarioList(db, profileId),
    'scenarios:detail': (profileId, key) => scenarioDetail(db, profileId, key),
    'scenarios:submit': mutating((profileId, s) => submitScenario(db, profileId, s)),

    'assembly:tasks': (profileId) => assemblyTasks(db, profileId),
    'assembly:task': (profileId, key) => assemblyTaskDetail(db, profileId, key),
    'assembly:submit': mutating((profileId, s) => submitAssembly(db, profileId, s)),

    'diagnostics:symptoms': (profileId) => diagnosticsSymptoms(db, profileId),
    'diagnostics:symptom': (profileId, key) => diagnosticsSymptom(db, profileId, key),
    'diagnostics:resolved': mutating((profileId, symptomKey) =>
      markDiagnosticsResolved(db, profileId, symptomKey),
    ),

    'safety:topics': (profileId) => safetyTopics(db, profileId),
    'safety:topic': (profileId, key) => safetyTopic(db, profileId, key),
    'safety:read': mutating((profileId, key) => markSafetyTopicRead(db, profileId, key)),

    'exam:paper': () => buildExamPaper(db),
    'exam:submit': mutating((profileId, s) => submitExam(db, profileId, s)),
    'exam:history': (profileId) => examHistory(db, profileId),
    'exam:certificate': (profileId, resultId) => certificate(db, profileId, resultId),

    'pumps:select': (request) => selectPumps(db, request),
    'pumps:get': (id) => pump(db, id),
  };
}
