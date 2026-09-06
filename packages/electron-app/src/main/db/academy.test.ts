import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ACADEMY_PLAN, isAcademyLessonKey } from '@irrigo/core';
import { PUMP_RIG_FIGURE_KEYS } from '../../shared/pump-rig-figures.js';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { lessonPlainText } from './seed-academy.js';
import { createProfile, getProfile } from './repos/profiles.js';
import {
  academyLevels,
  lessonDetail,
  lessonQuiz,
  levelLessons,
  markLessonOpened,
  submitLessonQuiz,
} from './repos/academy.js';
import { sectionProgress } from './repos/progress.js';
import { globalSearch } from './repos/search.js';

/**
 * Академия на настоящем контенте репозитория.
 *
 * Проверяется не текст уроков, а то, что делает его пригодным к показу:
 * согласованность с программой курса, обязательные пояснения у вопросов,
 * корректная проверка ответов и однократное начисление XP.
 */

const CONTENT_DIR = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;
let profileId: number;

const draft = {
  name: 'Алексей',
  avatar: '💧',
  skillLevel: 'designer' as const,
  unitSystem: 'metric' as const,
};

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT_DIR);
  profileId = createProfile(db, draft).id;
});

/** Все уроки, написанные на данный момент. */
function allLessons(): Array<{ key: string; level: string; questions: number }> {
  return (
    db
      .prepare(
        `SELECT l.key, l.level,
                (SELECT COUNT(*) FROM questions q WHERE q.lesson_id = l.id) AS questions
         FROM lessons l ORDER BY l.level, l.order_index`,
      )
      .all() as unknown as Array<{ key: string; level: string; questions: number }>
  );
}

