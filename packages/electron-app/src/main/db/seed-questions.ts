import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { checkNumericAnswer, isAcademyLessonKey } from '@irrigo/core';
import type { Db } from './connection.js';

/**
 * Наполнение экзаменационного банка вопросов из `/content/questions` (§12 п.11).
 *
 * Банк лежит в той же таблице `questions`, что и мини-тесты уроков, но с
 * пулом `bank`: структура и проверка ответов у них одни и те же, различается
 * только назначение. Мини-тест урока берёт свои вопросы по `lesson_id` и
 * пулу `lesson`, экзамен — из всей таблицы.
 *
 * Расчётная часть банка собирается скриптом `scripts/build-question-bank.ts`:
 * правильные ответы там результат работы движка, а не набранные руками числа.
 */

interface RawQuestion {
  key: string;
  category: string;
  type: 'single' | 'multi' | 'numeric' | 'match';
  difficulty: number;
  prompt: string;
  options?: string[];
  matchOptions?: string[];
  correct: number | number[];
  unit?: string;
  tolerancePercent?: number;
  explanation: string;
  lessonKey?: string;
  source: string;
}

interface BankFile {
  note: string;
  questions: RawQuestion[];
}

export const QUESTION_BANK_TABLES: readonly string[] = [];

function bankFiles(contentDirPath: string): string[] {
  const dir = `${contentDirPath}/questions`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

export function questionBankSignature(contentDirPath: string): string {
  const parts = bankFiles(contentDirPath).map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as BankFile;
    return `${file.split('/').pop()}:${data.questions.length}`;
  });
  return parts.join(',') || 'empty';
}

export function seedQuestionBank(db: Db, contentDirPath: string): number {
  const insert = db.prepare(`
    INSERT INTO questions
      (key, category, type, prompt, options_json, match_options_json, correct_json,
       unit, tolerance_percent, explanation, difficulty, lesson_id, order_index,
       source, pool)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bank')
  `);

  const lessonId = db.prepare('SELECT id FROM lessons WHERE key = ?');
  let count = 0;

  for (const file of bankFiles(contentDirPath)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as BankFile;

    data.questions.forEach((q, index) => {
      if (!q.explanation?.trim()) {
        throw new Error(`${q.key}: §3.7 требует пояснение у каждого вопроса`);
      }
      if (q.type === 'numeric') {
        if (q.tolerancePercent === undefined) {
          throw new Error(`${q.key}: расчётный вопрос без допуска проверить нечем`);
        }
        if (typeof q.correct !== 'number' || !Number.isFinite(q.correct)) {
          throw new Error(`${q.key}: у расчётного вопроса нет числового ответа`);
        }
        // Проверка тем же движком, который будет сверять ответ пользователя:
        // если эталон не проходит собственную проверку, вопрос сломан.
        const check = checkNumericAnswer(q.correct, q.correct, q.tolerancePercent);
        if (!check.correct) throw new Error(`${q.key}: эталонный ответ не проходит проверку`);
      } else if (!q.options || q.options.length < 2) {
        throw new Error(`${q.key}: вопрос с выбором без вариантов ответа`);
      }
      if (q.lessonKey && !isAcademyLessonKey(q.lessonKey)) {
        throw new Error(`${q.key}: урок «${q.lessonKey}» не описан в программе §4`);
      }

      // Разбор ошибок экзамена ведёт на урок; если урока ещё нет, вопрос
      // остаётся в банке, но без ссылки — тупика в интерфейсе не будет.
      const lesson = q.lessonKey
        ? (lessonId.get(q.lessonKey) as { id: number } | undefined)
        : undefined;

      insert.run(
        q.key,
        q.category,
        q.type,
        q.prompt,
        q.options ? JSON.stringify(q.options) : null,
        q.matchOptions ? JSON.stringify(q.matchOptions) : null,
        JSON.stringify(q.correct),
        q.unit ?? null,
        q.tolerancePercent ?? null,
        q.explanation,
        q.difficulty,
        lesson?.id ?? null,
        index,
        q.source,
      );
      count += 1;
    });
  }

  return count;
}
