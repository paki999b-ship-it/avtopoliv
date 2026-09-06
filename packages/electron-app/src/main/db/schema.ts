/**
 * Схема базы данных — §7 ТЗ.
 *
 * Миграции задаются массивом: индекс в массиве и есть версия схемы, она
 * хранится в `PRAGMA user_version`. Добавлять шаги можно только в конец,
 * править уже выпущенные — нельзя.
 *
 * Общее правило §7: у каждой строки справочника с числовыми данными поле
 * `source` обязательно и непустое. Это закреплено ограничением
 * `CHECK (length(trim(source)) > 0)`, а не соглашением.
 */

const V1 = `
-- ── Профили и прогресс ─────────────────────────────────────────────────────
CREATE TABLE profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  avatar           TEXT NOT NULL DEFAULT '💧',
  skill_level      TEXT NOT NULL DEFAULT 'owner'
                   CHECK (skill_level IN ('owner', 'installer', 'designer')),
  unit_system      TEXT NOT NULL DEFAULT 'metric'
                   CHECK (unit_system IN ('metric', 'imperial')),
  xp               INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  streak_days      INTEGER NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  last_active_date TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Академия ───────────────────────────────────────────────────────────────
CREATE TABLE lessons (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,
  level         TEXT NOT NULL CHECK (level IN
                  ('basics', 'water_plants', 'equipment', 'design', 'automation', 'operation')),
  order_index   INTEGER NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  body_md       TEXT NOT NULL,
  media_path    TEXT,
  calculator_key TEXT,
  xp_award      INTEGER NOT NULL DEFAULT 10,
  source        TEXT NOT NULL DEFAULT '',
  UNIQUE (level, order_index)
);

CREATE TABLE lesson_progress (
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'not_started'
               CHECK (status IN ('not_started', 'in_progress', 'completed')),
  completed_at TEXT,
  PRIMARY KEY (profile_id, lesson_id)
);

-- ── Вопросы и тесты ────────────────────────────────────────────────────────
CREATE TABLE questions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  key               TEXT NOT NULL UNIQUE,
  category          TEXT NOT NULL CHECK (category IN
                      ('basics', 'water_plants', 'hydraulics', 'equipment', 'design',
                       'automation_electrical', 'installation_maintenance', 'safety')),
  type              TEXT NOT NULL CHECK (type IN ('single', 'multi', 'numeric', 'match', 'scenario')),
  prompt            TEXT NOT NULL,
  options_json      TEXT,
  correct_json      TEXT NOT NULL,
  unit              TEXT,
  tolerance_percent REAL,
  -- §3.7: пояснение обязательно у каждого вопроса.
  explanation       TEXT NOT NULL CHECK (length(trim(explanation)) > 0),
  difficulty        INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  lesson_id         INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  scenario_id       INTEGER,
  source            TEXT NOT NULL DEFAULT '',
  -- numeric-вопрос без допуска проверить нечем.
  CHECK (type <> 'numeric' OR tolerance_percent IS NOT NULL)
);

CREATE TABLE quiz_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('lesson_quiz', 'level_quiz', 'practice')),
  level         TEXT,
  lesson_id     INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  score         REAL NOT NULL,
  total         INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  passed        INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quiz_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id   INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id  INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_json  TEXT NOT NULL,
  is_correct   INTEGER NOT NULL,
  answered_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Калькуляторы ───────────────────────────────────────────────────────────
CREATE TABLE calculators (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  key               TEXT NOT NULL UNIQUE,
  section           TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  formula_md        TEXT NOT NULL DEFAULT '',
  spec_ref          TEXT NOT NULL DEFAULT '',
  related_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  order_index       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE calc_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  calculator_key  TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  inputs_json     TEXT NOT NULL,
  outputs_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_calc_history_profile ON calc_history(profile_id, created_at DESC);

-- ── Справочники ────────────────────────────────────────────────────────────
CREATE TABLE equipment_nozzles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand        TEXT NOT NULL,
  family       TEXT NOT NULL,
  model        TEXT NOT NULL,
  nozzle       TEXT NOT NULL,
  sector_deg   REAL,
  pressure_bar REAL NOT NULL,
  radius_m     REAL NOT NULL,
  flow_m3h     REAL NOT NULL,
  flow_lpm     REAL,
  pr_square_mm_h   REAL,
  pr_triangle_mm_h REAL,
  emitter_class TEXT NOT NULL DEFAULT 'rotor',
  -- Строки, не прошедшие сверку, помечены verified = 0 и в справочник
  -- выводятся только с явной пометкой (DECISIONS.md, решение 7).
  verified     INTEGER NOT NULL DEFAULT 1,
  issue        TEXT,
  source       TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_page  INTEGER
);
CREATE INDEX idx_nozzles_lookup ON equipment_nozzles(family, model, nozzle, pressure_bar);

CREATE TABLE pipes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  material TEXT NOT NULL,
  standard TEXT NOT NULL DEFAULT '',
  sdr      TEXT,
  pn       TEXT,
  od_mm    REAL NOT NULL,
  wall_mm  REAL NOT NULL,
  id_mm    REAL NOT NULL,
  q_1_0_m3h REAL NOT NULL,
  q_1_5_m3h REAL NOT NULL,
  q_2_0_m3h REAL NOT NULL,
  hf_100m_at_1_5 REAL NOT NULL,
  source   TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_status TEXT NOT NULL DEFAULT 'verified'
);

CREATE TABLE soils (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  key      TEXT NOT NULL UNIQUE,
  title    TEXT NOT NULL,
  infiltration_min REAL NOT NULL,
  infiltration_max REAL NOT NULL,
  awc_min  REAL NOT NULL,
  awc_max  REAL NOT NULL,
  wetting_depth_note TEXT NOT NULL DEFAULT '',
  note     TEXT NOT NULL DEFAULT '',
  source   TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_status TEXT NOT NULL DEFAULT 'verified',
  CHECK (infiltration_min <= infiltration_max AND awc_min <= awc_max)
);

CREATE TABLE kc_values (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  plant_type TEXT NOT NULL,
  kc_min     REAL NOT NULL,
  kc_max     REAL NOT NULL,
  root_depth_min_m REAL,
  root_depth_max_m REAL,
  note       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_status TEXT NOT NULL DEFAULT 'verified',
  CHECK (kc_min <= kc_max)
);

CREATE TABLE valves (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  size     TEXT NOT NULL,
  flow_min_m3h REAL NOT NULL,
  flow_max_m3h REAL NOT NULL,
  loss_min_bar REAL NOT NULL,
  loss_max_bar REAL NOT NULL,
  note     TEXT NOT NULL DEFAULT '',
  source   TEXT NOT NULL CHECK (length(trim(source)) > 0)
);

CREATE TABLE cable_table (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cross_section_mm2 REAL NOT NULL,
  current_a         REAL NOT NULL,
  max_length_m      REAL NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL CHECK (length(trim(source)) > 0)
);

CREATE TABLE filtration (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh         INTEGER NOT NULL,
  micron       INTEGER NOT NULL,
  filter_type  TEXT NOT NULL,
  water_source TEXT NOT NULL,
  irrigation_type TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL CHECK (length(trim(source)) > 0)
);

CREATE TABLE glossary (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  term_ru           TEXT NOT NULL,
  term_en           TEXT NOT NULL DEFAULT '',
  definition        TEXT NOT NULL,
  related_lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL
);

-- §9, §10 п.8: только перечень, назначение и ссылка. Текстов нормативов нет.
CREATE TABLE standards_refs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL,
  title_ru   TEXT NOT NULL,
  scope_note TEXT NOT NULL,
  region     TEXT NOT NULL DEFAULT '',
  edition    TEXT NOT NULL DEFAULT '',
  needs_local_check INTEGER NOT NULL DEFAULT 0,
  url        TEXT
);

-- ── Тренажёры, диагностика, безопасность ───────────────────────────────────
CREATE TABLE layout_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  brief       TEXT NOT NULL,
  difficulty  INTEGER NOT NULL DEFAULT 2,
  plan_json   TEXT NOT NULL,
  reference_solution_json TEXT NOT NULL,
  qa_verified INTEGER NOT NULL DEFAULT 0,
  qa_notes    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE layout_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id       INTEGER NOT NULL REFERENCES layout_tasks(id) ON DELETE CASCADE,
  solution_json TEXT NOT NULL,
  score         REAL NOT NULL,
  issues_json   TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE error_scenarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  image_path  TEXT,
  scene_json  TEXT NOT NULL DEFAULT '{}',
  errors_json TEXT NOT NULL,
  category    TEXT NOT NULL,
  difficulty  INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE error_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id  INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES error_scenarios(id) ON DELETE CASCADE,
  found_json  TEXT NOT NULL,
  score       REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE diagnostics_nodes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  key                  TEXT NOT NULL UNIQUE,
  parent_key           TEXT,
  is_symptom           INTEGER NOT NULL DEFAULT 0,
  symptom_or_question  TEXT NOT NULL,
  answers_json         TEXT NOT NULL DEFAULT '[]',
  conclusion           TEXT,
  measure_hint         TEXT,
  action_hint          TEXT,
  related_lesson_id    INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  related_calculator_key TEXT
);

CREATE TABLE diagnostics_progress (
  profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symptom_key  TEXT NOT NULL,
  visited_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, symptom_key)
);

CREATE TABLE safety_topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL CHECK (category IN
                ('electrical', 'backflow', 'well_pump', 'excavation',
                 'chemicals', 'pressure', 'blowout', 'first_aid')),
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  media_path  TEXT,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE safety_progress (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  topic_id   INTEGER NOT NULL REFERENCES safety_topics(id) ON DELETE CASCADE,
  read_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, topic_id)
);

-- ── Экзамен ────────────────────────────────────────────────────────────────
CREATE TABLE exam_results (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id     INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score          REAL NOT NULL,
  total          INTEGER NOT NULL,
  correct_count  INTEGER NOT NULL,
  numeric_share  REAL NOT NULL DEFAULT 0,
  passed         INTEGER NOT NULL,
  duration_sec   INTEGER NOT NULL,
  answers_json   TEXT NOT NULL,
  certificate_no TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Служебное ──────────────────────────────────────────────────────────────
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;


const V2 = `
-- ── Справочники, наполненные на шаге §12 п.5 ───────────────────────────────
-- Таблицы valves и filtration из V1 заменяются: их форма не описывала ни
-- кривую потерь клапана по расходу, ни четыре разных вида данных о фильтрации.
-- Обе были пустыми справочными таблицами, поэтому пересоздаются, а не мигрируют.
DROP TABLE IF EXISTS valves;
DROP TABLE IF EXISTS filtration;

