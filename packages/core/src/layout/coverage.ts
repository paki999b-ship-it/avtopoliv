/**
 * Расчёт покрытия участка дождевателями (§3.4 ТЗ).
 *
 * ── Почему выборкой по сетке, а не аналитически ────────────────────────────
 * Площадь непокрытой части участка — это площадь многоугольника за вычетом
 * объединения десятков круговых секторов, часть которых пересекается по три и
 * по четыре. Аналитически такое считается через булевы операции над кривыми:
 * много кода, много вырожденных случаев и никакой пользы для точности,
 * которая здесь нужна.
 *
 * Выборка по сетке даёт то же самое одним проходом, естественно обрабатывает
 * любые пересечения и заодно сразу отдаёт координаты непокрытых пятен — их
 * §3.4 требует показывать красным. Погрешность определяется шагом сетки и
 * оценивается заранее.
 */

import { round } from '../format.js';
import {
  boundingBox,
  headCovers,
  pointInPolygon,
  polygonArea,
} from './geometry.js';
import type { LayoutHead, LayoutPlan, LayoutPoint } from './geometry.js';

/** Шаг сетки по умолчанию, м. Даёт ячейку 0,25 м² — четверть квадратного метра. */
export const DEFAULT_CELL_SIZE_M = 0.5;

/** Предел числа ячеек: защита от гигантского участка с мелкой сеткой. */
const MAX_CELLS = 400_000;

export interface CoverageOptions {
  cellSizeM?: number;
}

export interface CoverageCell {
  center: LayoutPoint;
  /** Сколько голов покрывает ячейку. */
  hits: number;
}

export interface CoverageResult {
  cellSizeM: number;
  /** Площадь, которую нужно поливать: контур минус препятствия. */
  irrigableAreaM2: number;
  coveredAreaM2: number;
  uncoveredAreaM2: number;
  /** Площадь, покрытая двумя и более головами. */
  overlapAreaM2: number;
  /** Доля покрытой площади, 0…1. */
  coverageRatio: number;
  /** Доля площади с перекрытием, 0…1. */
  overlapRatio: number;
  /** Центры непокрытых ячеек — для красной заливки на плане. */
  uncovered: LayoutPoint[];
  /**
   * Площадь полива мимо цели: за контуром участка плюс по препятствиям.
   * Считается по той же сетке, расширенной на радиус самой дальнобойной головы.
   */
  wastedAreaM2: number;
  /**
   * Полив за границу участка. Полностью избежать его нельзя: круглый факел
   * не вписывается в прямой угол, а на узкой полосе радиус заведомо больше
   * её ширины. Поэтому меряется отдельно от полива по препятствиям.
   */
  wastedOutsideM2: number;
  /**
   * Полив по своим же дорожкам, постройкам и террасам. В отличие от полива
   * за забор, это всегда ошибка проекта: мокрая плитка и залитая отмостка.
   */
  wastedOnObstaclesM2: number;
  /** Площадь препятствий внутри контура, м². */
  obstacleAreaM2: number;
  /** Оценка погрешности метода: площадь одной ячейки, м². */
  cellAreaM2: number;
}

/** Площадь, которую система обязана полить: контур минус препятствия. */
export function irrigableArea(plan: LayoutPlan): number {
  const total = polygonArea(plan.boundary);
  const blocked = plan.obstacles.reduce((sum, o) => sum + polygonArea(o.polygon), 0);
  return Math.max(0, total - blocked);
}

/** Точка внутри участка и не на препятствии. */
function isIrrigable(point: LayoutPoint, plan: LayoutPlan): boolean {
  if (!pointInPolygon(point, plan.boundary)) return false;
  return !plan.obstacles.some((o) => pointInPolygon(point, o.polygon));
}

/**
 * Покрытие участка головами.
 *
 * Возвращает не только числа, но и координаты непокрытых ячеек: §3.4 требует
 * показывать непокрытые зоны красным, а искать их второй раз в UI — значит
 * дублировать логику.
 */
