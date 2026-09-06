import { readFileSync, existsSync } from 'node:fs';
import { CALCULATORS, isAcademyLessonKey } from '@irrigo/core';
import type { Db } from './connection.js';
import type { LessonBlock } from '../../shared/academy.js';
import { SAFETY_CATEGORIES } from '../../shared/safety.js';
import type { SafetyCategory } from '../../shared/safety.js';

/**
 * Наполнение раздела «Безопасность и границы» (§12 п.10).
 *
 * §3.8 перечисляет восемь тем поимённо, и сборка требует все восемь: раздел
 * без темы о защите от обратного потока или о первой помощи — это не «неполный
 * раздел», а отсутствие того, ради чего он в ТЗ появился.
 */

interface RawTopic {
  key: string;
  category: SafetyCategory;
  title: string;
  summary: string;
  lessonKeys?: string[];
  blocks: LessonBlock[];
}

interface SafetyFile {
  note: string;
  collectedAt: string;
  topics: RawTopic[];
}

export const SAFETY_TABLES = ['safety_topics'] as const;

const CALCULATOR_KEYS = new Set<string>(CALCULATORS.map((c) => c.key));

function filePath(contentDirPath: string): string {
  return `${contentDirPath}/safety/topics.json`;
}

export function safetySignature(contentDirPath: string): string {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 'empty';
  const data = JSON.parse(readFileSync(path, 'utf8')) as SafetyFile;
  const blocks = data.topics.reduce((sum, t) => sum + t.blocks.length, 0);
  return `${data.collectedAt}:${data.topics.length}:${blocks}`;
}

export function seedSafetyTopics(db: Db, contentDirPath: string): number {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 0;

  const data = JSON.parse(readFileSync(path, 'utf8')) as SafetyFile;

  const insert = db.prepare(`
    INSERT INTO safety_topics (key, category, title, content, media_path, order_index)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seen = new Set<SafetyCategory>();

  for (const topic of data.topics) {
    if (!SAFETY_CATEGORIES.includes(topic.category)) {
      throw new Error(`${topic.key}: неизвестная тема безопасности «${topic.category}»`);
    }
    if (seen.has(topic.category)) {
      throw new Error(`${topic.key}: тема «${topic.category}» уже описана другой карточкой`);
    }
    seen.add(topic.category);

    if (topic.blocks.length === 0) {
      throw new Error(`${topic.key}: пустая карточка безопасности`);
    }
    if (!topic.summary?.trim()) {
      throw new Error(`${topic.key}: без краткого описания карточку не отличить в списке`);
    }

    for (const lessonKey of topic.lessonKeys ?? []) {
      if (!isAcademyLessonKey(lessonKey)) {
        throw new Error(`${topic.key}: урок «${lessonKey}» не описан в программе §4`);
      }
    }
    for (const block of topic.blocks) {
      if (block.type === 'calculator' && !CALCULATOR_KEYS.has(block.calculatorKey)) {
        throw new Error(`${topic.key}: калькулятора «${block.calculatorKey}» нет`);
      }
    }

    insert.run(
      topic.key,
      topic.category,
      topic.title,
      JSON.stringify({
        summary: topic.summary,
        blocks: topic.blocks,
        lessonKeys: topic.lessonKeys ?? [],
      }),
      null,
      SAFETY_CATEGORIES.indexOf(topic.category),
    );
  }

  // §3.8 перечисляет восемь тем — раздел собирается только целиком.
  const missing = SAFETY_CATEGORIES.filter((c) => !seen.has(c));
  if (missing.length > 0) {
    throw new Error(`§3.8: не описаны темы безопасности: ${missing.join(', ')}`);
  }

  return data.topics.length;
}
