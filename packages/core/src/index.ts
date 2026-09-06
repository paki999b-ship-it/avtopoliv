/**
 * @irrigo/core — расчётный движок АртЛандшафт.
 *
 * Пакет не зависит от React и Electron. Все формулы раздела §5 ТЗ живут
 * здесь и только здесь: калькуляторы, тренажёр раскладки и проверка ответов
 * в тестах используют одни и те же функции. Дублировать формулы в UI нельзя.
 */

// Базовые типы и утилиты
export * from './types.js';
export * from './format.js';
export * from './constants.js';
export * from './units.js';

// Гидравлика
export * from './hydraulics/friction.js';
export * from './hydraulics/velocity.js';
export * from './hydraulics/pipe-sizing.js';
export * from './hydraulics/minor-losses.js';
export * from './hydraulics/water-hammer.js';

// Агрономия и режим полива
export * from './agronomy/precipitation-rate.js';
export * from './agronomy/strip-nozzle.js';
export * from './agronomy/irrigation-requirement.js';
export * from './agronomy/runtime.js';
export * from './agronomy/soil-water.js';
export * from './agronomy/water-balance.js';

// Насос, электрика, капля, эксплуатация
export * from './pump/head.js';
export * from './pump/catalog.js';
export * from './pump/assembly.js';
export * from './electrical/voltage-drop.js';
export * from './drip/drip-line.js';
export * from './ops/blowout.js';

// Сводная проверка зоны
export * from './zone-check.js';

// Тренажёр раскладки: геометрия плана, покрытие и замечания
export * from './layout/geometry.js';
export * from './layout/coverage.js';
export * from './layout/checks.js';

// Тренажёр «Найди ошибку»
export * from './scenarios/score.js';

// Справочные данные
export * from './data/pipes.js';
export * from './data/soils.js';
export * from './data/plants.js';
export * from './data/cable.js';
export * from './data/strip-nozzles.js';

// Программа курса и реестр калькуляторов
export * from './academy-plan.js';
export * from './registry.js';
export * from './quiz.js';