CREATE TABLE valve_models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  brand          TEXT NOT NULL,
  model          TEXT NOT NULL,
  size_label     TEXT NOT NULL,
  size_mm        REAL NOT NULL,
  flow_min_m3h   REAL NOT NULL,
  flow_max_m3h   REAL NOT NULL,
  pressure_min_bar REAL NOT NULL,
  pressure_max_bar REAL NOT NULL,
  warranty_years INTEGER,
  note           TEXT NOT NULL DEFAULT '',
  source         TEXT NOT NULL CHECK (length(trim(source)) > 0)
);

-- Потери давления по расходу: кривая, а не пара «мин–макс».
CREATE TABLE valve_losses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand       TEXT NOT NULL,
  model       TEXT NOT NULL,
  size_label  TEXT NOT NULL,
  size_mm     REAL NOT NULL,
  body        TEXT NOT NULL CHECK (body IN ('spherical', 'angle')),
  flow_m3h    REAL NOT NULL,
  flow_lpm    REAL NOT NULL,
  loss_bar    REAL NOT NULL,
  loss_kpa    REAL NOT NULL,
  verified    INTEGER NOT NULL DEFAULT 1,
  issue       TEXT,
  source      TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_page INTEGER
);
CREATE INDEX idx_valve_losses_model ON valve_losses(model, body, flow_m3h);

