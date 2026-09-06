import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile, getProfile } from './repos/profiles.js';
import {
  ASSEMBLY_PASS_SCORE,
  assemblyTaskDetail,
  assemblyTasks,
  submitAssembly,
} from './repos/assembly.js';
import { sectionProgress } from './repos/progress.js';
import type { AssemblyTaskDetail } from '../../shared/assembly.js';

/**
 * Тренажёр «Сборка узла насоса».
 *
 * Главное, что здесь проверяется, — эталон не утекает в интерфейс до отправки
 * ответа. Всё остальное следует из этого: и разбор, и оценка приходят вместе
 * с результатом проверки, а не лежат в задании.
 */

const CONTENT = resolve(__dirname, '../../../../../content');

let db: DatabaseSync;
let profileId: number;

/** Эталон достаётся из базы напрямую: наружу репозиторий его не отдаёт. */
function correctPlacement(taskKey: string): Record<string, string> {
  const row = db.prepare('SELECT slots_json FROM assembly_tasks WHERE key = ?').get(taskKey) as {
    slots_json: string;
  };
  const slots = (JSON.parse(row.slots_json) as { slots: Array<{ key: string; correct: string }> })
    .slots;
  return Object.fromEntries(slots.map((s) => [s.key, s.correct]));
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  seedReferenceData(db, CONTENT);
  profileId = createProfile(db, {
    name: 'Тест',
    avatar: '💧',
    skillLevel: 'installer',
    unitSystem: 'metric',
  }).id;
});

describe('Наполнение тренажёра', () => {
  it('задания загружены', () => {
    const tasks = assemblyTasks(db, profileId);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.every((t) => t.slotCount >= 3)).toBe(true);
  });

  it('у каждой позиции есть подпись и сторона обвязки', () => {
    for (const task of assemblyTasks(db, profileId)) {
      const detail = assemblyTaskDetail(db, profileId, task.key);
      for (const slot of detail.slots) {
        expect(slot.title.trim().length, `${task.key}/${slot.key}`).toBeGreaterThan(0);
        expect(['suction', 'discharge']).toContain(slot.line);
      }
    }
  });

  it('эталон не приходит в интерфейс до проверки', () => {
    for (const task of assemblyTasks(db, profileId)) {
      const detail = assemblyTaskDetail(db, profileId, task.key);
      const asRecord = JSON.parse(JSON.stringify(detail)) as Record<string, unknown>;
      const text = JSON.stringify(asRecord);
      // Ни поля `correct`, ни разбора `why`, ни пояснения о неверной установке.
      expect(text).not.toContain('"correct"');
      expect(text).not.toContain('"why"');
      expect(text).not.toContain('"misplaced"');
      for (const part of detail.parts) {
        expect(Object.keys(part).sort()).toEqual(['hint', 'key', 'label']);
      }
    }
  });

  it('в палитре есть лишние элементы: задание не решается перебором', () => {
    // Один и тот же элемент законно стоит в нескольких позициях (кран), поэтому
    // сравнивать палитру с числом позиций нельзя. Проверяется другое: в палитре
    // должен быть элемент, которого в эталоне нет вовсе.
    for (const task of assemblyTasks(db, profileId)) {
      const detail = assemblyTaskDetail(db, profileId, task.key);
      const needed = new Set(Object.values(correctPlacement(task.key)));
      const decoys = detail.parts.filter((p) => !needed.has(p.key));
      expect(decoys.length, task.key).toBeGreaterThan(0);
    }
  });

  it('на несуществующее задание отвечает ошибкой', () => {
    expect(() => assemblyTaskDetail(db, profileId, 'нет-такого')).toThrow(/не найдено/);
  });
});

describe('Проверка расстановки', () => {
  let task: AssemblyTaskDetail;

  beforeEach(() => {
    task = assemblyTaskDetail(db, profileId, assemblyTasks(db, profileId)[0]!.key);
  });

  it('верная расстановка даёт единицу и начисляет XP', () => {
    const before = getProfile(db, profileId)!.xp;
    const result = submitAssembly(db, profileId, {
      taskKey: task.key,
      placement: correctPlacement(task.key),
    });

    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
    expect(result.correctCount).toBe(result.total);
    expect(result.xpAwarded).toBeGreaterThan(0);
    expect(result.profileXp).toBe(before + result.xpAwarded);
  });

  it('XP за задание начисляется один раз', () => {
    const placement = correctPlacement(task.key);
    submitAssembly(db, profileId, { taskKey: task.key, placement });
    const second = submitAssembly(db, profileId, { taskKey: task.key, placement });
    expect(second.xpAwarded).toBe(0);
  });

  it('разбор объясняет каждую позицию, а неверную — ещё и тем, что поставили', () => {
    const placement = correctPlacement(task.key);
    const slots = Object.keys(placement);
    // Меняем местами два элемента: обе позиции должны стать неверными.
    const [a, b] = [slots[0]!, slots[1]!];
    const swapped = { ...placement, [a]: placement[b]!, [b]: placement[a]! };

    const result = submitAssembly(db, profileId, { taskKey: task.key, placement: swapped });

    expect(result.correctCount).toBe(result.total - 2);
    for (const item of result.review) {
      expect(item.why.trim().length, item.slotKey).toBeGreaterThan(0);
      expect(item.correctLabel.trim().length, item.slotKey).toBeGreaterThan(0);
      if (!item.isCorrect && item.placed) {
        expect(item.misplacedNote, item.slotKey).toBeTruthy();
      }
    }
  });

  it('пустые позиции считаются отдельно от неверных', () => {
    const placement = correctPlacement(task.key);
    const first = Object.keys(placement)[0]!;
    const withHole: Record<string, string | null> = { ...placement, [first]: null };

    const result = submitAssembly(db, profileId, { taskKey: task.key, placement: withHole });
    expect(result.emptyCount).toBe(1);
    expect(result.review.find((r) => r.slotKey === first)!.placed).toBeNull();
  });

  it('пустая расстановка не сдаётся и XP не даёт', () => {
    const result = submitAssembly(db, profileId, { taskKey: task.key, placement: {} });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.xpAwarded).toBe(0);
  });

  it('попытка сохраняется в базу', () => {
    submitAssembly(db, profileId, {
      taskKey: task.key,
      placement: correctPlacement(task.key),
    });
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM assembly_attempts WHERE profile_id = ?')
      .get(profileId) as { n: number };
    expect(Number(row.n)).toBe(1);
  });

  it('прогресс раздела считает собранные узлы', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'assembly')!;
    expect(before.done).toBe(0);
    expect(before.total).toBeGreaterThanOrEqual(3);

    submitAssembly(db, profileId, {
      taskKey: task.key,
      placement: correctPlacement(task.key),
    });

    const after = sectionProgress(db, profileId).find((s) => s.key === 'assembly')!;
    expect(after.done).toBe(1);
  });

  it('проходной балл раздела совпадает с тем, по которому считается прогресс', () => {
    // Прогресс считается запросом со «score >= 0.75» — константа не должна
    // разъехаться с ним незамеченной.
    expect(ASSEMBLY_PASS_SCORE).toBe(0.75);
  });
});
