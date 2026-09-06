import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkNumericAnswer, isAcademyLessonKey } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile } from './repos/profiles.js';
import {
  EXAM_MIN_NUMERIC,
  EXAM_PASS_SCORE,
  EXAM_SIZE,
  buildExamPaper,
  certificate,
  examHistory,
  questionBankStats,
  submitExam,
} from './repos/exam.js';
import { lessonQuiz } from './repos/academy.js';
import type { ExamCategory } from '../../shared/exam.js';

/**
 * База вопросов, экзамен и сертификат (§3.7, §3.9, §13).
 *
 * Отдельно проверяется главная ловушка §3.9: результат должен быть сохранён
 * до того, как интерфейс уйдёт на экран результатов. В коде это выражено
 * тем, что `submitExam` считает и записывает в одной операции, — тест
 * убеждается, что вернувшийся результат уже лежит в базе.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;
let profileId: number;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);

  profileId = createProfile(db, {
    name: 'Алексей',
    avatar: '💧',
    skillLevel: 'designer',
    unitSystem: 'metric',
  }).id;
});

/** Детерминированный «случайный» источник — билет должен собираться стабильно. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe('База вопросов (§13)', () => {
  it('вопросов не меньше трёхсот', () => {
    expect(questionBankStats(db).total).toBeGreaterThanOrEqual(300);
  });

  it('расчётных вопросов не меньше 25 %', () => {
    const stats = questionBankStats(db);
    expect(stats.numericShare).toBeGreaterThanOrEqual(0.25);
  });

  it('все восемь категорий наполнены', () => {
    const categories: ExamCategory[] = [
      'basics',
      'water_plants',
      'hydraulics',
      'equipment',
      'design',
      'automation_electrical',
      'installation_maintenance',
      'safety',
    ];
    const stats = questionBankStats(db);

    for (const category of categories) {
      const row = stats.byCategory.find((c) => c.category === category);
      expect(row?.count ?? 0, category).toBeGreaterThanOrEqual(20);
    }
  });

  it('у каждого вопроса непустое пояснение и источник', () => {
    const rows = db
      .prepare('SELECT key, explanation, source FROM questions')
      .all() as unknown as Array<{ key: string; explanation: string; source: string }>;

    for (const row of rows) {
      expect(row.explanation.trim().length, row.key).toBeGreaterThan(20);
      expect(row.source.trim().length, row.key).toBeGreaterThan(0);
    }
  });

  it('эталонный ответ каждого расчётного вопроса проходит собственную проверку', () => {
    const rows = db
      .prepare(
        "SELECT key, correct_json, tolerance_percent FROM questions WHERE type = 'numeric'",
      )
      .all() as unknown as Array<{
      key: string;
      correct_json: string;
      tolerance_percent: number | null;
    }>;

    for (const row of rows) {
      const expected = JSON.parse(row.correct_json) as number;
      expect(Number.isFinite(expected), row.key).toBe(true);
      expect(row.tolerance_percent, row.key).not.toBeNull();
      expect(checkNumericAnswer(expected, expected, row.tolerance_percent!).correct, row.key).toBe(
        true,
      );
    }
  });

  it('вопросы банка не попадают в мини-тесты уроков', () => {
    const bankLessons = db
      .prepare(
        `SELECT DISTINCT l.key AS lesson_key
         FROM questions q JOIN lessons l ON l.id = q.lesson_id
         WHERE q.pool = 'bank'`,
      )
      .all() as unknown as Array<{ lesson_key: string }>;

    expect(bankLessons.length).toBeGreaterThan(0);

    for (const { lesson_key: lessonKey } of bankLessons) {
      const quiz = lessonQuiz(db, lessonKey);
      const keys = new Set(quiz.map((q) => q.key));
      expect([...keys].some((k) => k.startsWith('bank-')), lessonKey).toBe(false);
    }
  });

  it('ссылки банка на уроки ведут в программу курса', () => {
    const rows = db
      .prepare(
        `SELECT q.key, l.key AS lesson_key
         FROM questions q JOIN lessons l ON l.id = q.lesson_id
         WHERE q.pool = 'bank'`,
      )
      .all() as unknown as Array<{ key: string; lesson_key: string }>;

    for (const row of rows) {
      expect(isAcademyLessonKey(row.lesson_key), row.key).toBe(true);
    }
  });
});

describe('Билет экзамена (§3.9)', () => {
  it('содержит ровно 60 вопросов', () => {
    expect(buildExamPaper(db, seededRandom(1)).questions).toHaveLength(EXAM_SIZE);
  });

  it('расчётных не меньше четверти', () => {
    for (const seed of [1, 7, 42, 1000]) {
      const paper = buildExamPaper(db, seededRandom(seed));
      const numeric = paper.questions.filter((q) => q.type === 'numeric').length;

      expect(numeric, `seed ${seed}`).toBeGreaterThanOrEqual(Math.ceil(EXAM_SIZE * 0.25));
      expect(numeric, `seed ${seed}`).toBeGreaterThanOrEqual(EXAM_MIN_NUMERIC);
      expect(paper.numericCount).toBe(numeric);
    }
  });

  it('представлены все восемь категорий', () => {
    for (const seed of [2, 11, 99]) {
      const paper = buildExamPaper(db, seededRandom(seed));
      const present = new Set(paper.questions.map((q) => q.category));
      expect(present.size, `seed ${seed}`).toBe(8);

      for (const row of paper.byCategory) {
        expect(row.count, `${seed}/${row.category}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('вопросы не повторяются', () => {
    const paper = buildExamPaper(db, seededRandom(5));
    expect(new Set(paper.questions.map((q) => q.id)).size).toBe(EXAM_SIZE);
  });

  it('правильные ответы в билет не попадают', () => {
    const paper = buildExamPaper(db, seededRandom(3));
    const serialised = JSON.stringify(paper.questions[0]);

    expect(serialised).not.toMatch(/correct/);
    for (const question of paper.questions) {
      expect(Object.keys(question)).not.toContain('explanation');
    }
  });

  it('разные попытки дают разные билеты', () => {
    const first = buildExamPaper(db, seededRandom(1)).questions.map((q) => q.id);
    const second = buildExamPaper(db, seededRandom(2)).questions.map((q) => q.id);
    expect(first).not.toEqual(second);
  });

  it('состав билета по темам объявляется заранее', () => {
    const paper = buildExamPaper(db, seededRandom(8));
    const declared = paper.byCategory.reduce((sum, row) => sum + row.count, 0);
    expect(declared).toBe(EXAM_SIZE);
  });
});

/** Правильные ответы для билета — читаются напрямую из базы, минуя API. */
function correctAnswers(ids: number[]): Array<{ questionId: number; answer: unknown }> {
  return ids.map((id) => {
    const row = db
      .prepare('SELECT type, correct_json FROM questions WHERE id = ?')
      .get(id) as { type: string; correct_json: string };
    return { questionId: id, answer: JSON.parse(row.correct_json) as unknown };
  });
}