CREATE TABLE valve_solenoids (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,
  inrush_ma    REAL,
  holding_ma   REAL,
  frequency_hz REAL,
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL CHECK (length(trim(source)) > 0)
);

CREATE TABLE filtration_mesh (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  mesh    INTEGER NOT NULL UNIQUE,
  micron  INTEGER NOT NULL,
  note    TEXT NOT NULL DEFAULT '',
  source  TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_page INTEGER,
  source_status TEXT NOT NULL DEFAULT 'verified'
);

CREATE TABLE filtration_requirements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment     TEXT NOT NULL,
  emitter_class TEXT NOT NULL,
  min_mesh      INTEGER NOT NULL,
  min_micron    INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_page   INTEGER,
  source_status TEXT NOT NULL DEFAULT 'verified'
);

CREATE TABLE filtration_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  filter_type  TEXT NOT NULL,
  typical_mesh TEXT NOT NULL DEFAULT '',
  note         TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_status TEXT NOT NULL DEFAULT 'verified'
);

CREATE TABLE filtration_sources (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  water_source   TEXT NOT NULL,
  risk           TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  derived_from   TEXT NOT NULL DEFAULT ''
);

-- Глоссарий получает группу и связи с уроком и калькулятором по ключу:
-- уроков в базе ещё нет, а связь описать нужно уже сейчас.
ALTER TABLE glossary ADD COLUMN group_key TEXT NOT NULL DEFAULT '';
ALTER TABLE glossary ADD COLUMN lesson_key TEXT;
ALTER TABLE glossary ADD COLUMN calculator_key TEXT;

