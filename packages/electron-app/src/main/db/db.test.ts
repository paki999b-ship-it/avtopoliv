import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './connection.js';
import { SCHEMA_VERSION } from './schema.js';
import {
  addXp,
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  touchProfile,
  updateProfile,
} from './repos/profiles.js';
import { progressSummary, sectionProgress } from './repos/progress.js';

/**
 * Тесты слоя данных на базе в памяти. Электрон здесь не нужен: `node:sqlite`
 * встроен в рантайм, а репозитории от него не зависят.
 */

let db: DatabaseSync;

function freshDb(): DatabaseSync {
  const instance = new DatabaseSync(':memory:');
  instance.exec('PRAGMA foreign_keys = ON');
  migrate(instance);
  return instance;
}

beforeEach(() => {
  db = freshDb();
});

describe('Миграции схемы (§7)', () => {
  it('доводят пустую базу до текущей версии', () => {
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(row.user_version).toBe(SCHEMA_VERSION);
  });

  it('повторный прогон ничего не ломает и не дублирует таблицы', () => {
    expect(() => migrate(db)).not.toThrow();
    expect(migrate(db)).toBe(SCHEMA_VERSION);
  });

  it('снимают таблицы, заменённые миграцией V2', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);

    // V1 создавал плоские valves и filtration; их форма не описывала ни кривую
    // потерь клапана, ни четыре разных вида данных о фильтрации.
    expect(names).not.toContain('valves');
    expect(names).not.toContain('filtration');
  });

  it('создают все таблицы модели данных §7', () => {
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);

    for (const table of [
      'profiles',
      'lessons',
      'lesson_progress',
      'questions',
      'quiz_attempts',
      'quiz_answers',
      'calculators',
      'calc_history',
      'equipment_nozzles',
      'pipes',
      'soils',
      'kc_values',
      'cable_table',
      'glossary',
      'layout_tasks',
      'layout_attempts',
      'error_scenarios',
      'diagnostics_nodes',
      'safety_topics',
      'standards_refs',
      'exam_results',
      // Появились миграцией V2 вместо плоских valves и filtration.
      'valve_models',
      'valve_losses',
      'valve_solenoids',
      'filtration_mesh',
      'filtration_requirements',
      'filtration_types',
      'filtration_sources',
      'search_index',
    ]) {
      expect(names, `нет таблицы ${table}`).toContain(table);
    }
  });
});

describe('Ограничения справочных таблиц', () => {
  it('не дают записать строку справочника без источника (§0 п.6, §7)', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO soils (key, title, infiltration_min, infiltration_max, awc_min, awc_max, source) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('sand', 'Песок', 30, 50, 55, 100, '   '),
    ).toThrow();
  });

  it('не дают записать перевёрнутый диапазон почвы', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO soils (key, title, infiltration_min, infiltration_max, awc_min, awc_max, source) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('clay', 'Глина', 50, 30, 133, 208, 'FAO Table 7'),
    ).toThrow();
  });

  it('не дают записать расчётный вопрос без допуска (§3.7)', () => {
    const insert = db.prepare(
      'INSERT INTO questions (key, category, type, prompt, correct_json, explanation, tolerance_percent) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    expect(() =>
      insert.run('q1', 'hydraulics', 'numeric', 'Сколько?', '3.9', 'Потому что', null),
    ).toThrow();
    expect(() =>
      insert.run('q2', 'hydraulics', 'numeric', 'Сколько?', '3.9', 'Потому что', 5),
    ).not.toThrow();
  });

  it('не дают записать вопрос без пояснения (§3.7)', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO questions (key, category, type, prompt, correct_json, explanation) ' +
            'VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('q3', 'basics', 'single', 'Что такое PR?', '["a"]', ''),
    ).toThrow();
  });
});

describe('Профили (§3.10)', () => {
  const draft = {
    name: 'Алексей',
    avatar: '💧',
    skillLevel: 'installer' as const,
    unitSystem: 'metric' as const,
  };

  it('создаются и читаются обратно целиком', () => {
    const created = createProfile(db, draft);
    expect(created.name).toBe('Алексей');
    expect(created.skillLevel).toBe('installer');
    expect(created.xp).toBe(0);
    expect(created.streakDays).toBe(0);
    expect(getProfile(db, created.id)).toEqual(created);
  });

  it('обрезают пробелы и не принимают пустое имя', () => {
    expect(createProfile(db, { ...draft, name: '  Пётр  ' }).name).toBe('Пётр');
    expect(() => createProfile(db, { ...draft, name: '   ' })).toThrow(/пустым/);
  });

  it('обновляются частично, не затирая остальные поля', () => {
    const created = createProfile(db, draft);
    const updated = updateProfile(db, created.id, { unitSystem: 'imperial' });
    expect(updated.unitSystem).toBe('imperial');
    expect(updated.name).toBe('Алексей');
    expect(updated.skillLevel).toBe('installer');
  });

  it('удаляются вместе со всем прогрессом', () => {
    const profile = createProfile(db, draft);
    db.prepare(
      'INSERT INTO calc_history (profile_id, calculator_key, inputs_json, outputs_json) VALUES (?, ?, ?, ?)',
    ).run(profile.id, 'friction-loss', '{}', '{}');

    expect(deleteProfile(db, profile.id)).toEqual({ deleted: true });
    const left = db.prepare('SELECT COUNT(*) AS n FROM calc_history').get() as { n: number };
    expect(Number(left.n)).toBe(0);
  });

  it('удаление несуществующего профиля не считается успешным', () => {
    expect(deleteProfile(db, 999)).toEqual({ deleted: false });
  });

  it('прогресс двух профилей независим (§3.10)', () => {
    const first = createProfile(db, draft);
    const second = createProfile(db, { ...draft, name: 'Мария' });

    addXp(db, first.id, 120);
    expect(getProfile(db, first.id)?.xp).toBe(120);
    expect(getProfile(db, second.id)?.xp).toBe(0);
  });

  it('в списке первым идёт профиль с самым свежим заходом', () => {
    const first = createProfile(db, draft);
    const second = createProfile(db, { ...draft, name: 'Мария' });

    touchProfile(db, first.id, '2026-08-20');
    touchProfile(db, second.id, '2026-08-29');

    expect(listProfiles(db).map((p) => p.id)).toEqual([second.id, first.id]);
  });
});

