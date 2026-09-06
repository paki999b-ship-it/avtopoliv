import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { isAcademyLessonKey } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile } from './repos/profiles.js';
import {
  SCENARIO_PASS_SCORE,
  scenarioDetail,
  scenarioList,
  submitScenario,
} from './repos/scenarios.js';
import { sectionProgress } from './repos/progress.js';
import { SCENARIO_CATEGORIES } from '../../shared/scenarios.js';
import type { ScenarioCategory } from '../../shared/scenarios.js';

/**
 * Тренажёр «Найди ошибку» на настоящем контенте репозитория.
 *
 * Главное, что здесь проверяется: до отправки ответа наружу не уходит ни
 * признак ошибки, ни разбор, и оценку считает база, а не запрос.
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

/** Ошибочные ключи сценария — читаются напрямую из базы, минуя публичный API. */
function errorKeys(key: string): string[] {
  const row = db.prepare('SELECT errors_json FROM error_scenarios WHERE key = ?').get(key) as
    | { errors_json: string }
    | undefined;
  return JSON.parse(row!.errors_json) as string[];
}

describe('Состав сценариев (§3.5)', () => {
  it('сценариев не меньше тридцати', () => {
    expect(scenarioList(db, profileId).length).toBeGreaterThanOrEqual(30);
  });

  it('покрыты все восемь тем из §3.5', () => {
    const present = new Set(scenarioList(db, profileId).map((s) => s.category));
    for (const category of Object.keys(SCENARIO_CATEGORIES) as ScenarioCategory[]) {
      expect(present.has(category), category).toBe(true);
    }
  });

  it('в каждом сценарии от трёх до шести ошибок', () => {
    for (const item of scenarioList(db, profileId)) {
      expect(item.errorCount, item.key).toBeGreaterThanOrEqual(3);
      expect(item.errorCount, item.key).toBeLessThanOrEqual(6);
    }
  });

  it('в каждом сценарии есть хотя бы один верно выполненный узел', () => {
    for (const item of scenarioList(db, profileId)) {
      const detail = scenarioDetail(db, profileId, item.key);
      expect(detail.items.length, item.key).toBeGreaterThan(item.errorCount);
    }
  });

  it('у каждой карточки есть разбор, а ссылки ведут в существующие уроки', () => {
    for (const item of scenarioList(db, profileId)) {
      const result = submitScenario(db, profileId, {
        scenarioKey: item.key,
        markedKeys: errorKeys(item.key),
      });

      for (const card of result.review) {
        expect(card.explanation.length, `${item.key}/${card.key}`).toBeGreaterThan(20);
        if (card.lessonKey) {
          expect(isAcademyLessonKey(card.lessonKey), card.lessonKey).toBe(true);
        }
      }
    }
  });

  it('на несуществующий сценарий отвечает ошибкой', () => {
    expect(() => scenarioDetail(db, profileId, 'nope')).toThrow(/не найден/);
  });
});

describe('До проверки ответ не раскрывается', () => {
  it('карточки приходят без признака ошибки и без разбора', () => {
    const item = scenarioList(db, profileId)[0]!;
    const detail = scenarioDetail(db, profileId, item.key);

    for (const card of detail.items) {
      expect(Object.keys(card).sort()).toEqual(['group', 'key', 'label']);
    }
  });

  it('количество спрятанных ошибок объявляется заранее', () => {
    const item = scenarioList(db, profileId)[0]!;
    expect(scenarioDetail(db, profileId, item.key).errorCount).toBe(errorKeys(item.key).length);
  });
});

