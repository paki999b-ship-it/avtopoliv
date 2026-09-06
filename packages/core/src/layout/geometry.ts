/**
 * Геометрия плана участка для тренажёра раскладки (§3.4 ТЗ).
 *
 * Система координат — математическая: X вправо, Y вверх, единица — метр.
 * Углы отсчитываются от направления «на восток» против часовой стрелки, как
 * в тригонометрии. Экранные координаты (Y вниз) — забота отрисовки, а не
 * расчёта: смешивать их в геометрии значит путаться в знаках при каждой правке.
 */

import type { EmitterClass } from '../types.js';

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutPolygon {
  points: LayoutPoint[];
}

/** Препятствие: поливать нельзя, площадь из поливаемой исключается. */
export type ObstacleKind = 'house' | 'path' | 'terrace' | 'water' | 'parking' | 'other';

export interface LayoutObstacle {
  kind: ObstacleKind;
  polygon: LayoutPolygon;
  label?: string;
}

export type PlantingKind = 'lawn' | 'shrubs' | 'flowers' | 'trees' | 'vegetables';

export interface PlantingArea {
  kind: PlantingKind;
  polygon: LayoutPolygon;
  label?: string;
}

export interface LayoutPlan {
  /** Контур участка. */
  boundary: LayoutPolygon;
  obstacles: LayoutObstacle[];
  /** Зоны насаждений. Могут не покрывать весь контур. */
  plantings: PlantingArea[];
  /** Дебит источника, м³/ч. */
  sourceFlowM3h: number;
  /** Давление, доступное на головах, бар. */
  workingPressureBar?: number;
}

export interface LayoutHead {
  id: string;
  position: LayoutPoint;
  radiusM: number;
  /** Начало сектора, град. */
  startDeg: number;
  /** Раствор сектора, град: 90, 180, 270, 360 и промежуточные. */
  sweepDeg: number;
  emitterClass: EmitterClass;
  /** Расход головы, л/ч. */
  flowLph: number;
  model?: string;
}

/** Площадь многоугольника по формуле шнурования. Знак отброшен. */
export function polygonArea(polygon: LayoutPolygon): number {
  const p = polygon.points;
  if (p.length < 3) return 0;

  let sum = 0;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Точка внутри многоугольника — метод трассировки луча.
 * Точка ровно на границе считается внутренней: иначе край участка вдоль
 * забора выпадал бы из расчёта покрытия целиком.
 */
export function pointInPolygon(point: LayoutPoint, polygon: LayoutPolygon): boolean {
  const p = polygon.points;
  if (p.length < 3) return false;

  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i, i += 1) {
    const a = p[i]!;
    const b = p[j]!;

    if (pointOnSegment(point, a, b)) return true;

    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

const EPS = 1e-9;

function pointOnSegment(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y);
  return dot <= EPS;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundingBox(polygon: LayoutPolygon): BoundingBox {
  const p = polygon.points;
  if (p.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = p[0]!.x;
  let maxX = p[0]!.x;
  let minY = p[0]!.y;
  let maxY = p[0]!.y;

  for (const point of p) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return { minX, minY, maxX, maxY };
}

export function distance(a: LayoutPoint, b: LayoutPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Угол от `from` к `to` в градусах, 0…360, против часовой стрелки от востока. */
export function angleDeg(from: LayoutPoint, to: LayoutPoint): number {
  const deg = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Лежит ли угол внутри сектора, заданного началом и раствором. */
export function angleInSector(deg: number, startDeg: number, sweepDeg: number): boolean {
  if (sweepDeg >= 360) return true;
  if (sweepDeg <= 0) return false;
  const offset = (((deg - startDeg) % 360) + 360) % 360;
  return offset <= sweepDeg;
}

/** Покрывает ли голова точку: и по расстоянию, и по сектору. */
export function headCovers(head: LayoutHead, point: LayoutPoint): boolean {
  const d = distance(head.position, point);
  if (d > head.radiusM) return false;
  // Точка ровно под головой покрыта при любом секторе: угол там не определён.
  if (d < EPS) return true;
  return angleInSector(angleDeg(head.position, point), head.startDeg, head.sweepDeg);
}

/**
 * Кратчайшее расстояние от точки до контура многоугольника.
 * Нужно для проверки «голова ближе 10 см к кромке» (§3.4).
 */
export function distanceToPolygonEdge(point: LayoutPoint, polygon: LayoutPolygon): number {
  const p = polygon.points;
  if (p.length < 2) return Number.POSITIVE_INFINITY;

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared < EPS) return distance(p, a);

  // Проекция точки на отрезок, зажатая его концами.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Прямоугольник по левому нижнему углу и размерам — самая частая заготовка. */
export function rectangle(x: number, y: number, width: number, height: number): LayoutPolygon {
  return {
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}
