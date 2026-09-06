import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { CALCULATORS, isAcademyLessonKey } from '@irrigo/core';
import type { Db } from './connection.js';
import { SCENARIO_CATEGORIES } from '../../shared/scenarios.js';
import type { ScenarioCategory } from '../../shared/scenarios.js';

/**
 * Наполнение тренажёра «Найди ошибку» из `/content/scenarios` (§12 п.8).
 *
 * Проверки жёсткие по той же причине, что и в Академии: сценарий без ошибок,
 * без пояснения или со ссылкой на несуществующий урок — это дефект контента,
 * который в базе выглядит как рабочее задание. Лучше не собраться при сборке.
 */

interface RawItem {
  key: string;
  group: string;
  label: string;
  isError: boolean;
  explanation: string;
  lessonKey?: string;
  calculatorKey?: string;
}

interface RawScenario {
  key: string;
  title: string;
  category: ScenarioCategory;
  difficulty: number;
  description: string;
  imagePath?: string;
  items: RawItem[];
}

interface ScenarioFile {
  note: string;
  collectedAt: string;
  scenarios: RawScenario[];
}

export const SCENARIO_TABLES = ['error_scenarios'] as const;

/** §3.5: в сценарии от трёх до шести спрятанных ошибок. */
const MIN_ERRORS = 3;
const MAX_ERRORS = 6;

const CALCULATOR_KEYS = new Set<string>(CALCULATORS.map((c) => c.key));

function scenarioFiles(contentDirPath: string): string[] {
  const dir = `${contentDirPath}/scenarios`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => `${dir}/${name}`);
}

export function scenariosSignature(contentDirPath: string): string {
  const parts = scenarioFiles(contentDirPath).map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ScenarioFile;
    const items = data.scenarios.reduce((sum, s) => sum + s.items.length, 0);
    return `${data.collectedAt}:${data.scenarios.length}:${items}`;
  });
  return parts.join(',') || 'empty';
}

export function seedScenarios(db: Db, contentDirPath: string): number {
  const insert = db.prepare(`
    INSERT INTO error_scenarios
      (key, title, description, image_path, scene_json, errors_json, category, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seen = new Set<string>();
  let count = 0;

  for (const file of scenarioFiles(contentDirPath)) {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ScenarioFile;

    for (const scenario of data.scenarios) {
      if (seen.has(scenario.key)) {
        throw new Error(`${file}: сценарий «${scenario.key}» уже встречался`);
      }
      seen.add(scenario.key);

      if (!(scenario.category in SCENARIO_CATEGORIES)) {
        throw new Error(`${scenario.key}: неизвестная категория «${scenario.category}»`);
      }

      const keys = new Set<string>();
      for (const item of scenario.items) {
        if (keys.has(item.key)) {
          throw new Error(`${scenario.key}: карточка «${item.key}» повторяется`);
        }
        keys.add(item.key);

        if (!item.explanation?.trim()) {
          throw new Error(`${scenario.key}/${item.key}: карточка без разбора ничему не учит`);
        }
        if (item.lessonKey && !isAcademyLessonKey(item.lessonKey)) {
          throw new Error(
            `${scenario.key}/${item.key}: урок «${item.lessonKey}» не описан в программе §4`,
          );
        }
        if (item.calculatorKey && !CALCULATOR_KEYS.has(item.calculatorKey)) {
          throw new Error(
            `${scenario.key}/${item.key}: калькулятора «${item.calculatorKey}» нет`,
          );
        }
      }

      const errors = scenario.items.filter((i) => i.isError);
      if (errors.length < MIN_ERRORS || errors.length > MAX_ERRORS) {
        throw new Error(
          `${scenario.key}: §3.5 требует от ${MIN_ERRORS} до ${MAX_ERRORS} ошибок, найдено ${errors.length}`,
        );
      }
      // Сценарий, где ошибочно всё, вырождается в «отметить всё»: должен
      // остаться хотя бы один правильно выполненный узел.
      if (errors.length === scenario.items.length) {
        throw new Error(`${scenario.key}: нет ни одной правильной карточки — задание вырождено`);
      }

      insert.run(
        scenario.key,
        scenario.title,
        scenario.description,
        scenario.imagePath ?? null,
        // Карточки и разбор хранятся вместе: они описывают один сценарий и
        // всегда читаются вместе. Наружу разбор отдаётся только после ответа.
        JSON.stringify({ items: scenario.items }),
        JSON.stringify(errors.map((i) => i.key)),
        scenario.category,
        scenario.difficulty,
      );
      count += 1;
    }
  }

  return count;
}