export function coverage(
  plan: LayoutPlan,
  heads: LayoutHead[],
  options: CoverageOptions = {},
): CoverageResult {
  const requested = options.cellSizeM ?? DEFAULT_CELL_SIZE_M;
  if (requested <= 0) throw new Error('Шаг сетки должен быть больше нуля');

  const box = boundingBox(plan.boundary);
  const maxRadius = heads.reduce((max, h) => Math.max(max, h.radiusM), 0);

  // Сетка расширена на радиус самой дальнобойной головы: только так виден
  // полив за границу участка, который §3.4 требует замечать.
  const outer = {
    minX: box.minX - maxRadius,
    minY: box.minY - maxRadius,
    maxX: box.maxX + maxRadius,
    maxY: box.maxY + maxRadius,
  };

  const cellSizeM = fitCellSize(outer, requested);
  const cellAreaM2 = cellSizeM * cellSizeM;

  let irrigableCells = 0;
  let obstacleCells = 0;
  let coveredCells = 0;
  let overlapCells = 0;
  let wastedOutsideCells = 0;
  let wastedOnObstacleCells = 0;
  const uncovered: LayoutPoint[] = [];

  for (let y = outer.minY + cellSizeM / 2; y < outer.maxY; y += cellSizeM) {
    for (let x = outer.minX + cellSizeM / 2; x < outer.maxX; x += cellSizeM) {
      const center = { x, y };

      let hits = 0;
      for (const head of heads) {
        if (headCovers(head, center)) hits += 1;
      }

      if (isIrrigable(center, plan)) {
        irrigableCells += 1;
        if (hits === 0) uncovered.push(center);
        else {
          coveredCells += 1;
          if (hits >= 2) overlapCells += 1;
        }
      } else if (pointInPolygon(center, plan.boundary)) {
        // Внутри контура, но не поливаемая — значит препятствие.
        obstacleCells += 1;
        if (hits > 0) wastedOnObstacleCells += 1;
      } else if (hits > 0) {
        wastedOutsideCells += 1;
      }
    }
  }

  const irrigableAreaM2 = irrigableCells * cellAreaM2;
  const coveredAreaM2 = coveredCells * cellAreaM2;

  return {
    cellSizeM: round(cellSizeM, 3),
    irrigableAreaM2: round(irrigableAreaM2, 1),
    coveredAreaM2: round(coveredAreaM2, 1),
    uncoveredAreaM2: round(irrigableAreaM2 - coveredAreaM2, 1),
    overlapAreaM2: round(overlapCells * cellAreaM2, 1),
    coverageRatio: irrigableCells === 0 ? 0 : round(coveredCells / irrigableCells, 3),
    overlapRatio: irrigableCells === 0 ? 0 : round(overlapCells / irrigableCells, 3),
    uncovered,
    wastedAreaM2: round((wastedOutsideCells + wastedOnObstacleCells) * cellAreaM2, 1),
    wastedOutsideM2: round(wastedOutsideCells * cellAreaM2, 1),
    wastedOnObstaclesM2: round(wastedOnObstacleCells * cellAreaM2, 1),
    obstacleAreaM2: round(obstacleCells * cellAreaM2, 1),
    cellAreaM2: round(cellAreaM2, 4),
  };
}

/**
 * Укрупняет ячейку, если запрошенная сетка не помещается в предел.
 * Лучше посчитать грубее, чем повесить интерфейс на пересчёте.
 */
function fitCellSize(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  requested: number,
): number {
  const width = Math.max(0, box.maxX - box.minX);
  const height = Math.max(0, box.maxY - box.minY);

  let size = requested;
  while ((width / size) * (height / size) > MAX_CELLS) size *= 2;
  return size;
}

/**
 * Слияние непокрытых ячеек в пятна — чтобы показать «три сухих пятна по 2 м²»,
 * а не «сорок восемь непокрытых ячеек». Соседство считается по восьми
 * направлениям: диагональный контакт для человека — то же самое пятно.
 */
export interface DrySpot {
  cells: LayoutPoint[];
  areaM2: number;
  center: LayoutPoint;
}

export function drySpots(result: CoverageResult): DrySpot[] {
  const size = result.cellSizeM;
  const key = (p: LayoutPoint) => `${Math.round(p.x / size)}:${Math.round(p.y / size)}`;

  const remaining = new Map<string, LayoutPoint>();
  for (const cell of result.uncovered) remaining.set(key(cell), cell);

  const spots: DrySpot[] = [];

  for (const [startKey, startCell] of remaining) {
    if (!remaining.has(startKey)) continue;

    const cells: LayoutPoint[] = [];
    const queue: LayoutPoint[] = [startCell];
    remaining.delete(startKey);

    while (queue.length > 0) {
      const cell = queue.pop()!;
      cells.push(cell);

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const neighbourKey = key({ x: cell.x + dx * size, y: cell.y + dy * size });
          const neighbour = remaining.get(neighbourKey);
          if (neighbour) {
            remaining.delete(neighbourKey);
            queue.push(neighbour);
          }
        }
      }
    }

    const areaM2 = cells.length * size * size;
    const center = {
      x: round(cells.reduce((s, c) => s + c.x, 0) / cells.length, 2),
      y: round(cells.reduce((s, c) => s + c.y, 0) / cells.length, 2),
    };

    spots.push({ cells, areaM2: round(areaM2, 1), center });
  }

  return spots.sort((a, b) => b.areaM2 - a.areaM2);
}
