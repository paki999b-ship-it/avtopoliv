import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { CALCULATORS, isAcademyLessonKey } from '@irrigo/core';
import type { Db } from './connection.js';
import type { CauseLikelihood, DiagnosticsCause } from '../../shared/diagnostics.js';

/**
 * Наполнение дерева диагностики из `/content/diagnostics` (§12 п.9).
 *
 * В файле дерево записано вложенным — так его читает и правит человек.
 * В базе оно лежит плоско, строкой на узел со ссылкой на родителя: схема §7
 * описана именно так, и по ней же собирается обратный обход.
 *
 * §3.6 требует, чтобы каждый исход был связан с уроком. Это не пожелание, а
 * проверка при сборке: исход без урока — тупик, из которого пользователю
 * некуда идти дальше.
 */

interface RawConclusion {
  key: string;
  conclusion: string;
  causes: DiagnosticsCause[];
  measure: string;
  action: string;
  lessonKey: string;
  calculatorKey?: string;
}

interface RawQuestion {
  key: string;
  question: string;
  answers: Array<{ label: string; next: RawNode }>;
}

type RawNode = RawQuestion | RawConclusion;

interface RawSymptom {
  key: string;
  title: string;
  hint: string;
  root: RawNode;
}

interface DiagnosticsFile {
  note: string;
  collectedAt: string;
  symptoms: RawSymptom[];
}

export const DIAGNOSTICS_TABLES = ['diagnostics_nodes'] as const;

const LIKELIHOODS: readonly CauseLikelihood[] = ['high', 'medium', 'low'];
const CALCULATOR_KEYS = new Set<string>(CALCULATORS.map((c) => c.key));

const isQuestion = (node: RawNode): node is RawQuestion => 'question' in node;

function files(contentDirPath: string): string[] {
  const dir = `${contentDirPath}/diagnostics`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

export function diagnosticsSignature(contentDirPath: string): string {
  const parts = files(contentDirPath).map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as DiagnosticsFile;
    return `${data.collectedAt}:${data.symptoms.length}`;
  });
  return parts.join(',') || 'empty';
}

export function seedDiagnostics(db: Db, contentDirPath: string): number {
  const insert = db.prepare(`
    INSERT INTO diagnostics_nodes
      (key, parent_key, is_symptom, symptom_or_question, answers_json, conclusion,
       causes_json, measure_hint, action_hint, related_lesson_id,
       related_calculator_key, hint, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const lessonId = db.prepare('SELECT id FROM lessons WHERE key = ?');
  const keys = new Set<string>();
  let symptoms = 0;

  function claim(key: string, where: string): void {
    if (keys.has(key)) throw new Error(`${where}: ключ узла «${key}» уже занят`);
    keys.add(key);
  }

  function writeNode(node: RawNode, parentKey: string, symptomKey: string): void {
    claim(node.key, symptomKey);

    if (isQuestion(node)) {
      if (node.answers.length < 2) {
        throw new Error(`${node.key}: вопрос с одним ответом ничего не уточняет`);
      }

      insert.run(
        node.key,
        parentKey,
        0,
        node.question,
        JSON.stringify(node.answers.map((a) => ({ label: a.label, nextKey: a.next.key }))),
        null,
        '[]',
        null,
        null,
        null,
        null,
        null,
        0,
      );

      for (const answer of node.answers) {
        if (!answer.label.trim()) throw new Error(`${node.key}: ответ без текста`);
        writeNode(answer.next, node.key, symptomKey);
      }
      return;
    }

    // Исход ветки.
    if (node.causes.length === 0) {
      throw new Error(`${node.key}: §3.6 требует список вероятных причин`);
    }
    for (const cause of node.causes) {
      if (!LIKELIHOODS.includes(cause.likelihood)) {
        throw new Error(`${node.key}: неизвестная вероятность «${cause.likelihood}»`);
      }
      if (!cause.note?.trim()) throw new Error(`${node.key}: причина без пояснения`);
    }
    if (!node.measure?.trim()) throw new Error(`${node.key}: не сказано, что замерить`);
    if (!node.action?.trim()) throw new Error(`${node.key}: не сказано, что сделать`);

    if (!isAcademyLessonKey(node.lessonKey)) {
      throw new Error(`${node.key}: урок «${node.lessonKey}» не описан в программе §4`);
    }
    const lesson = lessonId.get(node.lessonKey) as { id: number } | undefined;
    if (!lesson) {
      throw new Error(`${node.key}: урок «${node.lessonKey}» не наполнен — исход ведёт в пустоту`);
    }
    if (node.calculatorKey && !CALCULATOR_KEYS.has(node.calculatorKey)) {
      throw new Error(`${node.key}: калькулятора «${node.calculatorKey}» нет`);
    }

    insert.run(
      node.key,
      parentKey,
      0,
      node.conclusion,
      '[]',
      node.conclusion,
      JSON.stringify(node.causes),
      node.measure,
      node.action,
      lesson.id,
      node.calculatorKey ?? null,
      null,
      0,
    );
  }

  for (const file of files(contentDirPath)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as DiagnosticsFile;

    for (const symptom of data.symptoms) {
      claim(symptom.key, file);
      if (!symptom.hint?.trim()) {
        throw new Error(`${symptom.key}: без описания симптом не отличить от соседнего`);
      }

      insert.run(
        symptom.key,
        null,
        1,
        symptom.title,
        '[]',
        null,
        '[]',
        null,
        null,
        null,
        null,
        symptom.hint,
        symptoms,
      );
      symptoms += 1;

      writeNode(symptom.root, symptom.key, symptom.key);
    }
  }

  return symptoms;
}
