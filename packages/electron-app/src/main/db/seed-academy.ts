import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ACADEMY_PLAN, isAcademyLessonKey, levelOfLesson } from '@irrigo/core';
import type { Db } from './connection.js';
import type { LessonBlock } from '../../shared/academy.js';

/**
 * Наполнение Академии из `/content/academy` (§12 п.6).
 *
 * Проверки при сборке жёсткие намеренно: урок с ключом вне программы курса
 * или вопрос без пояснения не должны попасть в базу молча. Лучше не собраться
 * при сборке, чем показать пользователю битый курс.
 */

interface RawQuestion {
  key: string;
  type: 'single' | 'multi' | 'numeric' | 'match';
  category: string;
  difficulty: number;
  prompt: string;
  options?: string[];
  matchOptions?: string[];
  correct: number | number[];
  unit?: string;
  tolerancePercent?: number;
  explanation: string;
}

interface RawLesson {
  key: string;
  title: string;
  summary: string;
  readingMinutes: number;
  xpAward: number;
  calculatorKey?: string;
  source: string;
  blocks: LessonBlock[];
  questions: RawQuestion[];
}

interface LevelFile {
  level: string;
  note: string;
  collectedAt: string;
  lessons: RawLesson[];
}

export const ACADEMY_TABLES = ['questions', 'lessons'] as const;

/** Плоский текст урока — он идёт в поисковый индекс и в поле `body_md`. */
export function lessonPlainText(blocks: LessonBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'heading':
        parts.push(block.text);
        break;
      case 'list':
        parts.push(block.items.join(' '));
        break;
      case 'callout':
        parts.push(`${block.title ?? ''} ${block.text}`);
        break;
      case 'formula':
        parts.push([block.formula, block.substitution, block.result, ...(block.where ?? [])]
          .filter(Boolean)
          .join(' '));
        break;
      case 'table':
        parts.push([block.caption ?? '', ...block.columns, ...block.rows.flat()].join(' '));
        break;
      case 'calculator':
      case 'reference':
        parts.push(`${block.title} ${block.text}`);
        break;
      case 'figure':
        parts.push(block.caption);
        break;
      default:
        break;
    }
  }

  // Разметка `**жирный**` и ссылки `[[термин|подпись]]` в поиске не нужны.
  return parts
    .join('\n')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levelFiles(contentDirPath: string): string[] {
  const dir = `${contentDirPath}/academy`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

/** Подпись содержимого Академии — для пересборки при изменении файлов. */
export function academySignature(contentDirPath: string): string {
  const files = levelFiles(contentDirPath);
  const parts = files.map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as LevelFile;
    const questions = data.lessons.reduce((sum, l) => sum + l.questions.length, 0);
    return `${data.level}:${data.collectedAt}:${data.lessons.length}:${questions}`;
  });
  return parts.join(',') || 'empty';
}

export interface AcademySeedInfo {
  lessons: number;
  questions: number;
  levels: string[];
}

export function seedAcademy(db: Db, contentDirPath: string): AcademySeedInfo {
  const insertLesson = db.prepare(`
    INSERT INTO lessons
      (key, level, order_index, title, summary, body_md, blocks_json,
       reading_minutes, calculator_key, xp_award, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertQuestion = db.prepare(`
    INSERT INTO questions
      (key, category, type, prompt, options_json, match_options_json, correct_json,
       unit, tolerance_percent, explanation, difficulty, lesson_id, order_index, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let lessonCount = 0;
  let questionCount = 0;
  const levels: string[] = [];

  for (const file of levelFiles(contentDirPath)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as LevelFile;
    const plan = ACADEMY_PLAN.find((l) => l.key === data.level);
    if (!plan) throw new Error(`${file}: уровень «${data.level}» отсутствует в программе курса`);
    levels.push(data.level);

    for (const lesson of data.lessons) {
      if (!isAcademyLessonKey(lesson.key)) {
        throw new Error(`${file}: урок «${lesson.key}» не описан в программе курса §4`);
      }
      if (levelOfLesson(lesson.key)?.key !== data.level) {
        throw new Error(
          `${file}: урок «${lesson.key}» по программе принадлежит другому уровню`,
        );
      }

      // Порядок урока берётся из программы, а не из файла: так перестановка
      // уроков в JSON не меняет курс незаметно для читателя.
      const order = plan.lessons.indexOf(lesson.key);

      const info = insertLesson.run(
        lesson.key,
        data.level,
        order,
        lesson.title,
        lesson.summary,
        lessonPlainText(lesson.blocks),
        JSON.stringify(lesson.blocks),
        lesson.readingMinutes,
        lesson.calculatorKey ?? null,
        lesson.xpAward,
        lesson.source,
      );
      lessonCount += 1;

      const lessonId = Number(info.lastInsertRowid);

      lesson.questions.forEach((question, index) => {
        if (question.type === 'numeric' && question.tolerancePercent === undefined) {
          throw new Error(`${question.key}: расчётный вопрос без допуска проверить нечем`);
        }
        if (!question.explanation?.trim()) {
          throw new Error(`${question.key}: §3.7 требует пояснение у каждого вопроса`);
        }

        insertQuestion.run(
          question.key,
          question.category,
          question.type,
          question.prompt,
          question.options ? JSON.stringify(question.options) : null,
          question.matchOptions ? JSON.stringify(question.matchOptions) : null,
          JSON.stringify(question.correct),
          question.unit ?? null,
          question.tolerancePercent ?? null,
          question.explanation,
          question.difficulty,
          lessonId,
          index,
          lesson.source,
        );
        questionCount += 1;
      });
    }
  }

  return { lessons: lessonCount, questions: questionCount, levels };
}
