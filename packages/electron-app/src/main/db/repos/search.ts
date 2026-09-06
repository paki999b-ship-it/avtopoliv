import type { Db } from '../connection.js';
import type { SearchGroup, SearchHit, SearchResult } from '../../../shared/reference.js';
import { REFERENCE_SECTIONS, normalize } from './reference.js';

/**
 * Глобальный поиск по приложению (§3.3 ТЗ: «доступна поиском по всему
 * приложению, Ctrl+F глобально»).
 *
 * Индекс материализуется в таблицу `search_index` при сборке справочников:
 * искать одним запросом по одной таблице проще и предсказуемее, чем девятью
 * запросами по девяти разным формам.
 *
 * Полнотекстового индекса нет намеренно. Русской морфологии в SQLite всё равно
 * нет, а полторы тысячи строк сканируются обычным LIKE за миллисекунды. Зато
 * поведение одинаково на любой машине и не зависит от того, с какими опциями
 * собран SQLite в конкретной сборке Node.
 */

/** Как строка каждой таблицы превращается в запись индекса. */
interface IndexSpec {
  section: string;
  table: string;
  /** SQL, отдающий id, title, subtitle, body. */
  sql: string;
}

const SPECS: IndexSpec[] = [
  {
    section: 'nozzles',
    table: 'rows',
    // Строки сопел объединяются по насадке: 1224 отдельные строки давления
    // в поиске были бы шумом, а не результатом.
    sql: `
      SELECT MIN(id) AS id,
             model || ' · ' || nozzle AS title,
             'сопло, ' || COUNT(*) || ' строк давления' AS subtitle,
             model || ' ' || nozzle AS body
      FROM equipment_nozzles
      WHERE emitter_class <> 'strip'
      GROUP BY model, nozzle
    `,
  },
  {
    section: 'nozzles',
    table: 'strip',
    // Полосовые ищутся по модели: строк давления у каждой всего пять, и в
    // выдаче полезнее одна карточка модели, а не пять почти одинаковых строк.
    sql: `
      SELECT MIN(id) AS id,
             model AS title,
             'полосовая форсунка, ' || pattern_title AS subtitle,
             model || ' ' || pattern_title || ' полосовая форсунка strip' AS body
      FROM equipment_nozzles
      WHERE emitter_class = 'strip'
      GROUP BY model, pattern_title
    `,
  },
  {
    section: 'equipment',
    table: 'rows',
    sql: `
      SELECT id, model AS title,
             CASE WHEN section = '' THEN 'оборудование Hunter' ELSE section END AS subtitle,
             model || ' ' || description || ' ' || section AS body
      FROM equipment_items
    `,
  },
  {
    section: 'pumps',
    table: 'rows',
    sql: `
      SELECT id, brand || ' ' || model AS title,
             'насос, до ' || h_max_m || ' м при ' || q_max_m3h || ' м³/ч' AS subtitle,
             brand || ' ' || model || ' ' || COALESCE(alt_model, '') || ' ' || series AS body
      FROM pumps
    `,
  },
  {
    section: 'pipes',
    table: 'rows',
    sql: `
      SELECT id,
             standard || ' Ø' || CAST(od_mm AS INTEGER) AS title,
             'внутренний Ø ' || id_mm || ' мм' AS subtitle,
             standard || ' ' || COALESCE(sdr, '') || ' ' || COALESCE(pn, '') AS body
      FROM pipes
    `,
  },
  {
    section: 'soils',
    table: 'rows',
    sql: `
      SELECT id, title,
             'впитывание ' || infiltration_min || '–' || infiltration_max || ' мм/ч' AS subtitle,
             title || ' ' || note AS body
      FROM soils
    `,
  },
  {
    section: 'plants',
    table: 'rows',
    sql: `
      SELECT id, plant_type AS title,
             'Kc ' || kc_min || '–' || kc_max AS subtitle,
             plant_type || ' ' || note AS body
      FROM kc_values
    `,
  },
  {
    section: 'valves',
    table: 'models',
    sql: `
      SELECT id, model || ' ' || size_label AS title,
             'клапан, до ' || flow_max_m3h || ' м³/ч' AS subtitle,
             model || ' ' || size_label || ' ' || note AS body
      FROM valve_models
    `,
  },
  {
    section: 'valves',
    table: 'solenoids',
    sql: `
      SELECT id, type AS title, 'соленоид' AS subtitle, type || ' ' || note AS body
      FROM valve_solenoids
    `,
  },
  {
    section: 'cable',
    table: 'rows',
    sql: `
      SELECT id,
             cross_section_mm2 || ' мм² при ' || current_a || ' А' AS title,
             'до ' || max_length_m || ' м' AS subtitle,
             'кабель сечение ' || cross_section_mm2 || ' ' || note AS body
      FROM cable_table
    `,
  },
  {
    section: 'filtration',
    table: 'mesh',
    sql: `
      SELECT id, mesh || ' меш (' || micron || ' мкм)' AS title,
             'степень фильтрации' AS subtitle,
             mesh || ' меш ' || micron || ' микрон ' || note AS body
      FROM filtration_mesh
    `,
  },
  {
    section: 'filtration',
    table: 'requirements',
    sql: `
      SELECT id, equipment AS title,
             'не грубее ' || min_mesh || ' меш' AS subtitle,
             equipment || ' фильтрация' AS body
      FROM filtration_requirements
    `,
  },
  {
    section: 'filtration',
    table: 'types',
    sql: `
      SELECT id, filter_type AS title, 'тип фильтра' AS subtitle,
             filter_type || ' ' || note AS body
      FROM filtration_types
    `,
  },
  {
    section: 'filtration',
    table: 'sources',
    sql: `
      SELECT id, water_source AS title, 'подбор фильтра под источник' AS subtitle,
             water_source || ' ' || risk || ' ' || recommendation AS body
      FROM filtration_sources
    `,
  },
  {
    section: 'glossary',
    table: 'rows',
    sql: `
      SELECT id, term_ru AS title, term_en AS subtitle,
             term_ru || ' ' || term_en || ' ' || definition AS body
      FROM glossary
    `,
  },
  {
    section: 'standards',
    table: 'rows',
    sql: `
      SELECT id, code AS title, title_ru AS subtitle,
             code || ' ' || title_ru || ' ' || scope_note || ' ' || region AS body
      FROM standards_refs
    `,
  },
  {
    section: 'calculators',
    table: 'rows',
    sql: `
      SELECT id, title, spec_ref AS subtitle,
             title || ' ' || description || ' ' || formula_md || ' ' || spec_ref AS body
      FROM calculators
    `,
  },
];