describe('Наполнение Академии (§12 п.6)', () => {
  it('все шесть уровней программы наполнены, ни один не пропущен', () => {
    // Частично написанный уровень хуже ненаписанного: пользователь видит
    // курс с дырами и не понимает, потерял ли он урок или его нет.
    const lessons = allLessons();

    for (const plan of ACADEMY_PLAN) {
      expect(lessons.filter((l) => l.level === plan.key), plan.key).toHaveLength(
        plan.lessons.length,
      );
    }
    expect(lessons).toHaveLength(ACADEMY_PLAN.reduce((n, l) => n + l.lessons.length, 0));
  });

  it('ключ каждого урока объявлен в программе курса', () => {
    for (const lesson of allLessons()) {
      expect(isAcademyLessonKey(lesson.key), lesson.key).toBe(true);
    }
  });

  it('порядок уроков берётся из программы, а не из файла', () => {
    for (const plan of ACADEMY_PLAN) {
      const rows = db
        .prepare('SELECT key, order_index FROM lessons WHERE level = ? ORDER BY order_index')
        .all(plan.key) as unknown as Array<{ key: string; order_index: number }>;
      if (rows.length === 0) continue;

      expect(rows.map((r) => r.key)).toEqual(plan.lessons.slice(0, rows.length));
    }
  });

  it('у каждого урока есть мини-тест', () => {
    for (const lesson of allLessons()) {
      expect(lesson.questions, lesson.key).toBeGreaterThanOrEqual(3);
    }
  });

  it('у каждого вопроса непустое пояснение (§3.7)', () => {
    const rows = db.prepare('SELECT key, explanation FROM questions').all() as unknown as Array<{
      key: string;
      explanation: string;
    }>;
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(row.explanation.trim().length, row.key).toBeGreaterThan(40);
    }
  });

  it('у каждого расчётного вопроса задан допуск', () => {
    const rows = db
      .prepare("SELECT key, tolerance_percent FROM questions WHERE type = 'numeric'")
      .all() as unknown as Array<{ key: string; tolerance_percent: number | null }>;

    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(row.tolerance_percent, row.key).not.toBeNull();
      expect(Number(row.tolerance_percent), row.key).toBeGreaterThan(0);
    }
  });

  it('ключи вопросов уникальны', () => {
    const rows = db.prepare('SELECT key FROM questions').all() as unknown as Array<{ key: string }>;
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  it('калькуляторы, на которые ссылаются уроки, существуют', () => {
    const rows = db
      .prepare('SELECT key, calculator_key FROM lessons WHERE calculator_key IS NOT NULL')
      .all() as unknown as Array<{ key: string; calculator_key: string }>;

    for (const row of rows) {
      const found = db
        .prepare('SELECT 1 AS ok FROM calculators WHERE key = ?')
        .get(row.calculator_key);
      expect(found, `${row.key} → ${row.calculator_key}`).toBeDefined();
    }
  });

  it('схемы, на которые ссылаются уроки, нарисованы', () => {
    // Ключи схем перечислены в LessonFigures.tsx; неизвестный ключ показывает
    // заглушку вместо иллюстрации, и заметить это без теста трудно.
    //
    // Схемы обвязки насосного узла (уровень 7) рисует один параметризованный
    // чертёж, и их список берётся из самого модуля: переписанный руками
    // перечень разошёлся бы с ним при первом же добавлении урока.
    const drawn = new Set([
      'system-chain',
      'static-vs-dynamic',
      'zone-sequence',
      'pump-duty-point',
      'head-to-head',
      ...PUMP_RIG_FIGURE_KEYS,
    ]);

    for (const lesson of allLessons()) {
      for (const block of lessonDetail(db, profileId, lesson.key).blocks) {
        if (block.type === 'figure') {
          expect(drawn, `${lesson.key} → ${block.figureKey}`).toContain(block.figureKey);
        }
      }
    }
  });

  it('блоки уроков разбираются и содержат текст', () => {
    for (const lesson of allLessons()) {
      const detail = lessonDetail(db, profileId, lesson.key);
      expect(detail.blocks.length, lesson.key).toBeGreaterThan(3);
      expect(detail.blocks.some((b) => b.type === 'text'), lesson.key).toBe(true);
    }
  });

  it('ссылки внутри уроков ведут в существующие разделы и калькуляторы', () => {
    const calculatorKeys = new Set(
      (db.prepare('SELECT key FROM calculators').all() as unknown as Array<{ key: string }>).map(
        (r) => r.key,
      ),
    );
    const sections = new Set([
      'nozzles',
      'pipes',
      'soils',
      'plants',
      'valves',
      'cable',
      'filtration',
      'glossary',
      'standards',
    ]);

    for (const lesson of allLessons()) {
      for (const block of lessonDetail(db, profileId, lesson.key).blocks) {
        if (block.type === 'calculator') {
          expect(calculatorKeys, `${lesson.key} → ${block.calculatorKey}`).toContain(
            block.calculatorKey,
          );
        }
        if (block.type === 'reference') {
          expect(sections, `${lesson.key} → ${block.section}`).toContain(block.section);
        }
      }
    }
  });

  it('термины, размеченные в уроках, есть в глоссарии', () => {
    const terms = new Set(
      (
        db.prepare('SELECT term_ru FROM glossary').all() as unknown as Array<{ term_ru: string }>
      ).map((r) => r.term_ru.toLowerCase()),
    );

    // Файлы перебираются каталогом, а не списком: новый уровень должен
    // попадать под проверку сам, без правки теста.
    const used = new Set<string>();
    for (const file of readdirSync(`${CONTENT_DIR}/academy`).filter((f) => f.endsWith('.json'))) {
      const raw = readFileSync(`${CONTENT_DIR}/academy/${file}`, 'utf8');
      for (const match of raw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
        used.add(match[1]!.toLowerCase());
      }
    }

    expect(used.size).toBeGreaterThan(5);
    for (const term of used) {
      expect(terms, `термин «${term}» размечен в уроке, но его нет в глоссарии`).toContain(term);
    }
  });

  it('уроки попадают в глобальный поиск', () => {
    const result = globalSearch(db, 'cycle');
    expect(result.total).toBeGreaterThan(0);
  });
});

describe('Плоский текст урока для поиска', () => {
  it('убирает разметку и ссылки на термины', () => {
    const text = lessonPlainText([
      { type: 'text', text: 'Норма **брутто** и `PR` — это [[Интенсивность дождя]].' },
      { type: 'list', items: ['Первый', 'Второй'] },
      { type: 'formula', formula: 'a = b', result: '2' },
    ]);

    expect(text).toContain('Норма брутто');
    expect(text).toContain('Интенсивность дождя');
    expect(text).not.toContain('**');
    expect(text).not.toContain('[[');
    expect(text).toContain('Первый Второй');
  });

  it('разворачивает подпись ссылки, а не ключ термина', () => {
    const text = lessonPlainText([
      { type: 'text', text: 'См. [[Коэффициент Хазена–Вильямса|коэффициент C]].' },
    ]);
    expect(text).toContain('коэффициент C');
    expect(text).not.toContain('|');
  });
});