describe('Завершение экзамена: расчёт → сохранение → результат', () => {
  it('вернувшийся результат уже лежит в базе', () => {
    const paper = buildExamPaper(db, seededRandom(4));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 900,
      answers: correctAnswers(paper.questions.map((q) => q.id)) as never,
    });

    const stored = db
      .prepare('SELECT score, total, correct_count, passed FROM exam_results WHERE id = ?')
      .get(result.id) as {
      score: number;
      total: number;
      correct_count: number;
      passed: number;
    };

    expect(Number(stored.total)).toBe(result.total);
    expect(Number(stored.correct_count)).toBe(result.correctCount);
    expect(Number(stored.score)).toBeCloseTo(result.score, 6);
    expect(stored.passed === 1).toBe(result.passed);
  });

  it('полностью верная работа сдана и получает номер сертификата', () => {
    const paper = buildExamPaper(db, seededRandom(6));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 1200,
      answers: correctAnswers(paper.questions.map((q) => q.id)) as never,
    });

    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.certificateNo).toMatch(/^ИМ-\d{3}-\d{8}-\d{4}$/);
  });

  it('работа без ответов не сдана и сертификата не даёт', () => {
    const paper = buildExamPaper(db, seededRandom(9));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 60,
      answers: paper.questions.map((q) => ({ questionId: q.id, answer: null })),
    });

    expect(result.correctCount).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.certificateNo).toBeNull();
    expect(() => certificate(db, profileId, result.id)).toThrow(/сданный экзамен/);
  });

  it('проходной балл — 75 %', () => {
    const paper = buildExamPaper(db, seededRandom(12));
    const ids = paper.questions.map((q) => q.id);
    // 45 верных из 60 — ровно 75 %.
    const answers = [
      ...correctAnswers(ids.slice(0, 45)),
      ...ids.slice(45).map((id) => ({ questionId: id, answer: null })),
    ];

    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 1500,
      answers: answers as never,
    });

    expect(result.score).toBeCloseTo(EXAM_PASS_SCORE, 6);
    expect(result.passed).toBe(true);
  });

  it('разбор приходит по всем вопросам и содержит пояснения', () => {
    const paper = buildExamPaper(db, seededRandom(13));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 300,
      answers: paper.questions.map((q) => ({ questionId: q.id, answer: null })),
    });

    expect(result.review).toHaveLength(EXAM_SIZE);
    for (const item of result.review) {
      expect(item.explanation.length, String(item.questionId)).toBeGreaterThan(20);
      expect(item.correctAnswer.length, String(item.questionId)).toBeGreaterThan(0);
      expect(item.givenAnswer).toBe('нет ответа');
    }
  });

  it('доля расчётных вопросов записывается в результат', () => {
    const paper = buildExamPaper(db, seededRandom(14));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 100,
      answers: paper.questions.map((q) => ({ questionId: q.id, answer: null })),
    });

    expect(result.numericShare).toBeGreaterThanOrEqual(0.25);
  });

  it('XP за экзамен начисляется один раз', () => {
    const answersFor = (seed: number) => {
      const paper = buildExamPaper(db, seededRandom(seed));
      return correctAnswers(paper.questions.map((q) => q.id));
    };

    const first = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 900,
      answers: answersFor(15) as never,
    });
    const second = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 900,
      answers: answersFor(16) as never,
    });

    expect(first.xpAwarded).toBeGreaterThan(0);
    expect(second.xpAwarded).toBe(0);
    expect(second.profileXp).toBe(first.profileXp);
  });

  it('история попыток возвращается от новых к старым', () => {
    const paper = buildExamPaper(db, seededRandom(17));
    submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 10,
      answers: paper.questions.map((q) => ({ questionId: q.id, answer: null })),
    });
    const second = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 20,
      answers: correctAnswers(paper.questions.map((q) => q.id)) as never,
    });

    const history = examHistory(db, profileId);
    expect(history[0]!.id).toBe(second.id);
    expect(history).toHaveLength(2);
  });

  it('экзамен без ответов вовсе не проверяется', () => {
    expect(() =>
      submitExam(db, profileId, {
        startedAt: new Date().toISOString(),
        durationSec: 0,
        answers: [],
      }),
    ).toThrow(/без ответов/);
  });
});

describe('Сертификат (§3.9, §10 п.7)', () => {
  it('выдаётся за сданный экзамен и содержит оговорку', () => {
    const paper = buildExamPaper(db, seededRandom(21));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 800,
      answers: correctAnswers(paper.questions.map((q) => q.id)) as never,
    });

    const cert = certificate(db, profileId, result.id);

    expect(cert.certificateNo).toBe(result.certificateNo);
    expect(cert.profileName).toBe('Алексей');
    expect(cert.skillLevelTitle).toBe('Проектировщик');
    expect(cert.disclaimer).toMatch(/не является профессиональной аттестацией/);
    expect(cert.disclaimer).toMatch(/не даёт допуска к работам/);
  });

  it('чужой сертификат не отдаётся', () => {
    const paper = buildExamPaper(db, seededRandom(22));
    const result = submitExam(db, profileId, {
      startedAt: new Date().toISOString(),
      durationSec: 800,
      answers: correctAnswers(paper.questions.map((q) => q.id)) as never,
    });

    const other = createProfile(db, {
      name: 'Мария',
      avatar: '🌿',
      skillLevel: 'owner',
      unitSystem: 'metric',
    }).id;

    expect(() => certificate(db, other, result.id)).toThrow(/сданный экзамен/);
  });
});
