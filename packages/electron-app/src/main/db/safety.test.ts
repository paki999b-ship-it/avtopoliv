import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CALCULATORS } from '@irrigo/core';
import { migrate } from './connection.js';
import { seedReferenceData } from './seed.js';
import { createProfile } from './repos/profiles.js';
import { markSafetyTopicRead, safetyTopic, safetyTopics } from './repos/safety.js';
import { sectionProgress } from './repos/progress.js';
import { SAFETY_CATEGORIES } from '../../shared/safety.js';

/**
 * Раздел «Безопасность и границы» на настоящем контенте.
 *
 * §3.8 перечисляет восемь тем поимённо и требует конкретных формулировок:
 * про квалифицированного электрика, про местные правила по обратному потоку,
 * про запрет отбора выше дебита. Это проверяется, а не подразумевается.
 *
 * В шаблонах вместо `\w` стоит явный класс `[а-яё]`: `\w` в JavaScript —
 * это латиница с цифрами, кириллицу он не покрывает, и такой шаблон молча
 * не совпал бы.
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
    skillLevel: 'owner' as const,
    unitSystem: 'metric' as const,
  };
  profileId = createProfile(db, draft).id;
  otherProfileId = createProfile(db, { ...draft, name: 'Мария' }).id;
});

/** Весь текст темы одной строкой — для проверки обязательных формулировок. */
function plainText(key: string): string {
  const topic = safetyTopic(db, profileId, key);
  const parts: string[] = [topic.title, topic.summary];

  for (const block of topic.blocks) {
    switch (block.type) {
      case 'text':
      case 'heading':
        parts.push(block.text);
        break;
      case 'list':
        parts.push(block.items.join(' '));
        break;
      case 'callout':
        parts.push(`${block.title ?? ''} ${block.text}`);
        break;
      case 'table':
        parts.push([block.caption ?? '', ...block.columns, ...block.rows.flat()].join(' '));
        break;
      case 'calculator':
      case 'reference':
        parts.push(`${block.title} ${block.text}`);
        break;
      default:
        break;
    }
  }

  return parts.join(' ').toLowerCase();
}

describe('Состав раздела (§3.8)', () => {
  it('описаны все восемь тем', () => {
    const topics = safetyTopics(db, profileId);
    expect(topics).toHaveLength(SAFETY_CATEGORIES.length);

    const present = new Set(topics.map((t) => t.category));
    for (const category of SAFETY_CATEGORIES) expect(present.has(category), category).toBe(true);
  });

  it('темы идут в порядке §3.8', () => {
    const order = safetyTopics(db, profileId).map((t) => t.category);
    expect(order).toEqual(SAFETY_CATEGORIES);
  });

  it('у каждой темы есть краткое описание и содержимое', () => {
    for (const topic of safetyTopics(db, profileId)) {
      expect(topic.summary.length, topic.key).toBeGreaterThan(20);
      const detail = safetyTopic(db, profileId, topic.key);
      expect(detail.blocks.length, topic.key).toBeGreaterThanOrEqual(5);
    }
  });

  it('ссылки на уроки и калькуляторы ведут в существующие разделы', () => {
    const calculators = new Set<string>(CALCULATORS.map((c) => c.key));

    for (const topic of safetyTopics(db, profileId)) {
      const detail = safetyTopic(db, profileId, topic.key);
      for (const lesson of detail.lessons) {
        expect(lesson.title.length, lesson.key).toBeGreaterThan(0);
      }
      for (const block of detail.blocks) {
        if (block.type === 'calculator') {
          expect(calculators.has(block.calculatorKey), block.calculatorKey).toBe(true);
        }
      }
    }
  });

  it('на несуществующую тему отвечает ошибкой', () => {
    expect(() => safetyTopic(db, profileId, 'nope')).toThrow(/не найдена/);
  });
});