-- ── Единый индекс поиска по всему приложению (§3.3: Ctrl+F глобально) ──────
-- Полнотекстового индекса нет намеренно: русской морфологии в SQLite всё
-- равно нет, а объём справочников (порядка полутора тысяч строк) сканируется
-- обычным LIKE за миллисекунды. Зато поведение поиска предсказуемо и
-- одинаково на любой машине.
CREATE TABLE search_index (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  section   TEXT NOT NULL,
  row_id    INTEGER,
  title     TEXT NOT NULL,
  subtitle  TEXT NOT NULL DEFAULT '',
  body      TEXT NOT NULL DEFAULT '',
  -- Нормализованная строка для поиска: нижний регистр, «ё» приведена к «е».
  haystack  TEXT NOT NULL
);
CREATE INDEX idx_search_section ON search_index(section);
`;


const V3 = `
-- ── Академия: уроки хранятся блоками (§12 п.6) ─────────────────────────────
-- body_md остаётся: в него идёт плоский текст урока для поискового индекса.
-- Структурированное содержимое лежит в blocks_json — по блокам работает
-- переключатель уровня подачи (§1 ТЗ), которого markdown не описывает.
ALTER TABLE lessons ADD COLUMN blocks_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lessons ADD COLUMN reading_minutes INTEGER NOT NULL DEFAULT 5;

-- Порядок вопросов внутри мини-теста урока.
ALTER TABLE questions ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;
-- Правая колонка для вопросов на сопоставление.
ALTER TABLE questions ADD COLUMN match_options_json TEXT;

CREATE INDEX idx_questions_lesson ON questions(lesson_id, order_index);
CREATE INDEX idx_lessons_level ON lessons(level, order_index);
`;

const V4 = `
-- ── Диагностика: дерево «симптом → вопросы → причины» (§3.6) ───────────────
-- Причины идут списком с приоритетом, поэтому одной строкой conclusion не
-- обходятся: каждая причина — это заголовок, вероятность и пояснение.
ALTER TABLE diagnostics_nodes ADD COLUMN causes_json TEXT NOT NULL DEFAULT '[]';
-- Короткое описание симптома в списке: «как это выглядит на участке».
ALTER TABLE diagnostics_nodes ADD COLUMN hint TEXT;
ALTER TABLE diagnostics_nodes ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_diagnostics_parent ON diagnostics_nodes(parent_key);
CREATE INDEX idx_diagnostics_symptom ON diagnostics_nodes(is_symptom, order_index);
`;

const V5 = `
-- ── База вопросов: разделение на пулы (§3.7, §12 п.11) ─────────────────────
-- Вопросы мини-теста урока и вопросы экзаменационного банка живут в одной
-- таблице: у них одинаковая структура и одна и та же проверка ответов.
-- Различает их пул: мини-тест берёт только 'lesson', экзамен — все.
ALTER TABLE questions ADD COLUMN pool TEXT NOT NULL DEFAULT 'lesson';

