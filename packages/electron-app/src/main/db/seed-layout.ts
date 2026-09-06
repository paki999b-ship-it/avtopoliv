import { readFileSync, existsSync } from 'node:fs';
import type { LayoutHead, LayoutPlan } from '@irrigo/core';
import type { Db } from './connection.js';

/**
 * Наполнение заданий тренажёра раскладки (§3.4).
 *
 * Файл собирается скриптом `scripts/build-layout-tasks.ts`, который сам
 * проверяет эталонные решения расчётным движком. Здесь только перенос в базу
 * с одной проверкой: непроверенное задание в приложение не попадает.
 */

interface TaskFile {
  note: string;
  collectedAt: string;
  qaCellSizeM: number;
  tasks: Array<{
    key: string;
    title: string;
    brief: string;
    difficulty: number;
    lesson: string;
    plan: LayoutPlan;
    reference: LayoutHead[];
    qaVerified: boolean;
    qaNotes: string;
    areaM2: number;
  }>;
}

export const LAYOUT_TABLES = ['layout_tasks'] as const;

function filePath(contentDirPath: string): string {
  return `${contentDirPath}/layout/tasks.json`;
}

export function layoutSignature(contentDirPath: string): string {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 'empty';
  const data = JSON.parse(readFileSync(path, 'utf8')) as TaskFile;
  return `${data.collectedAt}:${data.tasks.length}`;
}

export function seedLayoutTasks(db: Db, contentDirPath: string): number {
  const path = filePath(contentDirPath);
  if (!existsSync(path)) return 0;

  const data = JSON.parse(readFileSync(path, 'utf8')) as TaskFile;

  const insert = db.prepare(`
    INSERT INTO layout_tasks
      (key, title, brief, difficulty, plan_json, reference_solution_json, qa_verified, qa_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const task of data.tasks) {
    // §13 ТЗ: у всех заданий qa_verified = true. Непроверенное задание — это
    // эталон, который сам не проходит собственные проверки; показывать такое
    // как образец нельзя.
    if (!task.qaVerified) {
      throw new Error(`Задание «${task.key}» не прошло проверку эталона и в базу не идёт`);
    }

    insert.run(
      task.key,
      task.title,
      task.brief,
      task.difficulty,
      // План и разбор хранятся вместе: они описывают одно задание и всегда
      // читаются вместе.
      JSON.stringify({ plan: task.plan, lesson: task.lesson, areaM2: task.areaM2 }),
      JSON.stringify(task.reference),
      1,
      task.qaNotes,
    );
    count += 1;
  }

  return count;
}