describe('Стрик при заходе в приложение', () => {
  const draft = {
    name: 'Алексей',
    avatar: '💧',
    skillLevel: 'owner' as const,
    unitSystem: 'metric' as const,
  };

  it('накапливается по последовательным дням и обнуляется после пропуска', () => {
    const profile = createProfile(db, draft);

    expect(touchProfile(db, profile.id, '2026-08-27').streakDays).toBe(1);
    expect(touchProfile(db, profile.id, '2026-08-28').streakDays).toBe(2);
    // Повторный заход в тот же день не должен добавлять день.
    expect(touchProfile(db, profile.id, '2026-08-28').streakDays).toBe(2);
    expect(touchProfile(db, profile.id, '2026-08-31').streakDays).toBe(1);
  });
});

describe('Сводка прогресса (§3.10)', () => {
  const draft = {
    name: 'Алексей',
    avatar: '💧',
    skillLevel: 'designer' as const,
    unitSystem: 'metric' as const,
  };

  it('на пустом контенте даёт нули, а не деление на ноль', () => {
    const profile = createProfile(db, draft);
    const summary = progressSummary(db, profile.id);

    // Шесть разделов §3.10 плюс тренажёр сборки узла насоса.
    expect(summary.sections).toHaveLength(7);
    for (const section of summary.sections) {
      expect(section.total).toBe(0);
      expect(section.done).toBe(0);
    }
    expect(summary.level).toBe(1);
  });

  it('считает пройденные уроки и освоенные калькуляторы', () => {
    const profile = createProfile(db, draft);

    db.prepare(
      "INSERT INTO lessons (key, level, order_index, title, body_md) VALUES ('l1', 'basics', 1, 'Урок 1', '…')",
    ).run();
    db.prepare(
      "INSERT INTO lessons (key, level, order_index, title, body_md) VALUES ('l2', 'basics', 2, 'Урок 2', '…')",
    ).run();
    db.prepare(
      "INSERT INTO lesson_progress (profile_id, lesson_id, status) VALUES (?, 1, 'completed')",
    ).run(profile.id);

    db.prepare(
      "INSERT INTO calculators (key, section, title) VALUES ('friction-loss', 'hydraulics', 'Потери')",
    ).run();
    db.prepare(
      "INSERT INTO calculators (key, section, title) VALUES ('velocity', 'hydraulics', 'Скорость')",
    ).run();
    // Один и тот же калькулятор дважды — это по-прежнему один освоенный.
    for (let i = 0; i < 2; i += 1) {
      db.prepare(
        'INSERT INTO calc_history (profile_id, calculator_key, inputs_json, outputs_json) VALUES (?, ?, ?, ?)',
      ).run(profile.id, 'friction-loss', '{}', '{}');
    }

    const sections = sectionProgress(db, profile.id);
    expect(sections.find((s) => s.key === 'academy')).toEqual({
      key: 'academy',
      done: 1,
      total: 2,
    });
    expect(sections.find((s) => s.key === 'calculators')).toEqual({
      key: 'calculators',
      done: 1,
      total: 2,
    });
  });

  it('не засчитывает попытку тренажёра со слабым результатом', () => {
    const profile = createProfile(db, draft);
    db.prepare(
      "INSERT INTO layout_tasks (key, title, brief, plan_json, reference_solution_json) " +
        "VALUES ('t1', 'Задание', 'Описание', '{}', '{}')",
    ).run();
    db.prepare(
      'INSERT INTO layout_attempts (profile_id, task_id, solution_json, score) VALUES (?, 1, ?, ?)',
    ).run(profile.id, '{}', 0.5);

    expect(sectionProgress(db, profile.id).find((s) => s.key === 'layout')).toEqual({
      key: 'layout',
      done: 0,
      total: 1,
    });

    db.prepare(
      'INSERT INTO layout_attempts (profile_id, task_id, solution_json, score) VALUES (?, 1, ?, ?)',
    ).run(profile.id, '{}', 0.9);

    expect(sectionProgress(db, profile.id).find((s) => s.key === 'layout')).toEqual({
      key: 'layout',
      done: 1,
      total: 1,
    });
  });

  it('уровень и остаток XP согласованы с накопленным опытом', () => {
    const profile = createProfile(db, draft);
    addXp(db, profile.id, 260);

    const summary = progressSummary(db, profile.id);
    expect(summary.xp).toBe(260);
    expect(summary.level).toBe(3);
    expect(summary.xpIntoLevel).toBe(10);
    expect(summary.xpForNextLevel).toBe(200);
  });

  it('на несуществующий профиль отвечает ошибкой, а не пустой сводкой', () => {
    expect(() => progressSummary(db, 42)).toThrow(/не найден/);
  });
});
