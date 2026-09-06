import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateLayout } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile } from './repos/profiles.js';
import {
  LAYOUT_PASS_SCORE,
  layoutReference,
  layoutTask,
  layoutTasks,
  saveLayoutAttempt,
} from './repos/layout.js';
import { sectionProgress } from './repos/progress.js';

/**
 * Тренажёр раскладки на настоящих заданиях репозитория.
 *
 * Главное, что здесь проверяется, — что эталонные решения действительно
 * проходят собственные проверки. Поле `qa_verified` должно быть вычисленным
 * фактом, а не обещанием.
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
    skillLevel: 'designer' as const,
    unitSystem: 'metric' as const,
  };
  profileId = createProfile(db, draft).id;
  otherProfileId = createProfile(db, { ...draft, name: 'Мария' }).id;
});

describe('Задания тренажёра (§3.4)', () => {
  it('заданий не меньше восьми, как требует §3.4', () => {
    expect(layoutTasks(db, profileId).length).toBeGreaterThanOrEqual(8);
  });

  it('у всех заданий qa_verified = true (§13)', () => {
    for (const task of layoutTasks(db, profileId)) {
      expect(task.qaVerified, task.key).toBe(true);
    }
  });

  it('в разборе задания записан результат проверки эталона, а не обещание', () => {
    for (const task of layoutTasks(db, profileId)) {
      const detail = layoutTask(db, profileId, task.key);
      expect(detail.qaNotes, task.key).toMatch(/покрытие/);
      expect(detail.qaNotes, task.key).toMatch(/оценка/);
    }
  });

  it('план каждого задания разбирается и содержит контур', () => {
    for (const task of layoutTasks(db, profileId)) {
      const detail = layoutTask(db, profileId, task.key);
      expect(detail.plan.boundary.points.length, task.key).toBeGreaterThanOrEqual(3);
      expect(detail.plan.sourceFlowM3h, task.key).toBeGreaterThan(0);
      expect(detail.lesson.length, task.key).toBeGreaterThan(40);
    }
  });

  it('задания идут по возрастанию сложности', () => {
    const levels = layoutTasks(db, profileId).map((t) => t.difficulty);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
    }
  });

  it('на несуществующее задание отвечает ошибкой', () => {
    expect(() => layoutTask(db, profileId, 'nope')).toThrow(/не найдено/);
  });
});

describe('Эталонные решения проходят собственные проверки', () => {
  it('каждый эталон покрывает участок и не содержит ошибок', () => {
    for (const task of layoutTasks(db, profileId)) {
      // Эталон открывается после попытки — делаем формальную.
      saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
      const reference = layoutReference(db, profileId, task.key);
      const detail = layoutTask(db, profileId, task.key);

      const result = evaluateLayout(detail.plan, reference.heads, { cellSizeM: 0.25 });

      expect(reference.heads.length, task.key).toBeGreaterThan(0);
      expect(result.coverage.coverageRatio, task.key).toBeGreaterThanOrEqual(0.95);
      expect(result.notes.filter((n) => n.severity === 'error'), task.key).toHaveLength(0);
      expect(result.score, task.key).toBeGreaterThanOrEqual(LAYOUT_PASS_SCORE);
    }
  });

  it('эталон укладывается в дебит источника', () => {
    for (const task of layoutTasks(db, profileId)) {
      saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
      const reference = layoutReference(db, profileId, task.key);
      const detail = layoutTask(db, profileId, task.key);

      const { summary } = evaluateLayout(detail.plan, reference.heads, { cellSizeM: 0.5 });
      expect(summary.sourceUtilisation, task.key).toBeLessThanOrEqual(0.8);
    }
  });

  it('сопла эталона согласованы по секторам', () => {
    for (const task of layoutTasks(db, profileId)) {
      saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
      const reference = layoutReference(db, profileId, task.key);

      // Расход на градус сектора должен совпадать у всех голов одной модели.
      const byModel = new Map<string, number[]>();
      for (const head of reference.heads) {
        const key = `${head.model}`;
        const list = byModel.get(key) ?? [];
        list.push(head.flowLph / head.sweepDeg);
        byModel.set(key, list);
      }

      for (const [model, values] of byModel) {
        const spread = Math.max(...values) / Math.min(...values);
        expect(spread, `${task.key} / ${model}`).toBeLessThan(1.1);
      }
    }
  });
});

describe('Эталон скрыт до первой попытки', () => {
  it('без попытки эталон не отдаётся', () => {
    const task = layoutTasks(db, profileId)[0]!;
    expect(() => layoutReference(db, profileId, task.key)).toThrow(/после первой попытки/);
  });

  it('после попытки отдаётся вместе с разбором', () => {
    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });

    const reference = layoutReference(db, profileId, task.key);
    expect(reference.heads.length).toBeGreaterThan(0);
    expect(reference.lesson.length).toBeGreaterThan(40);
  });

  it('попытка одного профиля не открывает эталон другому', () => {
    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });

    expect(() => layoutReference(db, otherProfileId, task.key)).toThrow(/после первой попытки/);
  });
});

describe('Попытки и зачёт', () => {
  it('оценка пересчитывается главным процессом, а не берётся из запроса', () => {
    const task = layoutTasks(db, profileId)[0]!;
    // Пустая раскладка не может получить хорошую оценку, что бы ни прислал UI.
    const result = saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.completed).toBe(false);
  });

  it('эталонная раскладка засчитывается', () => {
    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
    const reference = layoutReference(db, profileId, task.key);

    const result = saveLayoutAttempt(db, profileId, {
      taskKey: task.key,
      heads: reference.heads,
    });

    expect(result.passed).toBe(true);
    expect(result.completed).toBe(true);
    expect(result.bestScore).toBeGreaterThanOrEqual(LAYOUT_PASS_SCORE);
  });

  it('лучший результат не портится последующей слабой попыткой', () => {
    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
    const reference = layoutReference(db, profileId, task.key);

    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: reference.heads });
    const after = saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });

    expect(after.score).toBe(0);
    expect(after.bestScore).toBeGreaterThanOrEqual(LAYOUT_PASS_SCORE);
    expect(after.completed).toBe(true);
  });

  it('последняя раскладка возвращается, чтобы продолжить с того же места', () => {
    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
    const reference = layoutReference(db, profileId, task.key);
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: reference.heads });

    const detail = layoutTask(db, profileId, task.key);
    expect(detail.lastAttempt).toHaveLength(reference.heads.length);
  });

  it('история попыток по заданию не растёт бесконечно', () => {
    const task = layoutTasks(db, profileId)[0]!;
    for (let i = 0; i < 30; i += 1) {
      saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
    }

    const row = db
      .prepare('SELECT COUNT(*) AS n FROM layout_attempts WHERE profile_id = ?')
      .get(profileId) as { n: number };
    expect(Number(row.n)).toBeLessThanOrEqual(20);
  });

  it('прогресс раздела считает засчитанные задания', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'layout')!;
    expect(before.done).toBe(0);
    expect(before.total).toBeGreaterThanOrEqual(8);

    const task = layoutTasks(db, profileId)[0]!;
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: [] });
    const reference = layoutReference(db, profileId, task.key);
    saveLayoutAttempt(db, profileId, { taskKey: task.key, heads: reference.heads });

    const after = sectionProgress(db, profileId).find((s) => s.key === 'layout')!;
    expect(after.done).toBe(1);
  });

  it('на несуществующее задание попытка не сохраняется', () => {
    expect(() => saveLayoutAttempt(db, profileId, { taskKey: 'nope', heads: [] })).toThrow(
      /не найдено/,
    );
  });
});
