import type { CalcResult, CalculatorKey } from '@irrigo/core';

/**
 * Описание калькулятора для UI.
 *
 * Формы задаются данными, а не вёрсткой: шестнадцать калькуляторов §5 ТЗ
 * отличаются набором полей, а не поведением. Общий исполнитель
 * (`CalcRunner`) читает это описание, поэтому требование §3.2 показывать
 * формулу, подстановку и результат выполняется одинаково во всех — забыть
 * его в одном калькуляторе невозможно.
 *
 * Считает при этом всегда `@irrigo/core`. Формул в этом слое нет и быть не
 * должно (§2 ТЗ).
 */

/**
 * Физическая величина поля. Нужна для переключателя метрической и имперской
 * системы (§13): движок всегда принимает и возвращает метрику, а показывается
 * то, что выбрано в профиле.
 */
export type Quantity =
  | 'pressure'
  | 'flow'
  | 'flowLph'
  | 'length'
  | 'diameter'
  | 'area'
  | 'volume'
  | 'depth'
  | 'precipitation'
  | 'velocity'
  | 'power';

export interface NumberFieldSpec {
  kind: 'number';
  name: string;
  label: string;
  /** Единица в метрической системе. При имперской подменяется адаптером. */
  unit: string;
  quantity?: Quantity;
  hint?: string;
  min?: number;
  max?: number;
  /** Поле можно оставить пустым — в движок уйдёт `undefined`. */
  optional?: boolean;
  /** Показывать только при выполнении условия — например, «уклон > 5 %». */
  visibleIf?: (values: FormValues) => boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldSpec {
  kind: 'select';
  name: string;
  label: string;
  hint?: string;
  options: SelectOption[];
  /** Список зависит от других полей — например, единицы от выбранной величины. */
  optionsFor?: (values: FormValues) => SelectOption[];
  visibleIf?: (values: FormValues) => boolean;
}

export interface ToggleFieldSpec {
  kind: 'toggle';
  name: string;
  label: string;
  hint?: string;
  visibleIf?: (values: FormValues) => boolean;
}

/** Повторяющаяся группа: головы зоны, зоны продувки, устройства узла. */
export interface ListFieldSpec {
  kind: 'list';
  name: string;
  label: string;
  addLabel: string;
  /** Минимальное число строк — обычно одна: пустой список движок не примет. */
  minItems: number;
  fields: Array<NumberFieldSpec | SelectFieldSpec | TextFieldSpec>;
  newItem: () => FormValues;
}

export interface TextFieldSpec {
  kind: 'text';
  name: string;
  label: string;
  hint?: string;
  placeholder?: string;
}

/**
 * Заголовок группы полей — не ввод, а навигация по форме.
 *
 * У калькуляторов с десятком полей плоский список не читается: непонятно, что
 * описывает систему, что задаёт допуски расчёта, а что относится к
 * необязательной проверке. Группы разделяют это, ничего не меняя в расчёте.
 */
export interface SectionFieldSpec {
  kind: 'section';
  /** Заголовок группы. Он же ключ списка — поля `name` у группы нет. */
  title: string;
  description?: string;
  visibleIf?: (values: FormValues) => boolean;
}

export type CalcFieldSpec =
  | NumberFieldSpec
  | SelectFieldSpec
  | ToggleFieldSpec
  | TextFieldSpec
  | ListFieldSpec
  | SectionFieldSpec;

export type FormValue = number | string | boolean | null | FormValues[] | undefined;
export type FormValues = Record<string, FormValue>;

/** Одно число в сводке результата. */
export interface OutputSpec {
  /** Ключ в `values` результата движка. */
  name: string;
  label: string;
  unit?: string;
  quantity?: Quantity;
  digits?: number;
  hint?: string;
  /** Окраска плитки по значению: зелёная норма, красный выход за предел. */
  tone?: (result: Record<string, unknown>) => 'default' | 'ok' | 'warn' | 'danger';
  /** Не показывать, когда значение не рассчитано. */
  hideIfNull?: boolean;
}

/** Дополнительная таблица под сводкой: варианты труб, план продувки, циклы. */
export interface ResultTable {
  title: string;
  note?: string;
  columns: string[];
  rows: string[][];
  /** Индекс строки, которую надо подсветить как рекомендованную. */
  highlightRow?: number;
}

export interface CalcRunContext {
  /** Значения формы, уже переведённые в метрику. */
  values: FormValues;
}

export interface CalcDefinition {
  key: CalculatorKey;
  fields: CalcFieldSpec[];
  defaults: FormValues;
  /**
   * Вызов расчётной функции движка. Бросает при недопустимом вводе.
   *
   * Тип значений — `object`, а не `Record<string, unknown>`: движок возвращает
   * именованные интерфейсы, а они к индексной сигнатуре не приводятся без
   * приведения типа. Разбирает их `asRecord` в исполнителе — ровно в одном месте.
   */
  run: (ctx: CalcRunContext) => CalcResult<object>;
  outputs: OutputSpec[];
  /** Таблицы, которые строятся из результата. */
  tables?: (result: CalcResult<object>, values: FormValues) => ResultTable[];
  /**
   * Кнопка «Пояснить» (§3.2): что означает результат и что делать, если он
   * плохой. Абзацами, человеческим языком.
   */
  explain: string[];
  /** Подпись записи в истории — чем этот расчёт отличается от соседнего. */
  historyTitle: (values: FormValues, result: CalcResult<object>) => string;
  /**
   * Своя вставка под результатом — по ключу, а не компонентом.
   *
   * Так описания калькуляторов остаются свободны от React: их читают и тесты,
   * и отчёты, которым разметка не нужна. Ключ разворачивает в компонент
   * исполнитель.
   */
  extraKey?: 'pump-curve';
}

/** Разбор именованного интерфейса движка в набор полей для вывода. */
export function asRecord(values: object): Record<string, unknown> {
  return values as Record<string, unknown>;
}
