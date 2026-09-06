import type { SectionKey, SkillLevel, UnitSystem } from '@shared/types.js';
import type { Route, RouteName } from '../store/router.js';

/**
 * Состав главного меню — §3 ТЗ. Один список кормит и боковое меню, и плитки
 * на дашборде, поэтому разделы не могут разъехаться между двумя экранами.
 */
export interface NavItem {
  route: Route;
  name: RouteName;
  title: string;
  hint: string;
  icon: string;
  /** Ключ раздела в сводке прогресса, если у раздела есть прогресс-бар. */
  progressKey?: SectionKey;
  /** Раздел ещё не наполнен контентом — по порядку сборки §12. */
  pending?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    route: { name: 'home' },
    name: 'home',
    title: 'Обзор',
    hint: 'Прогресс, стрик и что делать дальше',
    icon: '🏠',
  },
  {
    route: { name: 'academy' },
    name: 'academy',
    title: 'Академия',
    hint: 'Курс из шести уровней с мини-тестами',
    icon: '🎓',
    progressKey: 'academy',
  },
  {
    route: { name: 'calculators' },
    name: 'calculators',
    title: 'Калькуляторы',
    hint: 'Шестнадцать инженерных расчётов с формулами',
    icon: '🧮',
    progressKey: 'calculators',
  },
  {
    route: { name: 'reference' },
    name: 'reference',
    title: 'Справочники',
    hint: 'Сопла, трубы, почвы, Kc, кабель, термины, нормы',
    icon: '📚',
  },
  {
    route: { name: 'layout' },
    name: 'layout',
    title: 'Тренажёр раскладки',
    hint: 'План участка, покрытие и замечания',
    icon: '🗺️',
    progressKey: 'layout',
  },
  {
    route: { name: 'assembly' },
    name: 'assembly',
    title: 'Сборка узла насоса',
    hint: 'Расставить обвязку насоса по позициям',
    icon: '🔩',
    progressKey: 'assembly',
  },
  {
    route: { name: 'errors' },
    name: 'errors',
    title: 'Найди ошибку',
    hint: 'Разбор сценариев с типовыми промахами',
    icon: '🔍',
    progressKey: 'errors',
  },
  {
    route: { name: 'diagnostics' },
    name: 'diagnostics',
    title: 'Диагностика',
    hint: 'Симптом → причина → что замерить',
    icon: '🩺',
    progressKey: 'diagnostics',
  },
  {
    route: { name: 'safety' },
    name: 'safety',
    title: 'Безопасность',
    hint: 'Электрика, обратный поток, продувка, скважина',
    icon: '⚠️',
    progressKey: 'safety',
  },
  {
    route: { name: 'exam' },
    name: 'exam',
    title: 'Экзамен',
    hint: '60 вопросов, проходной балл 75 %',
    icon: '📝',
  },
];

export const SECTION_TITLES: Record<SectionKey, string> = {
  academy: 'Академия',
  calculators: 'Калькуляторы',
  layout: 'Тренажёр раскладки',
  assembly: 'Сборка узла насоса',
  errors: 'Найди ошибку',
  diagnostics: 'Диагностика',
  safety: 'Безопасность',
};

/** Единицы прогресса — чтобы «3 из 60» читалось как «3 урока из 60». */
export const SECTION_UNITS: Record<SectionKey, string> = {
  academy: 'уроков',
  calculators: 'калькуляторов',
  layout: 'заданий',
  assembly: 'узлов',
  errors: 'сценариев',
  diagnostics: 'симптомов',
  safety: 'тем',
};

export const SKILL_LEVELS: Array<{
  value: SkillLevel;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    value: 'owner',
    title: 'Владелец участка',
    description: 'Понятным языком, минимум формул, максимум «что это значит на практике».',
    icon: '🏡',
  },
  {
    value: 'installer',
    title: 'Монтажник',
    description: 'Кратко и по делу: раскладка, узлы, типовые ошибки, диагностика.',
    icon: '🔧',
  },
  {
    value: 'designer',
    title: 'Проектировщик',
    description: 'На языке цифр: формулы, подстановки, допуски, нормативная рамка.',
    icon: '📐',
  },
];

export const UNIT_SYSTEMS: Array<{ value: UnitSystem; title: string; description: string }> = [
  {
    value: 'metric',
    title: 'Метрическая',
    description: 'м³/ч, бар, мм/ч, м. По умолчанию.',
  },
  {
    value: 'imperial',
    title: 'Имперская',
    description: 'GPM, psi, in/ч, ft. Нужна при работе с американскими каталогами.',
  },
];

/** Аватары профиля — офлайн, без загрузки картинок. */
export const AVATARS = ['💧', '🌿', '🌻', '🌲', '🚿', '🛠️', '📐', '🏡', '⚙️', '🌾', '🔩', '☔'];
