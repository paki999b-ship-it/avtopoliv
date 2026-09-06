/**
 * Программа курса — §4 ТЗ.
 *
 * Единственный источник правды о составе Академии: перечень уровней и ключей
 * уроков. На эти ключи ссылаются реестр калькуляторов (кнопка «Открыть урок»,
 * §3.2), глоссарий, диагностика и разбор ошибок в тестах.
 *
 * План объявлен целиком, включая уровни, контент которых ещё не написан:
 * иначе ссылка из калькулятора вела бы в пустоту, а расхождение обнаружилось бы
 * у пользователя. Тесты проверяют, что каждая ссылка попадает в этот список,
 * а написанные уроки — что их ключи из него же.
 */

export type AcademyLevelKey =
  | 'basics'
  | 'water_plants'
  | 'equipment'
  | 'design'
  | 'automation'
  | 'operation'
  | 'pump_rig';

export interface AcademyLevelPlan {
  key: AcademyLevelKey;
  order: number;
  title: string;
  subtitle: string;
  icon: string;
  /** Ключи уроков в порядке изучения. */
  lessons: readonly string[];
}

export const ACADEMY_PLAN: readonly AcademyLevelPlan[] = [
  {
    key: 'basics',
    order: 1,
    title: 'Основы',
    subtitle: 'Из чего состоит система, вода, давление, расход и потери',
    icon: '💧',
    lessons: [
      'basics-system-overview',
      'basics-water-units',
      'basics-flow-and-pressure',
      'basics-pressure-units',
      'basics-static-dynamic',
      'basics-elevation',
      'basics-friction-loss',
      'basics-zones',
      'basics-irrigation-types',
    ],
  },
  {
    key: 'water_plants',
    order: 2,
    title: 'Вода и растения',
    subtitle: 'Сколько воды нужно растениям и сколько принимает почва',
    icon: '🌿',
    lessons: [
      'water-plants-et0',
      'water-plants-kc',
      'water-plants-requirement',
      'water-plants-soil',
      'water-plants-root-zone',
      'water-plants-soil-water',
      'water-plants-cycle-soak',
      'water-plants-balance',
      'water-plants-schedule',
    ],
  },
  {
    key: 'equipment',
    order: 3,
    title: 'Оборудование',
    subtitle: 'Дождеватели, капля, клапаны, фильтры, насосы',
    icon: '⚙️',
    lessons: [
      'equipment-rotors',
      'equipment-sprays',
      'equipment-rotary-nozzles',
      'equipment-prs',
      'equipment-swing-joint',
      'equipment-drip',
      'equipment-micro',
      'equipment-valves',
      'equipment-filters',
      'equipment-regulators',
      'equipment-pumps',
    ],
  },
  {
    key: 'design',
    order: 4,
    title: 'Проектирование',
    subtitle: 'Раскладка, зонирование, гидравлика, подбор насоса и узла',
    icon: '📐',
    lessons: [
      'design-survey',
      'design-source',
      'design-layout',
      'design-matched-pr',
      'design-uniformity',
      'design-schedule-multiplier',
      'design-zoning',
      'design-hydraulics',
      'design-pump-selection',
      'design-control-unit',
      'design-reserve',
    ],
  },
  {
    key: 'automation',
    order: 5,
    title: 'Автоматика и электрика',
    subtitle: 'Контроллеры, кабель, датчики, умное расписание',
    icon: '🔌',
    lessons: [
      'automation-controllers',
      'automation-programs',
      'automation-decoders',
      'automation-transformer',
      'automation-cable',
      'automation-connections',
      'automation-sensors',
      'automation-smart',
      'automation-flow-sensor',
      'automation-remote',
    ],
  },
  {
    key: 'operation',
    order: 6,
    title: 'Монтаж и эксплуатация',
    subtitle: 'Траншеи, установка голов, пусконаладка, аудит, зима',
    icon: '🔧',
    lessons: [
      'installation-marking',
      'installation-trenching',
      'installation-joints',
      'installation-heads',
      'installation-pressure-test',
      'operation-commissioning',
      'operation-audit',
      'operation-blowout',
      'operation-spring-start',
      'operation-common-mistakes',
    ],
  },
  {
    key: 'pump_rig',
    order: 7,
    title: 'Обвязка и защита насосного агрегата',
    subtitle: 'Что стоит вокруг насоса, зачем и в каком порядке',
    icon: '🛡️',
    lessons: [
      'pump-rig-check-valve',
      'pump-rig-shutoff',
      'pump-rig-gauges',
      'pump-rig-press-control',
      'pump-rig-pressure-switch',
      'pump-rig-starters',
      'pump-rig-vfd',
      'pump-rig-accumulator',
      'pump-rig-dry-run',
      'pump-rig-backflow',
      'pump-rig-strainer',
      'pump-rig-relief-bypass',
      'pump-rig-full',
    ],
  },
] as const;

/** Все ключи уроков курса. */
export const ACADEMY_LESSON_KEYS: readonly string[] = ACADEMY_PLAN.flatMap((l) => l.lessons);

export function isAcademyLessonKey(key: string): boolean {
  return ACADEMY_LESSON_KEYS.includes(key);
}

export function academyLevel(key: AcademyLevelKey): AcademyLevelPlan {
  const level = ACADEMY_PLAN.find((l) => l.key === key);
  if (!level) throw new Error(`Неизвестный уровень Академии: ${key}`);
  return level;
}

/** Уровень, которому принадлежит урок. */
export function levelOfLesson(lessonKey: string): AcademyLevelPlan | undefined {
  return ACADEMY_PLAN.find((l) => l.lessons.includes(lessonKey));
}
