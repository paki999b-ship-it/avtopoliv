/**
 * Реестр 15 калькуляторов (§3.2, §5).
 *
 * Реестр — единственный источник правды о составе раздела «Калькуляторы»:
 * из него строится меню UI, таблица `calculators` в БД и связи с уроками.
 * Ключи стабильны и используются в `calc_history.calculator_key`.
 */

export type CalculatorKey =
  | 'units'
  | 'friction-loss'
  | 'velocity'
  | 'pipe-sizing'
  | 'minor-losses'
  | 'precipitation-rate'
  | 'irrigation-requirement'
  | 'run-time'
  | 'soil-water'
  | 'water-balance'
  | 'pump-head'
  | 'valve-cable'
  | 'water-hammer'
  | 'drip-line'
  | 'blowout'
  | 'zone-check';

export interface CalculatorMeta {
  key: CalculatorKey;
  /** Номер раздела ТЗ. */
  spec: string;
  title: string;
  /** Одна фраза: что считает. */
  summary: string;
  /** Ключ урока Академии для кнопки «Открыть урок». */
  lessonKey: string;
  formula: string;
  group: 'units' | 'hydraulics' | 'agronomy' | 'equipment' | 'electrical' | 'operation';
}

export const CALCULATORS: CalculatorMeta[] = [
  {
    key: 'units',
    spec: '5.1',
    title: 'Конвертер единиц',
    summary: 'Давление, расход, площадь, осадки и интенсивность — между метрикой и имперской системой.',
    lessonKey: 'basics-water-units',
    formula: '1 бар = 10,2 м вод. ст. = 14,5 psi = 100 кПа; 1 м³/ч = 16,67 л/мин = 4,40 GPM',
    group: 'units',
  },
  {
    key: 'friction-loss',
    spec: '5.2',
    title: 'Потери на трение',
    summary: 'Потери напора в трубе двумя методами: Хазен–Вильямс и Дарси–Вейсбах.',
    lessonKey: 'basics-friction-loss',
    formula: 'hf = 10,67 · L · Q^1,852 / (C^1,852 · D^4,87)',
    group: 'hydraulics',
  },
  {
    key: 'velocity',
    spec: '5.3',
    title: 'Скорость потока',
    summary: 'Скорость воды в трубе и проверка на предел 2,0 м/с.',
    lessonKey: 'basics-flow-and-pressure',
    formula: 'v = 4Q / (π · D²)',
    group: 'hydraulics',
  },
  {
    key: 'pipe-sizing',
    spec: '5.4',
    title: 'Подбор диаметра трубы',
    summary: 'Диаметр под целевую скорость с вариантами вверх и вниз по сортаменту.',
    lessonKey: 'design-hydraulics',
    formula: 'D = √( 4Q / (π · v_цел) )',
    group: 'hydraulics',
  },
  {
    key: 'minor-losses',
    spec: '5.5',
    title: 'Местные потери',
    summary: 'Потери на фитингах и паспортные потери на клапане, фильтре, редукторе, счётчике.',
    lessonKey: 'design-control-unit',
    formula: 'h_мест = hf · k + Σ h_устройств,  k = 0,10…0,20',
    group: 'hydraulics',
  },
  {
    key: 'precipitation-rate',
    spec: '5.6',
    title: 'Интенсивность дождя (PR)',
    summary: 'Интенсивность одной головы в сетке и всей зоны по факту.',
    lessonKey: 'design-layout',
    formula: 'PR [мм/ч] = q [л/ч] / A [м²]',
    group: 'agronomy',
  },
  {
    key: 'irrigation-requirement',
    spec: '5.7',
    title: 'Норма полива',
    summary: 'Норма нетто и брутто по ET0, Kc и равномерности DU.',
    lessonKey: 'water-plants-requirement',
    formula: 'Нетто = ET0 · Kc − осадки;  Брутто = Нетто / DU',
    group: 'agronomy',
  },
  {
    key: 'run-time',
    spec: '5.8',
    title: 'Время полива и cycle & soak',
    summary: 'Время работы зоны и разбивка на циклы, если интенсивность выше впитывания.',
    lessonKey: 'water-plants-cycle-soak',
    formula: 't [мин] = 60 · Норма_брутто [мм] / PR [мм/ч]',
    group: 'agronomy',
  },
  {
    key: 'soil-water',
    spec: '5.9',
    title: 'Норма по запасу влаги',
    summary: 'Сколько дать за один полив и через сколько дней повторить.',
    lessonKey: 'water-plants-root-zone',
    formula: 'Норма = h_корней · AWC · MAD;  Интервал = Норма / суточная потребность',
    group: 'agronomy',
  },
  {
    key: 'water-balance',
    spec: '5.10',
    title: 'Водный баланс и буферная ёмкость',
    summary: 'Сходится ли потребность участка с дебитом источника и какая нужна ёмкость.',
    lessonKey: 'water-plants-balance',
    formula: 'Доступно = Дебит · Окно · 1000 · 0,8;  V ≥ Потребность − Дебит · Окно',
    group: 'agronomy',
  },
  {
    key: 'pump-head',
    spec: '5.11',
    title: 'Требуемый напор и подбор насоса',
    summary: 'Полный напор системы, мощность и рабочая точка на паспортной кривой.',
    lessonKey: 'equipment-pumps',
    formula: 'H = H_геод + hf + h_мест + P_дожд + запас;  P [кВт] = Q · H / (367 · η)',
    group: 'equipment',
  },
  {
    key: 'valve-cable',
    spec: '5.12',
    title: 'Падение напряжения на кабеле',
    summary: 'Сечение и длина кабеля 24 В, общий провод и подбор трансформатора.',
    lessonKey: 'automation-cable',
    formula: 'ΔU = 2 · L · I · ρ / S,  ΔU ≤ 2,4 В',
    group: 'electrical',
  },
  {
    key: 'water-hammer',
    spec: '5.13',
    title: 'Гидроудар',
    summary: 'Скачок давления при закрытии клапана по формуле Жуковского.',
    lessonKey: 'basics-pressure-units',
    formula: 'Δp = ρ · c · Δv',
    group: 'hydraulics',
  },
  {
    key: 'drip-line',
    spec: '5.14',
    title: 'Капельная линия',
    summary: 'Расход линии, потери, разброс расхода и максимальная длина.',
    lessonKey: 'equipment-drip',
    formula: 'hf = F · hf_полный;  q_var = 1 − (P_мин / P_макс)^x',
    group: 'equipment',
  },
  {
    key: 'blowout',
    spec: '5.15',
    title: 'Продувка на зиму',
    summary: 'Производительность компрессора, предельное давление и план обхода зон.',
    lessonKey: 'operation-blowout',
    formula: 'CFM ≈ GPM / 7,5',
    group: 'operation',
  },
  {
    key: 'zone-check',
    spec: '5.16',
    title: 'Проверка зоны',
    summary: 'Сводная проверка зоны разом: расход, давление, скорость, PR, электрика.',
    lessonKey: 'design-zoning',
    formula: 'сводная проверка по §5.16',
    group: 'hydraulics',
  },
];

export function findCalculator(key: CalculatorKey): CalculatorMeta {
  const c = CALCULATORS.find((x) => x.key === key);
  if (!c) throw new Error(`Неизвестный калькулятор: ${key}`);
  return c;
}
