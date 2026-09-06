/**
 * Типы справочников (§3.3 ТЗ), общие для main и renderer.
 *
 * Таблицы описаны колонками, а не жёсткой вёрсткой: один компонент рисует все
 * девять разделов, и фильтр с сортировкой ведут себя в них одинаково.
 */

/** Как показывать значение колонки. */
export type ReferenceColumnKind =
  | 'text'
  /** Флаг «строка прошла сверку» — 0/1. */
  | 'verified'
  /** `verified` / `to_verify` у справочных данных. */
  | 'status'
  /** Ссылка на официальный источник норматива. */
  | 'url'
  /** Флаг «уточнить по действующей редакции и юрисдикции». */
  | 'local_check'
  /** Сферический или угловой корпус клапана. */
  | 'valve_body'
  /** Группа термина глоссария. */
  | 'glossary_group'
  /** Ключ калькулятора — превращается в переход на него. */
  | 'calculator_link'
  /** Класс дождевателя: ротор, спрей, роторное сопло, полосовая форсунка. */
  | 'emitter_class'
  /** Рекомендованная производителем рабочая точка. */
  | 'recommended'
  /** Тип насоса: поверхностный, скважинный, многоступенчатый, станция. */
  | 'pump_type'
  /** Кривая снята с графика, а не взята из напечатанной таблицы. */
  | 'digitized';

export interface ReferenceColumn {
  key: string;
  label: string;
  numeric?: boolean;
  /** Знаков после запятой при выводе числа. */
  digits?: number;
  /** Колонка с длинным текстом — занимает больше места и переносится. */
  wide?: boolean;
  kind?: ReferenceColumnKind;
}

/** Подписи классов дождевателей — используются и в справочнике, и в фильтре. */
export const EMITTER_CLASS_TITLES: Record<string, string> = {
  rotor: 'Роторы',
  spray: 'Спреи',
  rotary_nozzle: 'Роторные сопла',
  strip: 'Полосовые',
  drip: 'Капельный полив',
  bubbler: 'Баблеры',
  micro_spray: 'Микродождеватели',
};

/** Подписи типов насосов — общие для справочника и подбора в калькуляторе. */
export const PUMP_TYPE_TITLES: Record<string, string> = {
  surface: 'Поверхностный',
  submersible: 'Скважинный / погружной',
  multistage: 'Многоступенчатый',
  booster_station: 'Насосная станция',
};

export interface ReferenceFilterInfo {
  key: string;
  label: string;
  values: string[];
}

export interface ReferenceTableInfo {
  key: string;
  title: string;
  note?: string;
  rows: number;
  filters: ReferenceFilterInfo[];
}

export interface ReferenceSectionInfo {
  key: string;
  title: string;
  description: string;
  icon: string;
  /** Оговорка о происхождении данных — показывается над таблицей. */
  note?: string;
  rows: number;
  tables: ReferenceTableInfo[];
}

export interface ReferenceQuery {
  section: string;
  table?: string;
  query?: string;
  filters?: Record<string, string>;
  sort?: { column: string; dir: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface ReferenceResult {
  section: string;
  sectionTitle: string;
  table: string;
  tableTitle: string;
  note?: string;
  columns: ReferenceColumn[];
  rows: Array<Record<string, unknown>>;
  total: number;
  limit: number;
  offset: number;
  sort: { column: string; dir: 'asc' | 'desc' };
}

/** Одна находка глобального поиска. */
export interface SearchHit {
  section: string;
  table: string;
  rowId: number | null;
  title: string;
  subtitle: string;
}

export interface SearchGroup {
  section: string;
  sectionTitle: string;
  icon: string;
  total: number;
  hits: SearchHit[];
}

export interface SearchResult {
  query: string;
  total: number;
  groups: SearchGroup[];
}