CREATE INDEX idx_questions_pool ON questions(pool, category, type);
`;

const V6 = `
-- ── Полосовые форсунки (strip pattern nozzles) ─────────────────────────────
-- Полосовая форсунка поливает прямоугольник, а не сектор круга: у неё нет
-- радиуса и сектора, зато есть ширина и длина полосы, и они меняются с
-- давлением. Поэтому в таблице сопел появляются два размера полосы.
ALTER TABLE equipment_nozzles ADD COLUMN pattern_width_m REAL;
ALTER TABLE equipment_nozzles ADD COLUMN pattern_length_m REAL;
-- Рекомендованная производителем рабочая точка (для полосовых — 2,1 бар).
ALTER TABLE equipment_nozzles ADD COLUMN is_recommended INTEGER NOT NULL DEFAULT 0;
-- Человекочитаемое назначение модели: левый угол, боковая, центральная…
ALTER TABLE equipment_nozzles ADD COLUMN pattern_title TEXT;
-- Файл-источник: у полосовых это отдельный технический лист, а не каталог.
ALTER TABLE equipment_nozzles ADD COLUMN source_url TEXT;

CREATE INDEX idx_nozzles_class ON equipment_nozzles(emitter_class, model, pressure_bar);
`;

const V7 = `
-- ── Каталоги насосов (§5.11, часть 2 задачи) ───────────────────────────────
-- Кривая Q–H хранится точками, а не коэффициентами аппроксимации: точки взяты
-- из каталога, а любая аппроксимация — уже наша интерпретация. График рисует
-- ломаную по этим же точкам, поэтому картинка и расчёт совпадают.
CREATE TABLE pumps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  brand         TEXT NOT NULL,
  model         TEXT NOT NULL,
  alt_model     TEXT,
  series        TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL CHECK (type IN
                  ('surface', 'submersible', 'multistage', 'booster_station')),
  power_kw_min  REAL,
  power_kw_max  REAL,
  power_hp      REAL,
  voltage       TEXT NOT NULL DEFAULT '',
  q_max_m3h     REAL NOT NULL,
  h_max_m       REAL NOT NULL,
  -- §7 ТЗ: у записи с числовыми данными источник обязателен и непуст.
  source_file   TEXT NOT NULL CHECK (length(trim(source_file)) > 0),
  source_page   INTEGER NOT NULL,
  -- Кривая восстановлена с графика, а не взята из напечатанной таблицы.
  digitized     INTEGER NOT NULL DEFAULT 0,
  -- Для оцифрованных — как именно снята точка. Пустым быть не должен.
  digitized_note TEXT,
  UNIQUE (brand, model),
  CHECK (digitized = 0 OR (digitized_note IS NOT NULL AND length(trim(digitized_note)) > 0))
);

CREATE TABLE pump_curve_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pump_id     INTEGER NOT NULL REFERENCES pumps(id) ON DELETE CASCADE,
  q_m3h       REAL NOT NULL,
  h_m         REAL NOT NULL,
  point_order INTEGER NOT NULL
);

