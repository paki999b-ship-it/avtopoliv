/**
 * Общие типы расчётного движка.
 *
 * Каждая расчётная функция возвращает `CalcResult`, в котором есть не только
 * числовой ответ, но и подстановка чисел в формулу (`steps`) и инженерные
 * замечания (`notes`). UI обязан показывать формулу и подстановку — см. §3.2
 * технического задания.
 */

export type Severity = 'info' | 'warning' | 'error';

/** Инженерное замечание: что не так → почему → как исправить (§5.16). */
export interface CalcNote {
  severity: Severity;
  /** Стабильный машинный код замечания, для тестов и связей с уроками. */
  code: string;
  /** Что не так. */
  message: string;
  /** Почему это плохо. */
  why?: string;
  /** Как исправить. */
  fix?: string;
  /** Ключ урока Академии, куда ведёт замечание. */
  lessonKey?: string;
}

/** Один шаг вычисления: формула → подстановка → результат. */
export interface CalcStep {
  label: string;
  /** Формула в символьном виде, например `hf = 10,67 · L · Q^1,852 / (C^1,852 · D^4,87)`. */
  formula: string;
  /** Та же формула с подставленными числами. */
  substitution: string;
  /** Результат с единицей измерения. */
  result: string;
}

export interface CalcResult<TValues> {
  values: TValues;
  steps: CalcStep[];
  notes: CalcNote[];
}

/** Система единиц профиля (§1). */
export type UnitSystem = 'metric' | 'imperial';

/** Уровень подачи материала (§1). */
export type SkillLevel = 'owner' | 'installer' | 'designer';

/** Раскладка дождевателей по сетке. */
export type LayoutPattern = 'square' | 'triangular';

/** Класс поливного оборудования — в одной зоне мешать нельзя (§11 п.2). */
export type EmitterClass =
  | 'rotor'
  | 'spray'
  | 'rotary_nozzle'
  /** Полосовая форсунка: поливает прямоугольник, а не сектор круга. */
  | 'strip'
  | 'drip'
  | 'bubbler'
  | 'micro_spray';

/** Материал трубы для выбора коэффициента Хазена–Вильямса и скорости волны. */
export type PipeMaterial = 'pe_new' | 'pe_used' | 'pvc_new' | 'steel_new' | 'steel_old' | 'copper';

export interface ValueWithUnit {
  value: number;
  unit: string;
}