describe('Уровни и прогресс', () => {
  it('все уровни курса отдаются сразу, без блокировки по прохождению', () => {
    const levels = academyLevels(db, profileId);
    expect(levels).toHaveLength(ACADEMY_PLAN.length);
    expect(levels.map((l) => l.order)).toEqual(ACADEMY_PLAN.map((l) => l.order));
    // Признака «заперт» в данных нет вовсе: порядок изучения — рекомендация.
    for (const level of levels) {
      expect(level, level.key).not.toHaveProperty('unlocked');
    }
  });

  it('курс наполнен целиком: у каждого уровня есть уроки и XP', () => {
    for (const level of academyLevels(db, profileId)) {
      const plan = ACADEMY_PLAN.find((l) => l.key === level.key)!;
      expect(level.lessons, level.key).toBe(plan.lessons.length);
      expect(level.xpAvailable, level.key).toBeGreaterThan(0);
      expect(level.completed, level.key).toBe(0);
    }
  });

  it('открытие урока отмечает его начатым, но XP не даёт', () => {
    const key = ACADEMY_PLAN[0]!.lessons[0]!;
    markLessonOpened(db, profileId, key);

    expect(lessonDetail(db, profileId, key).status).toBe('in_progress');
    expect(getProfile(db, profileId)?.xp).toBe(0);
  });

  it('прогресс раздела «Академия» считает пройденные уроки', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'academy')!;
    expect(before.done).toBe(0);
    expect(before.total).toBeGreaterThan(0);
  });

  it('соседние уроки связаны в обе стороны', () => {
    const plan = ACADEMY_PLAN[0]!;
    const first = lessonDetail(db, profileId, plan.lessons[0]!);
    const second = lessonDetail(db, profileId, plan.lessons[1]!);

    expect(first.previousKey).toBeNull();
    expect(first.nextKey).toBe(plan.lessons[1]);
    expect(second.previousKey).toBe(plan.lessons[0]);
  });

  it('на несуществующий урок отвечает ошибкой', () => {
    expect(() => lessonDetail(db, profileId, 'nope')).toThrow(/не найден/);
  });
});

