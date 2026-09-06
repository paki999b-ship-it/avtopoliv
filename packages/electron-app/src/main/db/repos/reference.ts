import type { Db } from '../connection.js';
import type {
  ReferenceColumn,
  ReferenceQuery,
  ReferenceResult,
  ReferenceSectionInfo,
  ReferenceTableInfo,
} from '../../../shared/reference.js';

/**
 * Справочники (§3.3 ТЗ).
 *
 * Каждая таблица описана данными: колонки, фильтры, сортировка и то, по каким
 * полям идёт поиск. Один обработчик обслуживает все девять разделов, поэтому
 * фильтр и сортировка ведут себя в них одинаково.
 *
 * Безопасность запросов: имена колонок берутся только из этих описаний и
 * сверяются со списком перед подстановкой в SQL; пользовательский текст
 * уходит исключительно параметрами.
 */

interface TableDef {
  key: string;
  title: string;
  note?: string;
  /** Источник строк: имя таблицы или подзапрос. */
  from: string;
  columns: ReferenceColumn[];
  /** Колонки, по которым работает строка поиска раздела. */
  searchColumns: string[];
  filters?: Array<{ key: string; label: string; column: string }>;
  defaultSort?: { column: string; dir: 'asc' | 'desc' };
  /**
   * Колонки, по которым можно сортировать, но которые не показываются:
   * например, размер клапана в миллиметрах при видимой подписи «1½\" (40 мм)».
   */
  sortOnlyColumns?: string[];
  /** Постоянное условие — например, только сошедшиеся строки. */
  where?: string;
}

interface SectionDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  note?: string;
  tables: TableDef[];
}

const col = (
  key: string,
  label: string,
  options: Partial<ReferenceColumn> = {},
): ReferenceColumn => ({ key, label, numeric: false, ...options });

