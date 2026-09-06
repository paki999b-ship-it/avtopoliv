import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase, getMeta, type Db } from '@main/db/connection.js';
import { seedReferenceData } from '@main/db/seed.js';
import { createProfile, listProfiles } from '@main/db/repos/profiles.js';
import { progressSummary } from '@main/db/repos/progress.js';
import { academyLevels, levelLessons, lessonDetail } from '@main/db/repos/academy.js';
import { queryReference, referenceSections } from '@main/db/repos/reference.js';
import { globalSearch } from '@main/db/repos/search.js';
import { buildExamPaper } from '@main/db/repos/exam.js';
import { selectPumps } from '@main/db/repos/pumps.js';
import { saveCalculation, listCalculations } from '@main/db/repos/calc-history.js';
import { CONTENT_DIR, CONTENT_FILES } from '../src/platform/content.js';
import { currentDatabase, prepareSqlite } from '../src/platform/node-sqlite.js';

/**
 * Проверка Android-сборки на уровне базы.
 *
 * Смысл теста ровно один: под Android тот же слой работы с базой выполняется
 * не на `node:sqlite`, а на SQLite в WebAssembly (см. `src/platform/node-sqlite.ts`),
 * и подмена драйвера не должна менять ни одного результата. Это самое рисковое
 * место переноса — ошибка здесь не видна до первого запуска на устройстве,
 * поэтому наполнение прогоняется по настоящему каталогу `/content`, а не по
 * выдумке.
 */

/** В обход сборщика wasm берётся с диска: `?url` тут не даёт настоящего пути. */
const WASM = resolve(__dirname, '../../../node_modules/sql.js/dist/sql-wasm.wasm');

let db: Db;
let seeded: ReturnType<typeof seedReferenceData>;

beforeAll(async () => {
  await prepareSqlite(null, () => WASM);
  db = openDatabase('/data/irrigo-master.db');
  seeded = seedReferenceData(db, CONTENT_DIR);
});

describe('Контент, вшитый в мобильный бандл', () => {
  it('содержит все JSON-файлы каталога /content', () => {
    expect(CONTENT_FILES.size).toBeGreaterThanOrEqual(20);
    expect(CONTENT_FILES.has(`${CONTENT_DIR}/reference/hunter-nozzles.json`)).toBe(true);
  });

  it('разбирается как JSON — значит попал в бандл текстом, а не объектом', () => {
    const raw = CONTENT_FILES.get(`${CONTENT_DIR}/reference/hunter-nozzles.json`);
    expect(typeof raw).toBe('string');
    expect(() => JSON.parse(raw as string)).not.toThrow();
  });
});

describe('Наполнение базы под SQLite в WebAssembly', () => {
  it('собирает справочники при первом запуске', () => {
    expect(seeded.seeded).toBe(true);
    // Каждая таблица наполнения должна дать строки: пустая — это тихо
    // потерянный раздел, а не «просто ноль».
    for (const [table, count] of Object.entries(seeded.counts)) {
      expect(count, `таблица ${table} осталась пустой`).toBeGreaterThan(0);
    }
  });

  it('запоминает издание каталога — §10 п.2 требует его показывать', () => {
    expect(getMeta(db, 'catalog_edition')).toBeTruthy();
    expect(getMeta(db, 'content_signature')).toBeTruthy();
  });

  it('повторный запуск не пересобирает справочники', () => {
    const again = seedReferenceData(db, CONTENT_DIR);
    expect(again.seeded).toBe(false);
    expect(again.counts).toEqual(seeded.counts);
  });
});

describe('Репозитории на подменённом драйвере', () => {
  it('заводит профиль и возвращает его же — значит lastInsertRowid работает', () => {
    const created = createProfile(db, {
      name: 'Проверка',
      avatar: '🌱',
      skillLevel: 'installer',
      unitSystem: 'metric',
      theme: 'dark',
    });

    expect(created.id).toBeGreaterThan(0);
    expect(created.name).toBe('Проверка');
    expect(listProfiles(db).map((p) => p.id)).toContain(created.id);
  });

  it('считает сводку прогресса по всем разделам', () => {
    const profile = listProfiles(db)[0]!;
    const summary = progressSummary(db, profile.id);
    expect(summary.sections.length).toBeGreaterThan(0);
    for (const section of summary.sections) {
      expect(section.total).toBeGreaterThan(0);
    }
  });

  it('отдаёт уровни Академии, уроки и разобранный урок', () => {
    const profile = listProfiles(db)[0]!;
    const levels = academyLevels(db, profile.id);
    expect(levels.length).toBeGreaterThanOrEqual(6);

    const lessons = levelLessons(db, profile.id, levels[0]!.key);
    expect(lessons.length).toBeGreaterThan(0);

    const detail = lessonDetail(db, profile.id, lessons[0]!.key);
    expect(detail.blocks.length).toBeGreaterThan(0);
  });

  it('отдаёт справочники с фильтром и сортировкой', () => {
    const sections = referenceSections(db);
    expect(sections.length).toBeGreaterThan(0);

    const section = sections[0]!;
    const result = queryReference(db, { section: section.key, limit: 10 });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThanOrEqual(result.rows.length);
  });

  it('находит строки глобальным поиском', () => {
    const found = globalSearch(db, 'ротор');
    expect(found.total).toBeGreaterThan(0);
    expect(found.groups.length).toBeGreaterThan(0);
  });

  it('собирает экзаменационный билет по всем категориям', () => {
    const paper = buildExamPaper(db);
    expect(paper.questions.length).toBeGreaterThan(0);
    const numeric = paper.questions.filter((q) => q.type === 'numeric');
    // §3.9 ТЗ: расчётных вопросов не менее четверти билета.
    expect(numeric.length / paper.questions.length).toBeGreaterThanOrEqual(0.25);
  });

  it('подбирает насосы по требуемой точке', () => {
    const selection = selectPumps(db, { flowM3h: 5, headM: 40 });
    expect(selection.matches.length).toBeGreaterThan(0);
  });

  it('сохраняет расчёт в историю профиля и возвращает его списком', () => {
    const profile = listProfiles(db)[0]!;
    const entry = saveCalculation(db, profile.id, {
      calculatorKey: 'friction-loss',
      title: 'Потери на трение',
      summary: 'Проверка записи истории',
      inputs: { length: 100 },
      outputs: { loss: 3.9 },
    });

    expect(entry.id).toBeGreaterThan(0);
    expect(listCalculations(db, profile.id, 'friction-loss').map((e) => e.id)).toContain(
      entry.id,
    );
  });
});

describe('Сохранение образа базы между запусками', () => {
  it('переоткрытая из выгруженных байтов база помнит и контент, и профиль', async () => {
    const bytes = currentDatabase()!.export();
    expect(bytes.byteLength).toBeGreaterThan(0);

    const before = listProfiles(db).length;

    // Ровно то, что делает приложение при следующем запуске: читает файл с
    // устройства и открывает базу из него.
    await prepareSqlite(bytes, () => WASM);
    const reopened = openDatabase('/data/irrigo-master.db');

    expect(listProfiles(reopened).length).toBe(before);
    // Справочники уже в базе — значит второй запуск не тратит время заново.
    expect(seedReferenceData(reopened, CONTENT_DIR).seeded).toBe(false);
  });
});