describe('Мини-тест урока', () => {
  const lessonKey = 'basics-water-units';

  /** Ответы, которые движок должен признать верными. */
  function correctAnswers(): Array<{ questionId: number; answer: number | number[] | string }> {
    const rows = db
      .prepare(
        `SELECT q.id, q.type, q.correct_json FROM questions q
         JOIN lessons l ON l.id = q.lesson_id WHERE l.key = ? ORDER BY q.order_index`,
      )
      .all(lessonKey) as unknown as Array<{ id: number; type: string; correct_json: string }>;

    return rows.map((row) => ({
      questionId: row.id,
      answer: JSON.parse(row.correct_json) as number | number[],
    }));
  }

  it('вопросы приходят без правильных ответов', () => {
    const questions = lessonQuiz(db, lessonKey);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(Object.keys(question)).not.toContain('correct');
      expect(JSON.stringify(question)).not.toContain('correct');
    }
  });

  it('полностью верный тест засчитывает урок и начисляет XP', () => {
    const result = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: correctAnswers(),
    });

    expect(result.correctCount).toBe(result.total);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.xpAwarded).toBeGreaterThan(0);
    expect(result.profileXp).toBe(result.xpAwarded);
    expect(lessonDetail(db, profileId, lessonKey).status).toBe('completed');
  });

  it('XP за урок начисляется только один раз', () => {
    const answers = correctAnswers();
    const first = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers,
    });
    const second = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers,
    });

    expect(first.xpAwarded).toBeGreaterThan(0);
    expect(second.xpAwarded).toBe(0);
    expect(second.passed).toBe(true);
    expect(getProfile(db, profileId)?.xp).toBe(first.xpAwarded);
  });

  it('пустые ответы не засчитываются и урок не закрывают', () => {
    const questions = lessonQuiz(db, lessonKey);
    const result = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: questions.map((q) => ({ questionId: q.id, answer: null })),
    });

    expect(result.correctCount).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.xpAwarded).toBe(0);
    expect(lessonDetail(db, profileId, lessonKey).status).toBe('in_progress');
  });

  it('расчётный ответ проверяется с допуском, а не строкой', () => {
    const numeric = db
      .prepare(
        `SELECT q.id, q.correct_json, q.tolerance_percent FROM questions q
         JOIN lessons l ON l.id = q.lesson_id
         WHERE l.key = ? AND q.type = 'numeric' LIMIT 1`,
      )
      .get(lessonKey) as { id: number; correct_json: string; tolerance_percent: number };

    const expected = Number(JSON.parse(numeric.correct_json));
    const within = expected * (1 + numeric.tolerance_percent / 200);
    const outside = expected * (1 + numeric.tolerance_percent / 100 + 0.05);

    const near = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: [{ questionId: numeric.id, answer: within }],
    });
    expect(near.answers.find((a) => a.questionId === numeric.id)?.correct).toBe(true);

    const far = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: [{ questionId: numeric.id, answer: outside }],
    });
    expect(far.answers.find((a) => a.questionId === numeric.id)?.correct).toBe(false);
  });

  it('разбор содержит пояснение и правильный ответ у каждого вопроса', () => {
    const questions = lessonQuiz(db, lessonKey);
    const result = submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: questions.map((q) => ({ questionId: q.id, answer: null })),
    });

    for (const answer of result.answers) {
      expect(answer.explanation.trim().length).toBeGreaterThan(20);
      expect(answer.correctAnswer.trim().length).toBeGreaterThan(0);
    }
  });

  it('попытка и ответы сохраняются в базу', () => {
    submitLessonQuiz(db, profileId, {
      lessonKey,
      startedAt: new Date().toISOString(),
      answers: correctAnswers(),
    });

    const attempts = db
      .prepare("SELECT COUNT(*) AS n FROM quiz_attempts WHERE kind = 'lesson_quiz'")
      .get() as { n: number };
    const answers = db.prepare('SELECT COUNT(*) AS n FROM quiz_answers').get() as { n: number };

    expect(Number(attempts.n)).toBe(1);
    expect(Number(answers.n)).toBe(lessonQuiz(db, lessonKey).length);
  });

  it('на урок без вопросов отвечает ошибкой, а не пустым результатом', () => {
    db.prepare("DELETE FROM questions WHERE lesson_id = (SELECT id FROM lessons WHERE key = ?)").run(
      lessonKey,
    );
    expect(() =>
      submitLessonQuiz(db, profileId, {
        lessonKey,
        startedAt: new Date().toISOString(),
        answers: [],
      }),
    ).toThrow(/нет вопросов/);
  });

  it('прохождение всех уроков уровня отражается в прогрессе', () => {
    const plan = ACADEMY_PLAN[0]!;
    for (const key of plan.lessons) {
      const rows = db
        .prepare(
          `SELECT q.id, q.correct_json FROM questions q
           JOIN lessons l ON l.id = q.lesson_id WHERE l.key = ?`,
        )
        .all(key) as unknown as Array<{ id: number; correct_json: string }>;

      submitLessonQuiz(db, profileId, {
        lessonKey: key,
        startedAt: new Date().toISOString(),
        answers: rows.map((r) => ({
          questionId: r.id,
          answer: JSON.parse(r.correct_json) as number | number[],
        })),
      });
    }

    const levels = academyLevels(db, profileId);
    expect(levels[0]!.completed).toBe(levels[0]!.lessons);
    expect(levels[0]!.xpEarned).toBe(levels[0]!.xpAvailable);

    const progress = sectionProgress(db, profileId).find((s) => s.key === 'academy')!;
    expect(progress.done).toBe(plan.lessons.length);
  });

  it('уроки уровня отдаются в порядке программы', () => {
    const plan = ACADEMY_PLAN[0]!;
    const lessons = levelLessons(db, profileId, 'basics');
    expect(lessons.map((l) => l.key)).toEqual([...plan.lessons]);
  });
});
