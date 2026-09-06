import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './connection.js';
import { createProfile } from './repos/profiles.js';
import {
  clearCalculations,
  deleteCalculation,
  listCalculations,
  saveCalculation,
} from './repos/calc-history.js';
import { sectionProgress } from './repos/progress.js';

/** История расчётов профиля — §3.2 ТЗ. */

let db: DatabaseSync;
let profileId: number;
let otherProfileId: number;

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
  profileId = createProfile(db, draft).id;
  otherProfileId = createProfile(db, { ...draft, name: 'Мария' }).id;
});

function save(key: string, title: string, inputs: Record<string, unknown> = { a: 1 }) {
  return saveCalculation(db, profileId, {
    calculatorKey: key,
    title,
    inputs,
    outputs: { result: 42 },
  });
}

describe('Сохранение расчёта', () => {
  it('возвращает запись с разобранными входом и выходом', () => {
    const entry = save('friction-loss', 'Q 13 м³/ч', { flowM3h: 13, material: 'pe_new' });

    expect(entry.calculatorKey).toBe('friction-loss');
    expect(entry.title).toBe('Q 13 м³/ч');
    expect(entry.inputs).toEqual({ flowM3h: 13, material: 'pe_new' });
    expect(entry.outputs).toEqual({ result: 42 });
    expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('переживает вложенные структуры — списки голов и зон', () => {
    const inputs = {
      zoneName: 'Зона 1',
      heads: [
        { name: 'Ротор', flowLph: 640, count: 4 },
        { name: 'Спрей', flowLph: 220, count: 2 },
      ],
    };
    const entry = save('zone-check', 'Зона 1', inputs);
    expect(entry.inputs).toEqual(inputs);
  });

  it('не принимает пустой ключ калькулятора', () => {
    expect(() =>
      saveCalculation(db, profileId, {
        calculatorKey: '   ',
        title: 'x',
        inputs: {},
        outputs: {},
      }),
    ).toThrow(/калькулятор/i);
  });

  it('обрезает слишком длинную подпись, а не падает', () => {
    const entry = save('units', 'x'.repeat(500));
    expect(entry.title.length).toBe(200);
  });
});

describe('Чтение истории', () => {
  it('отдаёт записи от новых к старым', () => {
    save('friction-loss', 'первый');
    save('friction-loss', 'второй');
    save('friction-loss', 'третий');

    expect(listCalculations(db, profileId, 'friction-loss').map((e) => e.title)).toEqual([
      'третий',
      'второй',
      'первый',
    ]);
  });

  it('фильтрует по калькулятору', () => {
    save('friction-loss', 'трение');
    save('velocity', 'скорость');

    expect(listCalculations(db, profileId, 'velocity')).toHaveLength(1);
    expect(listCalculations(db, profileId)).toHaveLength(2);
  });

  it('не смешивает истории разных профилей', () => {
    save('friction-loss', 'мой расчёт');
    saveCalculation(db, otherProfileId, {
      calculatorKey: 'friction-loss',
      title: 'чужой расчёт',
      inputs: {},
      outputs: {},
    });

    expect(listCalculations(db, profileId).map((e) => e.title)).toEqual(['мой расчёт']);
    expect(listCalculations(db, otherProfileId).map((e) => e.title)).toEqual(['чужой расчёт']);
  });

  it('битый JSON в записи не роняет весь список', () => {
    const entry = save('units', 'нормальная');
    db.prepare('UPDATE calc_history SET inputs_json = ? WHERE id = ?').run('{не json', entry.id);

    const list = listCalculations(db, profileId, 'units');
    expect(list).toHaveLength(1);
    expect(list[0]?.inputs).toEqual({});
    expect(list[0]?.outputs).toEqual({ result: 42 });
  });
});

describe('Удаление и ограничение размера', () => {
  it('удаляет свою запись', () => {
    const entry = save('units', 'моя');
    expect(deleteCalculation(db, profileId, entry.id)).toEqual({ deleted: true });
    expect(listCalculations(db, profileId)).toHaveLength(0);
  });

  it('не даёт удалить чужую запись по её id', () => {
    const foreign = saveCalculation(db, otherProfileId, {
      calculatorKey: 'units',
      title: 'чужая',
      inputs: {},
      outputs: {},
    });

    expect(deleteCalculation(db, profileId, foreign.id)).toEqual({ deleted: false });
    expect(listCalculations(db, otherProfileId)).toHaveLength(1);
  });

  it('очищает историю одного калькулятора, не трогая остальные', () => {
    save('friction-loss', 'a');
    save('friction-loss', 'b');
    save('velocity', 'c');

    expect(clearCalculations(db, profileId, 'friction-loss')).toEqual({ removed: 2 });
    expect(listCalculations(db, profileId).map((e) => e.title)).toEqual(['c']);
  });

  it('держит не больше пятидесяти записей на калькулятор', () => {
    for (let i = 0; i < 60; i += 1) save('units', `расчёт ${i}`);

    const list = listCalculations(db, profileId, 'units');
    expect(list).toHaveLength(50);
    // Остаются последние, а не первые.
    expect(list[0]?.title).toBe('расчёт 59');
    expect(list.at(-1)?.title).toBe('расчёт 10');
  });

  it('ограничение считает калькуляторы по отдельности', () => {
    for (let i = 0; i < 55; i += 1) save('units', `u${i}`);
    save('velocity', 'v');

    expect(listCalculations(db, profileId, 'units')).toHaveLength(50);
    expect(listCalculations(db, profileId, 'velocity')).toHaveLength(1);
  });
});

describe('Связь с прогрессом раздела (§3.10)', () => {
  it('освоенным считается калькулятор, а не число расчётов', () => {
    db.prepare(
      "INSERT INTO calculators (key, section, title) VALUES ('friction-loss', 'hydraulics', 'Потери')",
    ).run();
    db.prepare(
      "INSERT INTO calculators (key, section, title) VALUES ('velocity', 'hydraulics', 'Скорость')",
    ).run();

    save('friction-loss', 'раз');
    save('friction-loss', 'два');
    save('friction-loss', 'три');

    expect(sectionProgress(db, profileId).find((s) => s.key === 'calculators')).toEqual({
      key: 'calculators',
      done: 1,
      total: 2,
    });

    save('velocity', 'четыре');

    expect(sectionProgress(db, profileId).find((s) => s.key === 'calculators')).toEqual({
      key: 'calculators',
      done: 2,
      total: 2,
    });
  });
});