describe('Оценка и зачёт', () => {
  it('все ошибки найдены — сто процентов и зачёт', () => {
    const item = scenarioList(db, profileId)[0]!;
    const result = submitScenario(db, profileId, {
      scenarioKey: item.key,
      markedKeys: errorKeys(item.key),
    });

    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.foundCount).toBe(result.totalErrors);
    expect(result.falsePositiveCount).toBe(0);
  });

  it('«отметить всё» не проходит', () => {
    const item = scenarioList(db, profileId)[0]!;
    const detail = scenarioDetail(db, profileId, item.key);

    const result = submitScenario(db, profileId, {
      scenarioKey: item.key,
      markedKeys: detail.items.map((i) => i.key),
    });

    expect(result.passed).toBe(false);
    expect(result.falsePositiveCount).toBeGreaterThan(0);
  });

  it('пустой ответ даёт ноль, а не зачёт за бездействие', () => {
    const item = scenarioList(db, profileId)[0]!;
    const result = submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: [] });

    expect(result.score).toBe(0);
    expect(result.completed).toBe(false);
  });

  it('разбор приходит по всем карточкам, включая пропущенные', () => {
    const item = scenarioList(db, profileId)[0]!;
    const detail = scenarioDetail(db, profileId, item.key);
    const result = submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: [] });

    expect(result.review).toHaveLength(detail.items.length);
    expect(result.review.filter((r) => r.isError)).toHaveLength(result.totalErrors);
    expect(result.review.every((r) => !r.marked)).toBe(true);
  });

  it('лучший результат не портится последующей слабой попыткой', () => {
    const item = scenarioList(db, profileId)[0]!;
    submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: errorKeys(item.key) });
    const after = submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: [] });

    expect(after.score).toBe(0);
    expect(after.bestScore).toBe(1);
    expect(after.completed).toBe(true);
  });

  it('XP начисляется один раз за сценарий', () => {
    const item = scenarioList(db, profileId)[0]!;
    const first = submitScenario(db, profileId, {
      scenarioKey: item.key,
      markedKeys: errorKeys(item.key),
    });
    const second = submitScenario(db, profileId, {
      scenarioKey: item.key,
      markedKeys: errorKeys(item.key),
    });

    expect(first.xpAwarded).toBeGreaterThan(0);
    expect(second.xpAwarded).toBe(0);
    expect(second.profileXp).toBe(first.profileXp);
  });

  it('незнакомые ключи не влияют на счёт', () => {
    const item = scenarioList(db, profileId)[0]!;
    const result = submitScenario(db, profileId, {
      scenarioKey: item.key,
      markedKeys: [...errorKeys(item.key), 'подделка'],
    });

    expect(result.score).toBe(1);
    expect(result.falsePositiveCount).toBe(0);
  });

  it('история попыток по сценарию не растёт бесконечно', () => {
    const item = scenarioList(db, profileId)[0]!;
    for (let i = 0; i < 30; i += 1) {
      submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: [] });
    }

    const row = db
      .prepare('SELECT COUNT(*) AS n FROM error_attempts WHERE profile_id = ?')
      .get(profileId) as { n: number };
    expect(Number(row.n)).toBeLessThanOrEqual(20);
  });

  it('попытка одного профиля не влияет на прогресс другого', () => {
    const item = scenarioList(db, profileId)[0]!;
    submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: errorKeys(item.key) });

    expect(scenarioList(db, otherProfileId).every((s) => s.attempts === 0)).toBe(true);
  });

  it('прогресс раздела считает разобранные сценарии', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'errors')!;
    expect(before.done).toBe(0);
    expect(before.total).toBeGreaterThanOrEqual(30);

    const item = scenarioList(db, profileId)[0]!;
    submitScenario(db, profileId, { scenarioKey: item.key, markedKeys: errorKeys(item.key) });

    const after = sectionProgress(db, profileId).find((s) => s.key === 'errors')!;
    expect(after.done).toBe(1);
  });

  it('проходной балл раздела совпадает с тем, по которому считается прогресс', () => {
    // В `sectionProgress` порог зашит числом 0,75 — если он разъедется с
    // репозиторием, пользователь увидит «зачтено» без прогресса.
    expect(SCENARIO_PASS_SCORE).toBe(0.75);
  });
});
