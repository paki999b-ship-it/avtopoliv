import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CALCULATORS, isAcademyLessonKey } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile } from './repos/profiles.js';
import {
  diagnosticsSymptom,
  diagnosticsSymptoms,
  markDiagnosticsResolved,
} from './repos/diagnostics.js';
import { sectionProgress } from './repos/progress.js';
import type { DiagnosticsNode } from '../../shared/diagnostics.js';

/**
 * Диагностика на настоящем дереве репозитория.
 *
 * Ключевое требование §3.6 — каждый исход связан с уроком: тупик, из которого
 * некуда идти, учебной ценности не имеет.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;
let profileId: number;
let otherProfileId: number;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);

  const draft = {
    name: 'Алексей',
    avatar: '💧',
    skillLevel: 'installer' as const,
    unitSystem: 'metric' as const,
  };
  profileId = createProfile(db, draft).id;
  otherProfileId = createProfile(db, { ...draft, name: 'Мария' }).id;
});

/** Все исходы поддерева. */
function outcomes(node: DiagnosticsNode): Extract<DiagnosticsNode, { kind: 'conclusion' }>[] {
  return node.kind === 'conclusion'
    ? [node]
    : node.answers.flatMap((a) => outcomes(a.next));
}

function allTrees() {
  return diagnosticsSymptoms(db, profileId).map((s) => diagnosticsSymptom(db, profileId, s.key));
}

describe('Состав дерева (§3.6)', () => {
  it('симптомов не меньше пятнадцати', () => {
    expect(diagnosticsSymptoms(db, profileId).length).toBeGreaterThanOrEqual(15);
  });

  it('у каждого симптома есть описание и дерево разбора', () => {
    for (const tree of allTrees()) {
      expect(tree.hint.length, tree.key).toBeGreaterThan(20);
      expect(tree.outcomes, tree.key).toBeGreaterThanOrEqual(2);
    }
  });

  it('каждая ветка заканчивается исходом, а не вопросом', () => {
    for (const tree of allTrees()) {
      const walk = (node: DiagnosticsNode): void => {
        if (node.kind === 'conclusion') {
          expect(node.conclusion.length, node.key).toBeGreaterThan(20);
          return;
        }
        expect(node.answers.length, node.key).toBeGreaterThanOrEqual(2);
        node.answers.forEach((a) => walk(a.next));
      };
      walk(tree.root);
    }
  });

  it('каждый исход связан с существующим уроком', () => {
    for (const tree of allTrees()) {
      for (const outcome of outcomes(tree.root)) {
        expect(isAcademyLessonKey(outcome.lessonKey), outcome.key).toBe(true);
        expect(outcome.lessonTitle.length, outcome.key).toBeGreaterThan(0);
      }
    }
  });

  it('ссылки на калькуляторы ведут в существующие расчёты', () => {
    const keys = new Set<string>(CALCULATORS.map((c) => c.key));
    for (const tree of allTrees()) {
      for (const outcome of outcomes(tree.root)) {
        if (!outcome.calculatorKey) continue;
        expect(keys.has(outcome.calculatorKey), outcome.calculatorKey).toBe(true);
        expect(outcome.calculatorTitle, outcome.key).toBeTruthy();
      }
    }
  });

  it('у каждого исхода есть причины с приоритетом, замер и действие', () => {
    for (const tree of allTrees()) {
      for (const outcome of outcomes(tree.root)) {
        expect(outcome.causes.length, outcome.key).toBeGreaterThanOrEqual(1);
        expect(outcome.measure.length, outcome.key).toBeGreaterThan(20);
        expect(outcome.action.length, outcome.key).toBeGreaterThan(20);

        // Первая причина не менее вероятна, чем последняя: §3.6 требует
        // приоритета, а не произвольного порядка.
        const rank = { high: 0, medium: 1, low: 2 } as const;
        const ranks = outcome.causes.map((c) => rank[c.likelihood]);
        expect([...ranks].sort((a, b) => a - b), outcome.key).toEqual(ranks);
      }
    }
  });

  it('ключи узлов уникальны по всему дереву', () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM diagnostics_nodes').get() as { n: number };
    const distinct = db
      .prepare('SELECT COUNT(DISTINCT key) AS n FROM diagnostics_nodes')
      .get() as { n: number };
    expect(Number(distinct.n)).toBe(Number(row.n));
  });

  it('на несуществующий симптом отвечает ошибкой', () => {
    expect(() => diagnosticsSymptom(db, profileId, 'nope')).toThrow(/не найден/);
  });

  it('симптом нельзя открыть как обычный узел дерева', () => {
    const tree = allTrees()[0]!;
    expect(() => diagnosticsSymptom(db, profileId, tree.root.key)).toThrow(/не найден/);
  });
});

describe('Прогресс по симптомам', () => {
  it('симптом отмечается разобранным только по явному вызову', () => {
    const symptom = diagnosticsSymptoms(db, profileId)[0]!;
    expect(symptom.visited).toBe(false);

    // Просто открыть разбор недостаточно — это ещё не «разобрался».
    diagnosticsSymptom(db, profileId, symptom.key);
    expect(diagnosticsSymptoms(db, profileId)[0]!.visited).toBe(false);

    markDiagnosticsResolved(db, profileId, symptom.key);
    expect(diagnosticsSymptoms(db, profileId)[0]!.visited).toBe(true);
  });

  it('повторный проход не удваивает прогресс', () => {
    const symptom = diagnosticsSymptoms(db, profileId)[0]!;
    markDiagnosticsResolved(db, profileId, symptom.key);
    const second = markDiagnosticsResolved(db, profileId, symptom.key);

    expect(second.visited).toBe(1);
  });

  it('прогресс раздела считает разобранные симптомы', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'diagnostics')!;
    expect(before.done).toBe(0);
    expect(before.total).toBeGreaterThanOrEqual(15);

    markDiagnosticsResolved(db, profileId, diagnosticsSymptoms(db, profileId)[0]!.key);

    const after = sectionProgress(db, profileId).find((s) => s.key === 'diagnostics')!;
    expect(after.done).toBe(1);
  });

  it('прогресс одного профиля не виден другому', () => {
    markDiagnosticsResolved(db, profileId, diagnosticsSymptoms(db, profileId)[0]!.key);
    expect(diagnosticsSymptoms(db, otherProfileId).every((s) => !s.visited)).toBe(true);
  });

  it('на несуществующий симптом прогресс не пишется', () => {
    expect(() => markDiagnosticsResolved(db, profileId, 'nope')).toThrow(/не найден/);
  });
});

describe('Симптомы из §3.6 покрыты', () => {
  it('перечисленные в ТЗ симптомы есть в дереве', () => {
    const expected = [
      'diag-mist',
      'diag-short-radius',
      'diag-zone-no-start',
      'diag-zone-wont-stop',
      'diag-all-weak',
      'diag-low-head-puddle',
      'diag-rotor-stuck',
      'diag-dry-spots',
      'diag-drip-end-dry',
      'diag-rcd-trips',
      'diag-controller-resets',
      'diag-valve-hum',
      'diag-pressure-drop',
      'diag-clogging',
      'diag-meter-creep',
    ];

    const present = new Set(diagnosticsSymptoms(db, profileId).map((s) => s.key));
    for (const key of expected) expect(present.has(key), key).toBe(true);
  });
});
