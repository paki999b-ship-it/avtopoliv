import { readFileSync, existsSync } from 'node:fs';
import type { Db } from './connection.js';

/**
 * Наполнение тренажёра «Сборка узла насоса» из `/content/assembly` (§12).
 *
 * Проверки при сборке жёсткие по той же причине, что и в остальных разделах:
 * задание, где эталон ссылается на несуществующий элемент палитры или где
 * элемент нельзя выбрать вовсе, выглядит в базе рабочим, а решается неверно
 * при любом ответе. Лучше не собраться при сборке.
 */

interface RawPart {
  key: string;
  label: string;
  hint: string;
  /** Что не так, если этот элемент поставили не на своё место. */
  misplaced: string;
}

interface RawSlot {
  key: string;
  line: 'suction' | 'discharge';
  order: number;
  title: string;
  correct: string;
  why: string;
}

interface RawTask {
  key: string;
  title: string;
  brief: string;
  difficulty: number;
  orderIndex: number;
  source: string;
  /** Ключи элементов, доступных в этом задании. */
  palette: string[];
  slots: RawSlot[];
}

interface AssemblyFile {
  note: string;
  collectedAt: string;
  parts: RawPart[];
  tasks: RawTask[];
}

export const ASSEMBLY_TABLES = ['assembly_tasks'] as const;

function assemblyFile(contentDirPath: string): string | null {
  const file = `${contentDirPath}/assembly/tasks.json`;
  return existsSync(file) ? file : null;
}

export function assemblySignature(contentDirPath: string): string {
  const file = assemblyFile(contentDirPath);
  if (!file) return 'empty';
  const data = JSON.parse(readFileSync(file, 'utf8')) as AssemblyFile;
  const slots = data.tasks.reduce((sum, t) => sum + t.slots.length, 0);
  return `${data.collectedAt}:${data.tasks.length}:${slots}:${data.parts.length}`;
}

export function seedAssemblyTasks(db: Db, contentDirPath: string): number {
  const file = assemblyFile(contentDirPath);
  if (!file) return 0;

  const data = JSON.parse(readFileSync(file, 'utf8')) as AssemblyFile;

  const parts = new Map<string, RawPart>();
  for (const part of data.parts) {
    if (parts.has(part.key)) throw new Error(`Элемент «${part.key}» описан дважды`);
    if (!part.label?.trim()) throw new Error(`Элемент «${part.key}» без подписи`);
    if (!part.misplaced?.trim()) {
      throw new Error(`Элемент «${part.key}»: без разбора неверной установки задание не учит`);
    }
    parts.set(part.key, part);
  }

  const insert = db.prepare(`
    INSERT INTO assembly_tasks
      (key, title, brief, difficulty, parts_json, slots_json, order_index, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seen = new Set<string>();
  let count = 0;

  for (const task of data.tasks) {
    if (seen.has(task.key)) throw new Error(`Задание «${task.key}» уже встречалось`);
    seen.add(task.key);

    if (task.slots.length < 3) {
      throw new Error(`${task.key}: в задании меньше трёх позиций — собирать нечего`);
    }

    const palette = task.palette.map((key) => {
      const part = parts.get(key);
      if (!part) throw new Error(`${task.key}: в палитре нет элемента «${key}»`);
      return part;
    });
    const paletteKeys = new Set(palette.map((p) => p.key));

    const slotKeys = new Set<string>();
    for (const slot of task.slots) {
      if (slotKeys.has(slot.key)) {
        throw new Error(`${task.key}: позиция «${slot.key}» повторяется`);
      }
      slotKeys.add(slot.key);

      if (!paletteKeys.has(slot.correct)) {
        throw new Error(
          `${task.key}/${slot.key}: эталонный элемент «${slot.correct}» отсутствует в палитре — ` +
            'задание нерешаемо',
        );
      }
      if (!slot.why?.trim()) {
        throw new Error(`${task.key}/${slot.key}: позиция без разбора ничему не учит`);
      }
    }

    /*
     * Палитра должна быть шире эталона: если элементов ровно столько, сколько
     * позиций, задание решается методом исключения, а не пониманием.
     */
    const needed = new Set(task.slots.map((s) => s.correct));
    if (palette.length <= needed.size) {
      throw new Error(
        `${task.key}: в палитре ${palette.length} элементов на ${needed.size} нужных — ` +
          'лишних вариантов нет, и задание решается перебором',
      );
    }

    insert.run(
      task.key,
      task.title,
      task.brief,
      task.difficulty,
      JSON.stringify({ parts: palette }),
      JSON.stringify({ slots: task.slots }),
      task.orderIndex,
      task.source,
    );
    count += 1;
  }

  return count;
}