const SECTIONS: SectionDef[] = [
  {
    key: 'nozzles',
    title: 'Сопла и дождеватели',
    description: 'Таблицы производительности из каталога Hunter: сопло → давление → радиус, расход, интенсивность.',
    icon: '💦',
    note:
      'Данные извлечены из каталога Hunter, издание 41 (RU); у каждой строки указана страница. ' +
      'Строки, не прошедшие сплошную арифметическую сверку, помечены и требуют проверки по печатному каталогу.',
    tables: [
      {
        key: 'rows',
        title: 'Производительность сопел',
        note:
          'Роторы, спреи и роторные сопла из каталога Hunter, издание 41 (RU). ' +
          'Полосовые форсунки вынесены в отдельную таблицу: у них не радиус и сектор, ' +
          'а размер прямоугольной полосы.',
        from: 'equipment_nozzles',
        where: "emitter_class <> 'strip'",
        columns: [
          col('emitter_class', 'Класс', { kind: 'emitter_class' }),
          col('model', 'Семейство'),
          col('nozzle', 'Насадка'),
          col('sector_deg', 'Сектор, °', { numeric: true, digits: 0 }),
          col('pressure_bar', 'Давление, бар', { numeric: true, digits: 1 }),
          col('radius_m', 'Радиус, м', { numeric: true, digits: 1 }),
          col('flow_m3h', 'Расход, м³/ч', { numeric: true, digits: 2 }),
          col('flow_lpm', 'Расход, л/мин', { numeric: true, digits: 2 }),
          col('pr_square_mm_h', 'PR квадрат, мм/ч', { numeric: true, digits: 1 }),
          col('pr_triangle_mm_h', 'PR треугольник, мм/ч', { numeric: true, digits: 1 }),
          col('verified', 'Сверено', { kind: 'verified' }),
          col('source_page', 'Стр.', { numeric: true, digits: 0 }),
        ],
        searchColumns: ['model', 'nozzle'],
        filters: [
          { key: 'emitter_class', label: 'Класс', column: 'emitter_class' },
          { key: 'model', label: 'Семейство', column: 'model' },
        ],
        defaultSort: { column: 'model', dir: 'asc' },
      },
      {
        key: 'strip',
        title: 'Полосовые форсунки',
        note:
          'Полосовая форсунка поливает прямоугольник, а не сектор круга: вместо радиуса — ' +
          'ширина и длина полосы, и они меняются с давлением. Интенсивность вычислена ' +
          'движком по §5.6 (расход, делённый на площадь полосы), а не переписана из листа. ' +
          'Сектор не регулируется. В одной зоне полосовые сочетаются только между собой.',
        from: 'equipment_nozzles',
        where: "emitter_class = 'strip'",
        columns: [
          col('model', 'Модель'),
          col('pattern_title', 'Форма полива'),
          col('pressure_bar', 'Давление, бар', { numeric: true, digits: 1 }),
          col('pattern_width_m', 'Ширина, м', { numeric: true, digits: 1 }),
          col('pattern_length_m', 'Длина, м', { numeric: true, digits: 1 }),
          col('flow_m3h', 'Расход, м³/ч', { numeric: true, digits: 2 }),
          col('flow_lpm', 'Расход, л/мин', { numeric: true, digits: 1 }),
          col('pr_square_mm_h', 'PR, мм/ч', { numeric: true, digits: 1 }),
          col('is_recommended', 'Рабочая точка', { kind: 'recommended' }),
        ],
        searchColumns: ['model', 'pattern_title'],
        filters: [
          { key: 'model', label: 'Модель', column: 'model' },
          { key: 'pattern_title', label: 'Форма полива', column: 'pattern_title' },
        ],
        defaultSort: { column: 'model', dir: 'asc' },
      },
    ],
  },

  {
    key: 'equipment',
    title: 'Оборудование Hunter',
    description:
      'Перечень изделий каталога: контроллеры, датчики, декодеры, капельные линии, фитинги, короба.',
    icon: '🧰',
    note:
      'Перечень собран из таблиц «Модель — описание» каталога Hunter, издание 41 (RU); ' +
      'у каждой строки указана полоса издания. Числовые характеристики сопел, клапанов и ' +
      'фильтрации лежат в своих разделах справочника. Перед заказом сверяйте артикул с ' +
      'актуальным каталогом производителя: обозначения меняются от издания к изданию.',
    tables: [
      {
        key: 'rows',
        title: 'Изделия каталога',
        from: 'equipment_items',
        columns: [
          col('model', 'Модель'),
          col('section', 'Раздел каталога'),
          col('description', 'Назначение', { wide: true }),
          col('source_page', 'Полоса', { numeric: true, digits: 0 }),
        ],
        searchColumns: ['model', 'description', 'section'],
        filters: [{ key: 'section', label: 'Раздел', column: 'section' }],
        defaultSort: { column: 'model', dir: 'asc' },
      },
    ],
  },

  {
    key: 'pumps',
    title: 'Насосы',
    description:
      'Каталожные кривые Q–H: расход, напор, мощность и питание по каталогам производителей.',
    icon: '⚙️',
    note:
      'Точки кривой взяты из напечатанных в каталоге таблиц; ни одна точка не достроена ' +
      'и не интерполирована при извлечении. Строка «Оцифровано» показывает, снята ли кривая ' +
      'с графика вместо таблицы. Перед заказом сверьте характеристики с актуальным каталогом ' +
      'производителя: приложение показывает издание, из которого взяты данные.',
    tables: [
      {
        key: 'rows',
        title: 'Каталожные насосы',
        from: 'pumps',
        columns: [
          col('brand', 'Бренд'),
          col('model', 'Модель'),
          col('type', 'Тип', { kind: 'pump_type' }),
          col('power_kw_min', 'P2, кВт', { numeric: true, digits: 2 }),
          col('voltage', 'Питание'),
          col('q_max_m3h', 'Q макс., м³/ч', { numeric: true, digits: 1 }),
          col('h_max_m', 'H макс., м', { numeric: true, digits: 1 }),
          col('digitized', 'Оцифровано', { kind: 'digitized' }),
          col('source_file', 'Каталог', { wide: true }),
          col('source_page', 'Стр.', { numeric: true, digits: 0 }),
        ],
        searchColumns: ['brand', 'model', 'alt_model', 'series'],
        // Второе обозначение и серия не показываются колонками, но искать по
        // ним нужно: в каталоге одна машина часто названа двумя способами.
        sortOnlyColumns: ['alt_model', 'series'],
        filters: [
          { key: 'brand', label: 'Бренд', column: 'brand' },
          { key: 'type', label: 'Тип', column: 'type' },
        ],
        defaultSort: { column: 'model', dir: 'asc' },
      },
    ],
  },

  {
    key: 'pipes',
    title: 'Трубы',
    description: 'Сортамент ПЭ100 и ПВХ: диаметры, расход при рабочих скоростях, потери на 100 м.',
    icon: '🧵',
    note:
      'Полиэтилен — ГОСТ 18599-2001, таблица 4; ПВХ — ISO 1452-2:2009, Table 2. ' +
      'Расходы и потери вычислены расчётным движком по формулам §5.2 и §5.3, а не переписаны.',
    tables: [
      {
        key: 'rows',
        title: 'Сортамент',
        from: 'pipes',
        columns: [
          col('standard', 'Сортамент'),
          col('sdr', 'SDR'),
          col('pn', 'PN'),
          col('od_mm', 'Наружный Ø, мм', { numeric: true, digits: 0 }),
          col('wall_mm', 'Стенка, мм', { numeric: true, digits: 1 }),
          col('id_mm', 'Внутренний Ø, мм', { numeric: true, digits: 1 }),
          col('q_1_0_m3h', 'Q при 1,0 м/с, м³/ч', { numeric: true, digits: 2 }),
          col('q_1_5_m3h', 'Q при 1,5 м/с, м³/ч', { numeric: true, digits: 2 }),
          col('q_2_0_m3h', 'Q при 2,0 м/с, м³/ч', { numeric: true, digits: 2 }),
          col('hf_100m_at_1_5', 'Потери на 100 м при 1,5 м/с', { numeric: true, digits: 2 }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['standard', 'sdr', 'pn'],
        filters: [{ key: 'standard', label: 'Сортамент', column: 'standard' }],
        defaultSort: { column: 'od_mm', dir: 'asc' },
      },
    ],
  },

  {
    key: 'soils',
    title: 'Почвы',
    description: 'Скорость впитывания и доступная влага по типам почвы.',
    icon: '🪨',
    note:
      'Впитывание — FAO, Irrigation Water Management, Annex 2, Table 7; влагоёмкость — UC ANR. ' +
      'Строка песка прочитана как «более 30 мм/ч»: напечатанное в FAO «less than 30» противоречит ' +
      'порядку самой таблицы, где супесь получает 20–30 мм/ч.',
    tables: [
      {
        key: 'rows',
        title: 'Типы почв',
        from: 'soils',
        columns: [
          col('title', 'Почва'),
          col('infiltration_min', 'Впитывание от, мм/ч', { numeric: true, digits: 0 }),
          col('infiltration_max', 'до, мм/ч', { numeric: true, digits: 0 }),
          col('awc_min', 'Доступная влага от, мм/м', { numeric: true, digits: 0 }),
          col('awc_max', 'до, мм/м', { numeric: true, digits: 0 }),
          col('note', 'Замечание', { wide: true }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['title', 'note'],
        defaultSort: { column: 'infiltration_max', dir: 'desc' },
      },
    ],
  },

  {
    key: 'plants',
    title: 'Kc и насаждения',
    description: 'Коэффициенты культуры и глубина корневой зоны.',
    icon: '🌿',
    note:
      'Значения восходят к методике FAO Irrigation and Drainage Paper 56. ' +
      'Локальных значений ET0 в приложении нет намеренно: их берут из метеоданных своего региона ' +
      'и вводят в калькулятор §5.7.',
    tables: [
      {
        key: 'rows',
        title: 'Коэффициенты культуры',
        from: 'kc_values',
        columns: [
          col('plant_type', 'Насаждения'),
          col('kc_min', 'Kc от', { numeric: true, digits: 2 }),
          col('kc_max', 'до', { numeric: true, digits: 2 }),
          col('root_depth_min_m', 'Корни от, м', { numeric: true, digits: 2 }),
          col('root_depth_max_m', 'до, м', { numeric: true, digits: 2 }),
          col('note', 'Замечание', { wide: true }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['plant_type', 'note'],
        defaultSort: { column: 'kc_max', dir: 'desc' },
      },
    ],
  },

  {
    key: 'valves',
    title: 'Клапаны и арматура',
    description: 'Типоразмеры, рабочие расходы, потери давления по расходу и типы соленоидов.',
    icon: '🔩',
    note:
      'Потери извлечены из каталога Hunter, издание 41 (RU), стр. 87, 89, 91. Опорной принята ' +
      'таблица «в кПа»: её разрешение вдесятеро выше, чем у таблицы «в барах». Строки, где две ' +
      'печатные таблицы каталога расходятся больше чем на шаг округления, помечены.',
    tables: [
      {
        key: 'losses',
        title: 'Потери давления по расходу',
        from: 'valve_losses',
        columns: [
          col('model', 'Модель'),
          col('size_label', 'Типоразмер'),
          col('body', 'Корпус', { kind: 'valve_body' }),
          col('flow_m3h', 'Расход, м³/ч', { numeric: true, digits: 2 }),
          col('flow_lpm', 'Расход, л/мин', { numeric: true, digits: 0 }),
          col('loss_bar', 'Потери, бар', { numeric: true, digits: 2 }),
          col('loss_kpa', 'Потери, кПа', { numeric: true, digits: 0 }),
          col('verified', 'Сверено', { kind: 'verified' }),
          col('source_page', 'Стр.', { numeric: true, digits: 0 }),
        ],
        searchColumns: ['model', 'size_label'],
        filters: [{ key: 'model', label: 'Модель', column: 'model' }],
        defaultSort: { column: 'flow_m3h', dir: 'asc' },
      },
      {
        key: 'models',
        title: 'Типоразмеры и диапазоны',
        from: 'valve_models',
        columns: [
          col('model', 'Модель'),
          col('size_label', 'Типоразмер'),
          col('flow_min_m3h', 'Расход от, м³/ч', { numeric: true, digits: 2 }),
          col('flow_max_m3h', 'до, м³/ч', { numeric: true, digits: 0 }),
          col('pressure_min_bar', 'Давление от, бар', { numeric: true, digits: 1 }),
          col('pressure_max_bar', 'до, бар', { numeric: true, digits: 0 }),
          col('warranty_years', 'Гарантия, лет', { numeric: true, digits: 0 }),
          col('note', 'Назначение', { wide: true }),
        ],
        searchColumns: ['model', 'size_label', 'note'],
        sortOnlyColumns: ['size_mm'],
        defaultSort: { column: 'size_mm', dir: 'asc' },
      },
      {
        key: 'solenoids',
        title: 'Соленоиды',
        note: 'Кабель считается по пусковому току: не хватит напряжения при открытии — клапан не откроется вовсе.',
        from: 'valve_solenoids',
        columns: [
          col('type', 'Тип'),
          col('frequency_hz', 'Частота, Гц', { numeric: true, digits: 0 }),
          col('inrush_ma', 'Пусковой ток, мА', { numeric: true, digits: 0 }),
          col('holding_ma', 'Удержание, мА', { numeric: true, digits: 0 }),
          col('note', 'Замечание', { wide: true }),
        ],
        searchColumns: ['type', 'note'],
        defaultSort: { column: 'id', dir: 'asc' },
      },
    ],
  },

  {
    key: 'cable',
    title: 'Кабель',
    description: 'Максимальные длины по сечению и токовой нагрузке при допуске 2,4 В.',
    icon: '🔌',
    note:
      'Таблица не взята готовой, а вычислена по формуле §5.12 той же функцией, что и калькулятор, — ' +
      'поэтому справочник и расчёт разойтись не могут. Пусковой ток соленоида 0,37 А при 50 Гц ' +
      'взят из каталога Hunter, издание 41 (RU).',
    tables: [
      {
        key: 'rows',
        title: 'Предельные длины',
        from: 'cable_table',
        columns: [
          col('cross_section_mm2', 'Сечение, мм²', { numeric: true, digits: 2 }),
          col('current_a', 'Ток, А', { numeric: true, digits: 2 }),
          col('max_length_m', 'Предельная длина, м', { numeric: true, digits: 0 }),
          col('note', 'Случай', { wide: true }),
        ],
        searchColumns: ['note'],
        filters: [{ key: 'cross_section_mm2', label: 'Сечение', column: 'cross_section_mm2' }],
        defaultSort: { column: 'cross_section_mm2', dir: 'asc' },
      },
    ],
  },

  {
    key: 'filtration',
    title: 'Фильтрация',
    description: 'Меш и микроны, минимальные требования по типам оборудования, выбор фильтра под источник.',
    icon: '🧽',
    note:
      'Соответствия и требования — каталог Hunter, издание 41 (RU), с указанием страницы. ' +
      'На стр. 184 для 150 меш напечатано «120 мкм», тогда как на стр. 167, 168, 190 и 192 — «100 мкм»; ' +
      'приложение использует 100 мкм и показывает расхождение, а не прячет его.',
    tables: [
      {
        key: 'mesh',
        title: 'Меш и микроны',
        from: 'filtration_mesh',
        columns: [
          col('mesh', 'Меш', { numeric: true, digits: 0 }),
          col('micron', 'Микрон', { numeric: true, digits: 0 }),
          col('note', 'Где применяется', { wide: true }),
          col('source_page', 'Стр.', { numeric: true, digits: 0 }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['note'],
        defaultSort: { column: 'mesh', dir: 'asc' },
      },
      {
        key: 'requirements',
        title: 'Минимум по типу оборудования',
        from: 'filtration_requirements',
        columns: [
          col('equipment', 'Оборудование', { wide: true }),
          col('min_mesh', 'Не грубее, меш', { numeric: true, digits: 0 }),
          col('min_micron', 'Микрон', { numeric: true, digits: 0 }),
          col('source_page', 'Стр.', { numeric: true, digits: 0 }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['equipment'],
        defaultSort: { column: 'min_mesh', dir: 'asc' },
      },
      {
        key: 'types',
        title: 'Типы фильтров',
        from: 'filtration_types',
        columns: [
          col('filter_type', 'Тип'),
          col('typical_mesh', 'Обычный меш'),
          col('note', 'Особенности', { wide: true }),
          col('source_status', 'Статус', { kind: 'status' }),
        ],
        searchColumns: ['filter_type', 'note'],
        defaultSort: { column: 'id', dir: 'asc' },
      },
      {
        key: 'sources',
        title: 'Выбор под источник воды',
        from: 'filtration_sources',
        columns: [
          col('water_source', 'Источник'),
          col('risk', 'Чем грозит', { wide: true }),
          col('recommendation', 'Что ставить', { wide: true }),
        ],
        searchColumns: ['water_source', 'risk', 'recommendation'],
        defaultSort: { column: 'id', dir: 'asc' },
      },
    ],
  },

  {
    key: 'glossary',
    title: 'Термины',
    description: 'Глоссарий с английскими эквивалентами: PR, DU, MAD, EU, head-to-head, cycle & soak и другие.',
    icon: '📖',
    tables: [
      {
        key: 'rows',
        title: 'Глоссарий',
        from: 'glossary',
        columns: [
          col('term_ru', 'Термин'),
          col('term_en', 'По-английски'),
          col('group_key', 'Раздел', { kind: 'glossary_group' }),
          col('definition', 'Определение', { wide: true }),
          col('calculator_key', 'Калькулятор', { kind: 'calculator_link' }),
        ],
        searchColumns: ['term_ru', 'term_en', 'definition'],
        filters: [{ key: 'group_key', label: 'Раздел', column: 'group_key' }],
        defaultSort: { column: 'term_ru', dir: 'asc' },
      },
    ],
  },

  {
    key: 'standards',
    title: 'Нормативная рамка',
    description: 'Перечень документов и что именно они регламентируют.',
    icon: '📜',
    note:
      'Тексты нормативов не воспроизводятся (§10 п.8 ТЗ) — только перечень, назначение и ссылка ' +
      'на официальный источник. Местные нормы требуют проверки по действующей редакции ' +
      'и юрисдикции пользователя.',
    tables: [
      {
        key: 'rows',
        title: 'Документы',
        from: 'standards_refs',
        columns: [
          col('code', 'Документ'),
          col('title_ru', 'Название', { wide: true }),
          col('region', 'Область'),
          col('edition', 'Редакция'),
          col('scope_note', 'Что регламентирует', { wide: true }),
          col('needs_local_check', 'Проверить по месту', { kind: 'local_check' }),
          col('url', 'Ссылка', { kind: 'url' }),
        ],
        searchColumns: ['code', 'title_ru', 'scope_note', 'region'],
        defaultSort: { column: 'code', dir: 'asc' },
      },
    ],
  },
];

function findSection(key: string): SectionDef {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Неизвестный раздел справочника: ${key}`);
  return section;
}

function findTable(section: SectionDef, key: string | undefined): TableDef {
  const table = key ? section.tables.find((t) => t.key === key) : section.tables[0];
  if (!table) throw new Error(`В разделе «${section.title}» нет таблицы «${key}»`);
  return table;
}

function countRows(db: Db, from: string, where?: string): number {
  const sql = `SELECT COUNT(*) AS n FROM ${from}${where ? ` WHERE ${where}` : ''}`;
  const row = db.prepare(sql).get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** Состав раздела «Справочники» с числом строк — для меню и плиток. */
export function referenceSections(db: Db): ReferenceSectionInfo[] {
  return SECTIONS.map((section) => {
    const tables: ReferenceTableInfo[] = section.tables.map((table) => ({
      key: table.key,
      title: table.title,
      note: table.note,
      rows: countRows(db, table.from, table.where),
      filters: (table.filters ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        values: distinctValues(db, table, f.column),
      })),
    }));

    return {
      key: section.key,
      title: section.title,
      description: section.description,
      icon: section.icon,
      note: section.note,
      rows: tables.reduce((sum, t) => sum + t.rows, 0),
      tables,
    };
  });
}

function distinctValues(db: Db, table: TableDef, column: string): string[] {
  assertColumn(table, column);
  const rows = db
    .prepare(
      `SELECT DISTINCT ${column} AS v FROM ${table.from}` +
        `${table.where ? ` WHERE ${table.where}` : ''} ORDER BY v`,
    )
    .all() as Array<{ v: unknown }>;
  return rows.map((r) => String(r.v ?? '')).filter((v) => v !== '');
}

/** Колонка обязана быть объявлена в описании — иначе она не попадёт в SQL. */
function assertColumn(table: TableDef, column: string): void {
  const known =
    column === 'id' ||
    table.columns.some((c) => c.key === column) ||
    (table.sortOnlyColumns ?? []).includes(column) ||
    (table.filters ?? []).some((f) => f.column === column);
  if (!known) throw new Error(`Колонка «${column}» не объявлена в таблице «${table.key}»`);
}

/** Нормализация строки поиска: регистр и «ё» не должны мешать находить. */
export function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е').trim();
}

const MAX_LIMIT = 500;

export function queryReference(db: Db, request: ReferenceQuery): ReferenceResult {
  const section = findSection(request.section);
  const table = findTable(section, request.table);

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (table.where) conditions.push(table.where);

  const search = request.query?.trim();
  if (search) {
    const like = `%${normalize(search)}%`;
    const parts = table.searchColumns.map((column) => {
      assertColumn(table, column);
      // «ё» приводится к «е» с обеих сторон: иначе «плёнка» не найдётся по «пленка».
      return `replace(lower(COALESCE(${column}, '')), 'ё', 'е') LIKE ?`;
    });
    if (parts.length > 0) {
      conditions.push(`(${parts.join(' OR ')})`);
      for (const _ of parts) params.push(like);
    }
  }

  for (const [key, value] of Object.entries(request.filters ?? {})) {
    if (value === '' || value === undefined) continue;
    const filter = (table.filters ?? []).find((f) => f.key === key);
    if (!filter) continue;
    assertColumn(table, filter.column);
    conditions.push(`${filter.column} = ?`);
    params.push(value);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  const sortColumn = request.sort?.column ?? table.defaultSort?.column ?? table.columns[0]!.key;
  assertColumn(table, sortColumn);
  const sortDir = (request.sort?.dir ?? table.defaultSort?.dir ?? 'asc') === 'desc' ? 'DESC' : 'ASC';

  const limit = Math.min(Math.max(1, request.limit ?? 100), MAX_LIMIT);
  const offset = Math.max(0, request.offset ?? 0);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table.from}${where}`)
    .get(...params) as { n: number } | undefined;

  const columnList = ['id', ...table.columns.map((c) => c.key)].join(', ');
  const rows = db
    .prepare(
      `SELECT ${columnList} FROM ${table.from}${where} ` +
        `ORDER BY ${sortColumn} ${sortDir}, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as Array<Record<string, unknown>>;

  return {
    section: section.key,
    sectionTitle: section.title,
    table: table.key,
    tableTitle: table.title,
    note: table.note ?? section.note,
    columns: table.columns,
    rows: rows.map((row) => ({ ...row })),
    total: Number(totalRow?.n ?? 0),
    limit,
    offset,
    sort: { column: sortColumn, dir: sortDir === 'DESC' ? 'desc' : 'asc' },
  };
}

export { SECTIONS as REFERENCE_SECTIONS };
export type { SectionDef, TableDef };