CREATE INDEX idx_pump_points ON pump_curve_points(pump_id, point_order);
CREATE INDEX idx_pumps_lookup ON pumps(type, q_max_m3h, h_max_m);
`;

const V8 = `
-- ── Тема оформления (часть 2 задачи ребрендинга) ───────────────────────────
-- Тема — настройка профиля, как система единиц и уровень подачи: за одним
-- компьютером работают несколько человек, и каждому свою тему.
ALTER TABLE profiles ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark';
`;

const V9 = `
-- ── Перечень оборудования (§3.3) ───────────────────────────────────────────
-- Числовые характеристики сопел, клапанов и фильтрации лежат в своих
-- таблицах; здесь — сам перечень изделий каталога с назначением: контроллеры,
-- датчики, декодеры, капельные линии, фитинги, короба, инструменты.
CREATE TABLE equipment_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  brand       TEXT NOT NULL,
  section     TEXT NOT NULL DEFAULT '',
  model       TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  -- §7 ТЗ: у записи справочника источник обязателен и непуст.
  source      TEXT NOT NULL CHECK (length(trim(source)) > 0),
  source_file TEXT NOT NULL DEFAULT '',
  source_page INTEGER,
  UNIQUE (brand, model)
);

CREATE INDEX idx_equipment_items ON equipment_items(brand, section, model);
`;

const V10 = `
-- ── Уровень 7 «Обвязка и защита насосного агрегата» ────────────────────────
-- Перечень уровней зашит в CHECK, а CHECK в SQLite меняется только пересборкой
-- таблицы. Пересборка идёт по документированному порядку: новая таблица →
-- перенос строк → удаление старой → переименование.
--
-- \`legacy_alter_table\` на время переименования обязателен: в современном
-- режиме ALTER TABLE RENAME проверяет ссылки во всей схеме, а между DROP и
-- RENAME ссылка questions.lesson_id → lessons временно висит в пустоту, и
-- переименование падало бы с «no such table: main.lessons».
PRAGMA legacy_alter_table = ON;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE lessons_v10 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,
  level         TEXT NOT NULL CHECK (level IN
                  ('basics', 'water_plants', 'equipment', 'design', 'automation',
                   'operation', 'pump_rig')),
  order_index   INTEGER NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  body_md       TEXT NOT NULL,
  media_path    TEXT,
  calculator_key TEXT,
  xp_award      INTEGER NOT NULL DEFAULT 10,
  source        TEXT NOT NULL DEFAULT '',
  blocks_json   TEXT NOT NULL DEFAULT '[]',
  reading_minutes INTEGER NOT NULL DEFAULT 5,
  UNIQUE (level, order_index)
);

INSERT INTO lessons_v10 (id, key, level, order_index, title, summary, body_md,
                         media_path, calculator_key, xp_award, source,
                         blocks_json, reading_minutes)
  SELECT id, key, level, order_index, title, summary, body_md,
         media_path, calculator_key, xp_award, source,
         blocks_json, reading_minutes
  FROM lessons;

DROP INDEX IF EXISTS idx_lessons_level;
DROP TABLE lessons;
ALTER TABLE lessons_v10 RENAME TO lessons;
CREATE INDEX idx_lessons_level ON lessons(level, order_index);

PRAGMA legacy_alter_table = OFF;

-- ── Тренажёр «Сборка узла насоса» ──────────────────────────────────────────
-- Эталон лежит в позициях (slots_json), палитра элементов — в parts_json.
-- Разбор каждой позиции хранится рядом с эталоном и наружу отдаётся только
-- после проверки: иначе задание решается чтением ответа, а не схемой.
CREATE TABLE assembly_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  brief       TEXT NOT NULL,
  difficulty  INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  parts_json  TEXT NOT NULL,
  slots_json  TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  source      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE assembly_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_id    INTEGER NOT NULL REFERENCES assembly_tasks(id) ON DELETE CASCADE,
  placement_json TEXT NOT NULL,
  score      REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_assembly_attempts ON assembly_attempts(profile_id, task_id);
`;

/**
 * Миграции по версиям. Индекс шага + 1 = значение `PRAGMA user_version`
 * после его применения. Добавлять можно только в конец массива.
 */
export const MIGRATIONS: readonly string[] = [V1, V2, V3, V4, V5, V6, V7, V8, V9, V10];

export const SCHEMA_VERSION = MIGRATIONS.length;