describe('Обязательные формулировки §3.8 и §10', () => {
  it('электрика: только квалифицированный электрик, УЗО 30 мА, IP и заземление', () => {
    const text = plainText('safety-electrical');
    expect(text).toMatch(/квалифицированный электрик/);
    expect(text).toMatch(/30 мА/i);
    expect(text).toMatch(/ip/);
    expect(text).toMatch(/заземл/);
    // §10 п.3: приложение считает и рисует схему, но не даёт допуска к работам.
    expect(text).toMatch(/не является допуском|не заменяет электрика/);
  });

  it('обратный поток: перечислены все пять устройств и разница между ними', () => {
    const text = plainText('safety-backflow');
    expect(text).toMatch(/воздушный зазор|разрыв струи/);
    expect(text).toMatch(/атмосферный вакуум-брейкер/);
    expect(text).toMatch(/вакуум-брейкер под давлением/);
    expect(text).toMatch(/двойной обратный клапан/);
    expect(text).toMatch(/узел пониженного давления/);
    expect(text).toMatch(/высот[а-яё]+ установки/);
    // §10 п.4: тип и высота — по местным правилам и согласованию с водоканалом.
    expect(text).toMatch(/местн[а-яё]+ правил/);
    expect(text).toMatch(/водоснабжающ[а-яё]+ организаци|водоканал/);
  });

  it('скважина: запрет отбора выше дебита и защита от сухого хода', () => {
    const text = plainText('safety-well-pump');
    expect(text).toMatch(/выше дебита/);
    expect(text).toMatch(/сухого хода/);
    expect(text).toMatch(/кавитац/);
    expect(text).toMatch(/80 %/);
  });

  it('земляные работы: коммуникации выясняются до копки', () => {
    const text = plainText('safety-excavation');
    expect(text).toMatch(/до начала земляных работ|до копки|до первой лопаты/);
    expect(text).toMatch(/кабел/);
    expect(text).toMatch(/газ/);
  });

  it('химия: обратный клапан, СИЗ и инструкция к препарату', () => {
    const text = plainText('safety-chemicals');
    expect(text).toMatch(/обратный клапан/);
    expect(text).toMatch(/перчатк|защита глаз|защиты глаз|средств[а-яё]* индивидуальной защиты/);
    expect(text).toMatch(/инструкц[а-яё]+ производителя|по инструкции/);
  });

  it('давление: опрессовка, гидроудар и безопасное весеннее заполнение', () => {
    const text = plainText('safety-pressure');
    expect(text).toMatch(/опрессовк/);
    expect(text).toMatch(/гидроудар/);
    expect(text).toMatch(/медленно/);
    expect(text).toMatch(/очк/);
  });

  it('продувка: ограничения давления и защита глаз', () => {
    const text = plainText('safety-blowout');
    expect(text).toMatch(/3,5 бар/);
    expect(text).toMatch(/5,5 бар/);
    expect(text).toMatch(/защита глаз/);
  });

  it('первая помощь: обесточить, не тереть глаз и пометка про обучение', () => {
    const text = plainText('safety-first-aid');
    expect(text).toMatch(/обесточ/);
    expect(text).toMatch(/не тереть|не трогают|не трут/);
    expect(text).toMatch(/112/);
    // §3.8: явная пометка, что это не заменяет инструктаж по охране труда.
    expect(text).toMatch(/не заменяет[\s\S]*охране труда/);
  });
});

describe('Прогресс по темам', () => {
  it('тема отмечается прочитанной', () => {
    const topic = safetyTopics(db, profileId)[0]!;
    expect(topic.read).toBe(false);

    const result = markSafetyTopicRead(db, profileId, topic.key);
    expect(result.read).toBe(1);
    expect(result.total).toBe(SAFETY_CATEGORIES.length);
    expect(safetyTopics(db, profileId)[0]!.read).toBe(true);
  });

  it('повторное открытие не удваивает прогресс', () => {
    const topic = safetyTopics(db, profileId)[0]!;
    markSafetyTopicRead(db, profileId, topic.key);
    expect(markSafetyTopicRead(db, profileId, topic.key).read).toBe(1);
  });

  it('прогресс раздела считает прочитанные темы', () => {
    const before = sectionProgress(db, profileId).find((s) => s.key === 'safety')!;
    expect(before.done).toBe(0);
    expect(before.total).toBe(SAFETY_CATEGORIES.length);

    for (const topic of safetyTopics(db, profileId)) {
      markSafetyTopicRead(db, profileId, topic.key);
    }

    const after = sectionProgress(db, profileId).find((s) => s.key === 'safety')!;
    expect(after.done).toBe(after.total);
  });

  it('прогресс одного профиля не виден другому', () => {
    markSafetyTopicRead(db, profileId, safetyTopics(db, profileId)[0]!.key);
    expect(safetyTopics(db, otherProfileId).every((t) => !t.read)).toBe(true);
  });

  it('на несуществующую тему прогресс не пишется', () => {
    expect(() => markSafetyTopicRead(db, profileId, 'nope')).toThrow(/не найдена/);
  });
});