/** Пересобирает индекс поиска целиком. Вызывается после наполнения справочников. */
export function rebuildSearchIndex(db: Db): number {
  db.exec('DELETE FROM search_index');

  const insert = db.prepare(`
    INSERT INTO search_index (section, row_id, title, subtitle, body, haystack)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const spec of SPECS) {
    const rows = db.prepare(spec.sql).all() as unknown as Array<{
      id: number | null;
      title: string | null;
      subtitle: string | null;
      body: string | null;
    }>;

    for (const row of rows) {
      const title = row.title ?? '';
      if (!title) continue;
      const subtitle = row.subtitle ?? '';
      const body = row.body ?? '';
      insert.run(
        `${spec.section}:${spec.table}`,
        row.id,
        title,
        subtitle,
        body,
        normalize(`${title} ${subtitle} ${body}`),
      );
      count += 1;
    }
  }

  return count;
}

const HITS_PER_SECTION = 6;
const MAX_SECTIONS = 12;

export function globalSearch(db: Db, rawQuery: string): SearchResult {
  const query = rawQuery.trim();
  if (query.length < 2) return { query, total: 0, groups: [] };

  const rows = db
    .prepare(
      `SELECT section, row_id, title, subtitle,
              instr(haystack, ?) AS position
       FROM search_index
       WHERE haystack LIKE ?
       ORDER BY position ASC, length(title) ASC
       LIMIT 400`,
    )
    .all(normalize(query), `%${normalize(query)}%`) as unknown as Array<{
    section: string;
    row_id: number | null;
    title: string;
    subtitle: string;
  }>;

  const grouped = new Map<string, SearchHit[]>();
  for (const row of rows) {
    const [sectionKey = '', tableKey = ''] = row.section.split(':');
    const list = grouped.get(sectionKey) ?? [];
    list.push({
      section: sectionKey,
      table: tableKey,
      rowId: row.row_id,
      title: row.title,
      subtitle: row.subtitle,
    });
    grouped.set(sectionKey, list);
  }

  const groups: SearchGroup[] = [];
  for (const [sectionKey, hits] of grouped) {
    const section = REFERENCE_SECTIONS.find((s) => s.key === sectionKey);
    groups.push({
      section: sectionKey,
      sectionTitle: section?.title ?? (sectionKey === 'calculators' ? 'Калькуляторы' : sectionKey),
      icon: section?.icon ?? (sectionKey === 'calculators' ? '🧮' : '📄'),
      total: hits.length,
      hits: hits.slice(0, HITS_PER_SECTION),
    });
  }

  // Разделы с большим числом находок идут первыми: это обычно то,
  // что человек и искал.
  groups.sort((a, b) => b.total - a.total);

  return {
    query,
    total: rows.length,
    groups: groups.slice(0, MAX_SECTIONS),
  };
}
